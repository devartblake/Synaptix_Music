import type { Pool, PoolClient } from "pg";

import {
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_MAX_ATTEMPTS,
  RENDER_JOB_CONTRACT_VERSION,
  resolveFailureOutcome,
  RenderJobEventSchema,
  RenderJobSchema,
  RenderManifestSchema,
  RenderResultSchema,
  type RenderJob,
  type RenderJobEvent,
  type RenderJobEventType,
  type RenderJobStatus,
  type RenderManifest,
  type RenderResult
} from "@synaptix/render-contracts";

/** A player already has the maximum number of queued or running render jobs. */
export class RenderQuotaExceededError extends Error {
  constructor(readonly limit: number) {
    super(`You already have ${limit} renders queued or running. Wait for one to finish, then try again.`);
    this.name = "RenderQuotaExceededError";
  }
}

interface RenderJobRow {
  job_id: string;
  idempotency_key: string;
  contract_version: string;
  manifest: RenderManifest;
  status: RenderJobStatus;
  attempt: number;
  max_attempts: number;
  submitted_at: Date;
  updated_at: Date;
  lease_owner_id: string | null;
  lease_expires_at: Date | null;
  next_attempt_at: Date | null;
  result: RenderResult | null;
  last_error: string | null;
  owner_id: string | null;
}

interface RenderJobEventRow {
  job_id: string;
  type: RenderJobEventType;
  occurred_at: Date;
  attempt: number;
  detail: string | null;
}

function mapRow(row: RenderJobRow): RenderJob {
  return RenderJobSchema.parse({
    contractVersion: row.contract_version,
    jobId: row.job_id,
    idempotencyKey: row.idempotency_key,
    manifest: row.manifest,
    status: row.status,
    attempt: row.attempt,
    maxAttempts: row.max_attempts,
    submittedAt: row.submitted_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    leaseOwnerId: row.lease_owner_id,
    leaseExpiresAt: row.lease_expires_at ? row.lease_expires_at.toISOString() : null,
    nextAttemptAt: row.next_attempt_at ? row.next_attempt_at.toISOString() : null,
    result: row.result,
    lastError: row.last_error
  });
}

function mapEventRow(row: RenderJobEventRow): RenderJobEvent {
  return RenderJobEventSchema.parse({
    jobId: row.job_id,
    type: row.type,
    occurredAt: row.occurred_at.toISOString(),
    attempt: row.attempt,
    detail: row.detail
  });
}

/**
 * PostgreSQL-backed durable counterpart to the in-memory RenderJobQueue.
 * Leasing uses SELECT ... FOR UPDATE SKIP LOCKED so multiple worker
 * processes can safely lease concurrently without double-claiming a job.
 * Retry/dead-letter decisions are delegated to resolveFailureOutcome, the
 * same pure function the in-memory queue uses, so the two implementations
 * cannot silently drift on business rules.
 */
export class PostgresRenderJobStore {
  constructor(private readonly pool: Pool) {}

  /**
   * Evidence the SynaptixPlay backend checks before publishing an adaptive package: which render
   * produced each artifact, whether it completed, for which exact project revision, and its scope
   * kind (the backend accepts only master and stems renders as package audio, never a plug-in
   * freeze of one track).
   */
  async renderEvidence(renderIds: readonly string[], artifactIds: readonly string[]): Promise<RenderEvidence> {
    const renders = await this.pool.query<{ job_id: string; status: RenderJobStatus; manifest: RenderManifest; result: RenderResult | null }>(
      `SELECT job_id, status, manifest, result FROM render_jobs WHERE manifest->>'renderId' = ANY($1::text[])`,
      [renderIds]
    );
    const artifacts = await this.pool.query<{
      job_id: string;
      status: RenderJobStatus;
      manifest: RenderManifest;
      artifact: RenderResult["artifacts"][number];
    }>(
      `SELECT j.job_id, j.status, j.manifest, a AS artifact
         FROM render_jobs j
         CROSS JOIN LATERAL jsonb_array_elements(COALESCE(j.result->'artifacts', '[]'::jsonb)) a
        WHERE a->>'artifactId' = ANY($1::text[])`,
      [artifactIds]
    );
    const source = (manifest: RenderManifest) => ({
      renderId: manifest.renderId,
      projectId: manifest.projectId,
      revisionId: manifest.revisionId,
      projectChecksumSha256: manifest.projectChecksumSha256,
      scopeKind: manifest.scope.kind
    });
    return {
      renders: renders.rows.map((row) => ({
        ...source(row.manifest),
        jobId: row.job_id,
        status: row.status,
        artifactManifestChecksumSha256:
          row.result?.artifacts.find((artifact) => artifact.fileName === "artifact-manifest.json")?.checksumSha256 ?? null
      })),
      artifacts: artifacts.rows.map((row) => ({
        ...source(row.manifest),
        jobId: row.job_id,
        status: row.status,
        artifactId: row.artifact.artifactId,
        fileName: row.artifact.fileName,
        checksumSha256: row.artifact.checksumSha256,
        byteLength: row.artifact.byteLength
      }))
    };
  }

  private async recordEvent(
    executor: Pool | PoolClient,
    jobId: string,
    type: RenderJobEventType,
    attempt: number,
    detail: string | null,
    occurredAt: string
  ): Promise<void> {
    await executor.query(
      `INSERT INTO render_job_events (job_id, type, occurred_at, attempt, detail) VALUES ($1, $2, $3, $4, $5)`,
      [jobId, type, occurredAt, attempt, detail]
    );
  }

  private async loadForUpdate(client: PoolClient, jobId: string): Promise<RenderJobRow> {
    const result = await client.query<RenderJobRow>(`SELECT * FROM render_jobs WHERE job_id = $1 FOR UPDATE`, [jobId]);
    const row = result.rows[0];
    if (!row) throw new Error(`Render job '${jobId}' was not found.`);
    return row;
  }

  private assertOwnedAndRunning(row: RenderJobRow, jobId: string, workerId: string): void {
    if (row.status !== "running") {
      throw new Error(`Render job '${jobId}' is not running (status '${row.status}').`);
    }
    if (row.lease_owner_id !== workerId) {
      throw new Error(`Render job '${jobId}' is not leased by worker '${workerId}'.`);
    }
  }

  /**
   * Queue a render. `ownerId` is the signed-in player the studio submitted it for (null for
   * private callers); an idempotency key can't be reused across owners.
   *
   * With `maxActiveJobsPerOwner`, a player who already has that many queued or running jobs
   * is refused with {@link RenderQuotaExceededError}: one dense stems render can hold a worker
   * for minutes, so a single player must not be able to fill the queue. Private callers are
   * not limited, and replaying an accepted request (same idempotency key) is never refused.
   */
  async submit(
    manifest: RenderManifest,
    idempotencyKey: string,
    maxAttempts = DEFAULT_MAX_ATTEMPTS,
    ownerId: string | null = null,
    maxActiveJobsPerOwner?: number
  ): Promise<RenderJob> {
    if (idempotencyKey.length === 0) throw new Error("idempotencyKey must not be empty.");
    const validatedManifest = RenderManifestSchema.parse(manifest);
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError("maxAttempts must be a positive integer.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      // Serialize one owner's submissions so two concurrent requests can't both pass the limit.
      if (ownerId !== null) await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [ownerId]);

      const replay = await this.existingForKey(client, idempotencyKey, validatedManifest, ownerId);
      if (replay) {
        await client.query("COMMIT");
        return replay;
      }

      if (ownerId !== null && maxActiveJobsPerOwner !== undefined) {
        const active = await client.query<{ count: string }>(
          `SELECT count(*) FROM render_jobs WHERE owner_id = $1 AND status IN ('queued', 'running')`,
          [ownerId]
        );
        if (Number(active.rows[0]!.count) >= maxActiveJobsPerOwner) {
          throw new RenderQuotaExceededError(maxActiveJobsPerOwner);
        }
      }

      const jobId = crypto.randomUUID();
      const timestamp = new Date().toISOString();
      const inserted = await client.query<RenderJobRow>(
        `INSERT INTO render_jobs (
           job_id, idempotency_key, contract_version, manifest, status, attempt,
           max_attempts, submitted_at, updated_at, owner_id
         ) VALUES ($1, $2, $3, $4, 'queued', 0, $5, $6, $6, $7)
         ON CONFLICT (idempotency_key) DO NOTHING
         RETURNING *`,
        [jobId, idempotencyKey, RENDER_JOB_CONTRACT_VERSION, JSON.stringify(validatedManifest), maxAttempts, timestamp, ownerId]
      );
      if (!inserted.rows[0]) {
        // Another caller inserted the same key between the lookup and the insert.
        const raced = await this.existingForKey(client, idempotencyKey, validatedManifest, ownerId);
        await client.query("COMMIT");
        return raced!;
      }
      const job = mapRow(inserted.rows[0]);
      await this.recordEvent(client, job.jobId, "submitted", job.attempt, null, timestamp);
      await client.query("COMMIT");
      return job;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** The job an idempotency key already created, after checking it is the same caller's same render. */
  private async existingForKey(
    client: PoolClient,
    idempotencyKey: string,
    manifest: RenderManifest,
    ownerId: string | null
  ): Promise<RenderJob | undefined> {
    const existing = await client.query<RenderJobRow>(
      `SELECT * FROM render_jobs WHERE idempotency_key = $1`,
      [idempotencyKey]
    );
    const row = existing.rows[0];
    if (!row) return undefined;
    if (row.owner_id !== ownerId) {
      throw new Error(`idempotencyKey '${idempotencyKey}' was already used by another caller.`);
    }
    const job = mapRow(row);
    if (job.manifest.renderId !== manifest.renderId) {
      throw new Error(
        `idempotencyKey '${idempotencyKey}' was already used for a different render (${job.manifest.renderId}).`
      );
    }
    return job;
  }

  async lease(workerId: string, leaseDurationMs = DEFAULT_LEASE_DURATION_MS): Promise<RenderJob | null> {
    if (workerId.length === 0) throw new Error("workerId must not be empty.");
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1) {
      throw new RangeError("leaseDurationMs must be a positive integer.");
    }

    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();

    const result = await this.pool.query<RenderJobRow>(
      `UPDATE render_jobs
       SET status = 'running', attempt = attempt + 1, lease_owner_id = $1,
           lease_expires_at = $2, next_attempt_at = NULL, updated_at = $3
       WHERE job_id = (
         SELECT job_id FROM render_jobs
         WHERE status = 'queued' AND (next_attempt_at IS NULL OR next_attempt_at <= $3)
         ORDER BY submitted_at ASC, job_id ASC
         FOR UPDATE SKIP LOCKED
         LIMIT 1
       )
       RETURNING *`,
      [workerId, leaseExpiresAt, nowIso]
    );

    const row = result.rows[0];
    if (!row) return null;
    const job = mapRow(row);
    await this.recordEvent(this.pool, job.jobId, "leased", job.attempt, `Leased by ${workerId}`, nowIso);
    return job;
  }

  async heartbeat(jobId: string, workerId: string, leaseDurationMs = DEFAULT_LEASE_DURATION_MS): Promise<RenderJob> {
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1) {
      throw new RangeError("leaseDurationMs must be a positive integer.");
    }

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await this.loadForUpdate(client, jobId);
      this.assertOwnedAndRunning(row, jobId, workerId);

      const now = new Date();
      const nowIso = now.toISOString();
      const leaseExpiresAt = new Date(now.getTime() + leaseDurationMs).toISOString();
      const updated = await client.query<RenderJobRow>(
        `UPDATE render_jobs SET lease_expires_at = $1, updated_at = $2 WHERE job_id = $3 RETURNING *`,
        [leaseExpiresAt, nowIso, jobId]
      );
      await this.recordEvent(client, jobId, "heartbeat", row.attempt, null, nowIso);
      await client.query("COMMIT");
      return mapRow(updated.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async reportResult(jobId: string, workerId: string, result: RenderResult): Promise<RenderJob> {
    const validatedResult = RenderResultSchema.parse(result);

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await this.loadForUpdate(client, jobId);
      this.assertOwnedAndRunning(row, jobId, workerId);
      if (validatedResult.renderId !== row.manifest.renderId) {
        throw new Error(
          `Render result renderId '${validatedResult.renderId}' does not match job manifest renderId '${row.manifest.renderId}'.`
        );
      }

      const nowIso = new Date().toISOString();

      if (validatedResult.status === "failed") {
        const outcome = resolveFailureOutcome(row.attempt, row.max_attempts, validatedResult.errorMessage ?? "Render failed.", new Date());
        const updated = await client.query<RenderJobRow>(
          `UPDATE render_jobs
           SET status = $1, next_attempt_at = $2, result = $3, last_error = $4,
               lease_owner_id = NULL, lease_expires_at = NULL, updated_at = $5
           WHERE job_id = $6
           RETURNING *`,
          [outcome.status, outcome.nextAttemptAt, JSON.stringify(validatedResult), validatedResult.errorMessage ?? "Render failed.", nowIso, jobId]
        );
        await this.recordEvent(client, jobId, outcome.eventType, row.attempt, outcome.detail, nowIso);
        await client.query("COMMIT");
        return mapRow(updated.rows[0]!);
      }

      const updated = await client.query<RenderJobRow>(
        `UPDATE render_jobs
         SET status = $1, result = $2, lease_owner_id = NULL, lease_expires_at = NULL,
             next_attempt_at = NULL, updated_at = $3
         WHERE job_id = $4
         RETURNING *`,
        [validatedResult.status, JSON.stringify(validatedResult), nowIso, jobId]
      );
      await this.recordEvent(client, jobId, validatedResult.status === "completed" ? "completed" : "cancelled", row.attempt, null, nowIso);
      await client.query("COMMIT");
      return mapRow(updated.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async fail(jobId: string, workerId: string, errorMessage: string): Promise<RenderJob> {
    if (errorMessage.length === 0) throw new Error("errorMessage must not be empty.");

    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const row = await this.loadForUpdate(client, jobId);
      this.assertOwnedAndRunning(row, jobId, workerId);

      const nowIso = new Date().toISOString();
      const outcome = resolveFailureOutcome(row.attempt, row.max_attempts, errorMessage, new Date());
      const updated = await client.query<RenderJobRow>(
        `UPDATE render_jobs
         SET status = $1, next_attempt_at = $2, last_error = $3,
             lease_owner_id = NULL, lease_expires_at = NULL, updated_at = $4
         WHERE job_id = $5
         RETURNING *`,
        [outcome.status, outcome.nextAttemptAt, errorMessage, nowIso, jobId]
      );
      await this.recordEvent(client, jobId, outcome.eventType, row.attempt, outcome.detail, nowIso);
      await client.query("COMMIT");
      return mapRow(updated.rows[0]!);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async cancel(jobId: string): Promise<RenderJob> {
    const nowIso = new Date().toISOString();
    const result = await this.pool.query<RenderJobRow>(
      `UPDATE render_jobs
       SET status = 'cancelled', lease_owner_id = NULL, lease_expires_at = NULL,
           next_attempt_at = NULL, updated_at = $1
       WHERE job_id = $2 AND status NOT IN ('completed', 'cancelled', 'dead_letter')
       RETURNING *`,
      [nowIso, jobId]
    );

    const row = result.rows[0];
    if (!row) {
      const existing = await this.pool.query<Pick<RenderJobRow, "status">>(
        `SELECT status FROM render_jobs WHERE job_id = $1`,
        [jobId]
      );
      const existingStatus = existing.rows[0]?.status;
      if (!existingStatus) throw new Error(`Render job '${jobId}' was not found.`);
      throw new Error(`Render job '${jobId}' is already terminal (status '${existingStatus}').`);
    }

    const job = mapRow(row);
    await this.recordEvent(this.pool, job.jobId, "cancelled", job.attempt, null, nowIso);
    return job;
  }

  async reclaimExpiredLeases(): Promise<RenderJob[]> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const nowIso = new Date().toISOString();
      const expired = await client.query<RenderJobRow>(
        `SELECT * FROM render_jobs
         WHERE status = 'running' AND lease_expires_at IS NOT NULL AND lease_expires_at <= $1
         FOR UPDATE SKIP LOCKED`,
        [nowIso]
      );

      const reclaimed: RenderJob[] = [];
      for (const row of expired.rows) {
        await this.recordEvent(
          client, row.job_id, "lease_expired", row.attempt,
          `Lease from ${row.lease_owner_id ?? "unknown worker"} expired.`, nowIso
        );
        const outcome = resolveFailureOutcome(row.attempt, row.max_attempts, "Render worker lease expired.", new Date());
        const updated = await client.query<RenderJobRow>(
          `UPDATE render_jobs
           SET status = $1, next_attempt_at = $2, last_error = $3,
               lease_owner_id = NULL, lease_expires_at = NULL, updated_at = $4
           WHERE job_id = $5
           RETURNING *`,
          [outcome.status, outcome.nextAttemptAt, "Render worker lease expired.", nowIso, row.job_id]
        );
        await this.recordEvent(client, row.job_id, outcome.eventType, row.attempt, outcome.detail, nowIso);
        reclaimed.push(mapRow(updated.rows[0]!));
      }

      await client.query("COMMIT");
      return reclaimed;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  /** A job by id; with `ownerId`, only that player's job (so other players' jobs read as missing). */
  async get(jobId: string, ownerId?: string): Promise<RenderJob | undefined> {
    const result = await this.pool.query<RenderJobRow>(
      `SELECT * FROM render_jobs WHERE job_id = $1 AND ($2::text IS NULL OR owner_id = $2)`,
      [jobId, ownerId ?? null]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  /** The job that produced a render (the completed one, if a render was ever resubmitted). */
  async getByRenderId(renderId: string, ownerId?: string): Promise<RenderJob | undefined> {
    const result = await this.pool.query<RenderJobRow>(
      `SELECT * FROM render_jobs WHERE manifest->>'renderId' = $1 AND ($2::text IS NULL OR owner_id = $2)
        ORDER BY (status = 'completed') DESC, submitted_at DESC LIMIT 1`,
      [renderId, ownerId ?? null]
    );
    return result.rows[0] ? mapRow(result.rows[0]) : undefined;
  }

  async list(status?: RenderJobStatus, ownerId?: string): Promise<RenderJob[]> {
    const result = await this.pool.query<RenderJobRow>(
      `SELECT * FROM render_jobs
        WHERE ($1::text IS NULL OR status = $1) AND ($2::text IS NULL OR owner_id = $2)
        ORDER BY submitted_at ASC`,
      [status ?? null, ownerId ?? null]
    );
    return result.rows.map(mapRow);
  }

  async events(jobId?: string): Promise<RenderJobEvent[]> {
    const result = jobId
      ? await this.pool.query<RenderJobEventRow>(`SELECT * FROM render_job_events WHERE job_id = $1 ORDER BY event_id ASC`, [jobId])
      : await this.pool.query<RenderJobEventRow>(`SELECT * FROM render_job_events ORDER BY event_id ASC`);
    return result.rows.map(mapEventRow);
  }
}

interface EvidenceSource {
  renderId: string;
  projectId: string;
  revisionId: string;
  projectChecksumSha256: string;
  scopeKind: RenderManifest["scope"]["kind"];
  jobId: string;
  status: RenderJobStatus;
}

export interface RenderEvidence {
  renders: (EvidenceSource & { artifactManifestChecksumSha256: string | null })[];
  artifacts: (EvidenceSource & { artifactId: string; fileName: string; checksumSha256: string; byteLength: number })[];
}

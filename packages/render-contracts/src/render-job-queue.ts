import {
  computeRetryDelayMs,
  DEFAULT_LEASE_DURATION_MS,
  DEFAULT_MAX_ATTEMPTS,
  RENDER_JOB_CONTRACT_VERSION,
  type RenderJob,
  type RenderJobEvent,
  type RenderJobEventType,
  type RenderJobStatus
} from "./render-job.ts";
import { RenderManifestSchema, RenderResultSchema, type RenderManifest, type RenderResult } from "./render-manifest.ts";

export interface RenderJobQueueOptions {
  now?: () => Date;
  idFactory?: () => string;
  maxAttempts?: number;
  leaseDurationMs?: number;
}

export interface RenderJobSubmitOptions {
  maxAttempts?: number;
}

const TERMINAL_STATUSES: readonly RenderJobStatus[] = ["completed", "cancelled", "dead_letter"];

function isTerminal(status: RenderJobStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

function addMilliseconds(date: Date, ms: number): Date {
  return new Date(date.getTime() + ms);
}

export class RenderJobQueue {
  private readonly jobs = new Map<string, RenderJob>();
  private readonly jobIdByIdempotencyKey = new Map<string, string>();
  private readonly eventLog: RenderJobEvent[] = [];
  private readonly now: () => Date;
  private readonly idFactory: () => string;
  private readonly defaultMaxAttempts: number;
  private readonly defaultLeaseDurationMs: number;

  constructor(options: RenderJobQueueOptions = {}) {
    this.now = options.now ?? (() => new Date());
    this.idFactory = options.idFactory ?? (() => crypto.randomUUID());
    this.defaultMaxAttempts = options.maxAttempts ?? DEFAULT_MAX_ATTEMPTS;
    this.defaultLeaseDurationMs = options.leaseDurationMs ?? DEFAULT_LEASE_DURATION_MS;
    if (!Number.isInteger(this.defaultMaxAttempts) || this.defaultMaxAttempts < 1) {
      throw new RangeError("maxAttempts must be a positive integer.");
    }
    if (!Number.isInteger(this.defaultLeaseDurationMs) || this.defaultLeaseDurationMs < 1) {
      throw new RangeError("leaseDurationMs must be a positive integer.");
    }
  }

  private requireJob(jobId: string): RenderJob {
    const job = this.jobs.get(jobId);
    if (!job) throw new Error(`Render job '${jobId}' was not found.`);
    return job;
  }

  private emit(jobId: string, type: RenderJobEventType, attempt: number, detail: string | null = null): void {
    this.eventLog.push({ jobId, type, occurredAt: this.now().toISOString(), attempt, detail });
  }

  private requireOwnedAndRunning(jobId: string, workerId: string): RenderJob {
    const job = this.requireJob(jobId);
    if (job.status !== "running") {
      throw new Error(`Render job '${jobId}' is not running (status '${job.status}').`);
    }
    if (job.leaseOwnerId !== workerId) {
      throw new Error(`Render job '${jobId}' is not leased by worker '${workerId}'.`);
    }
    return job;
  }

  private scheduleRetryOrDeadLetter(job: RenderJob, errorMessage: string, result: RenderResult | null): void {
    const timestamp = this.now();
    job.lastError = errorMessage;
    job.result = result ?? job.result;
    job.updatedAt = timestamp.toISOString();
    job.leaseOwnerId = null;
    job.leaseExpiresAt = null;

    if (job.attempt >= job.maxAttempts) {
      job.status = "dead_letter";
      job.nextAttemptAt = null;
      this.emit(job.jobId, "dead_lettered", job.attempt, errorMessage);
      return;
    }

    const delayMs = computeRetryDelayMs(job.attempt);
    job.status = "queued";
    job.nextAttemptAt = addMilliseconds(timestamp, delayMs).toISOString();
    this.emit(job.jobId, "retry_scheduled", job.attempt, `Retrying in ${delayMs}ms: ${errorMessage}`);
  }

  submit(manifest: RenderManifest, idempotencyKey: string, options: RenderJobSubmitOptions = {}): RenderJob {
    if (idempotencyKey.length === 0) throw new Error("idempotencyKey must not be empty.");
    const validatedManifest = RenderManifestSchema.parse(manifest);

    const existingJobId = this.jobIdByIdempotencyKey.get(idempotencyKey);
    if (existingJobId) {
      const existing = this.requireJob(existingJobId);
      if (existing.manifest.renderId !== validatedManifest.renderId) {
        throw new Error(
          `idempotencyKey '${idempotencyKey}' was already used for a different render (${existing.manifest.renderId}).`
        );
      }
      return existing;
    }

    const maxAttempts = options.maxAttempts ?? this.defaultMaxAttempts;
    if (!Number.isInteger(maxAttempts) || maxAttempts < 1) {
      throw new RangeError("maxAttempts must be a positive integer.");
    }

    const timestamp = this.now().toISOString();
    const job: RenderJob = {
      contractVersion: RENDER_JOB_CONTRACT_VERSION,
      jobId: this.idFactory(),
      idempotencyKey,
      manifest: validatedManifest,
      status: "queued",
      attempt: 0,
      maxAttempts,
      submittedAt: timestamp,
      updatedAt: timestamp,
      leaseOwnerId: null,
      leaseExpiresAt: null,
      nextAttemptAt: null,
      result: null,
      lastError: null
    };

    this.jobs.set(job.jobId, job);
    this.jobIdByIdempotencyKey.set(idempotencyKey, job.jobId);
    this.emit(job.jobId, "submitted", job.attempt);
    return job;
  }

  lease(workerId: string, leaseDurationMs = this.defaultLeaseDurationMs): RenderJob | null {
    if (workerId.length === 0) throw new Error("workerId must not be empty.");
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1) {
      throw new RangeError("leaseDurationMs must be a positive integer.");
    }

    const currentNow = this.now();
    const eligible = [...this.jobs.values()]
      .filter((job) => job.status === "queued" && (!job.nextAttemptAt || job.nextAttemptAt <= currentNow.toISOString()))
      .sort((left, right) => left.submittedAt.localeCompare(right.submittedAt) || left.jobId.localeCompare(right.jobId));

    const job = eligible[0];
    if (!job) return null;

    job.attempt += 1;
    job.status = "running";
    job.leaseOwnerId = workerId;
    job.leaseExpiresAt = addMilliseconds(currentNow, leaseDurationMs).toISOString();
    job.nextAttemptAt = null;
    job.updatedAt = currentNow.toISOString();
    this.emit(job.jobId, "leased", job.attempt, `Leased by ${workerId}`);
    return job;
  }

  heartbeat(jobId: string, workerId: string, leaseDurationMs = this.defaultLeaseDurationMs): RenderJob {
    if (!Number.isInteger(leaseDurationMs) || leaseDurationMs < 1) {
      throw new RangeError("leaseDurationMs must be a positive integer.");
    }
    const job = this.requireOwnedAndRunning(jobId, workerId);
    const currentNow = this.now();
    job.leaseExpiresAt = addMilliseconds(currentNow, leaseDurationMs).toISOString();
    job.updatedAt = currentNow.toISOString();
    this.emit(job.jobId, "heartbeat", job.attempt);
    return job;
  }

  reportResult(jobId: string, workerId: string, result: RenderResult): RenderJob {
    const job = this.requireOwnedAndRunning(jobId, workerId);
    const validatedResult = RenderResultSchema.parse(result);
    if (validatedResult.renderId !== job.manifest.renderId) {
      throw new Error(`Render result renderId '${validatedResult.renderId}' does not match job manifest renderId '${job.manifest.renderId}'.`);
    }

    if (validatedResult.status === "failed") {
      this.scheduleRetryOrDeadLetter(job, validatedResult.errorMessage ?? "Render failed.", validatedResult);
      return job;
    }

    const timestamp = this.now().toISOString();
    job.status = validatedResult.status;
    job.result = validatedResult;
    job.updatedAt = timestamp;
    job.leaseOwnerId = null;
    job.leaseExpiresAt = null;
    job.nextAttemptAt = null;
    this.emit(job.jobId, validatedResult.status === "completed" ? "completed" : "cancelled", job.attempt);
    return job;
  }

  fail(jobId: string, workerId: string, errorMessage: string): RenderJob {
    if (errorMessage.length === 0) throw new Error("errorMessage must not be empty.");
    const job = this.requireOwnedAndRunning(jobId, workerId);
    this.scheduleRetryOrDeadLetter(job, errorMessage, null);
    return job;
  }

  cancel(jobId: string): RenderJob {
    const job = this.requireJob(jobId);
    if (isTerminal(job.status)) {
      throw new Error(`Render job '${jobId}' is already terminal (status '${job.status}').`);
    }
    job.status = "cancelled";
    job.leaseOwnerId = null;
    job.leaseExpiresAt = null;
    job.nextAttemptAt = null;
    job.updatedAt = this.now().toISOString();
    this.emit(job.jobId, "cancelled", job.attempt);
    return job;
  }

  reclaimExpiredLeases(): RenderJob[] {
    const currentNowIso = this.now().toISOString();
    const reclaimed: RenderJob[] = [];
    for (const job of this.jobs.values()) {
      if (job.status !== "running" || !job.leaseExpiresAt || job.leaseExpiresAt > currentNowIso) continue;
      this.emit(job.jobId, "lease_expired", job.attempt, `Lease from ${job.leaseOwnerId ?? "unknown worker"} expired.`);
      this.scheduleRetryOrDeadLetter(job, "Render worker lease expired.", null);
      reclaimed.push(job);
    }
    return reclaimed;
  }

  get(jobId: string): RenderJob | undefined {
    return this.jobs.get(jobId);
  }

  list(status?: RenderJobStatus): RenderJob[] {
    const all = [...this.jobs.values()];
    return status ? all.filter((job) => job.status === status) : all;
  }

  events(jobId?: string): RenderJobEvent[] {
    return jobId ? this.eventLog.filter((event) => event.jobId === jobId) : [...this.eventLog];
  }
}

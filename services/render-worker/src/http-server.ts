import { timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { RenderManifestSchema, type RenderJobStatus } from "@synaptix/render-contracts";
import { z, ZodError } from "zod";

import { assertWorkerEngine, EngineVersionMismatchError } from "./engine-version.ts";
import type { ArtifactDelivery } from "./minio-artifact-store.ts";
import { RenderQuotaExceededError, type PostgresRenderJobStore } from "./postgres-render-job-store.ts";

interface ErrorEnvelope {
  code: string;
  message: string;
  correlationId: string;
  retryable: boolean;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload)
  });
  res.end(payload);
}

function sendError(
  res: ServerResponse,
  status: number,
  code: string,
  message: string,
  correlationId: string,
  retryable = false
): void {
  sendJson(res, status, { code, message, correlationId, retryable } satisfies ErrorEnvelope);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : null;
}

function isRenderJobStatus(value: string | null): value is RenderJobStatus {
  return (
    value !== null &&
    ["queued", "running", "completed", "failed", "cancelled", "dead_letter"].includes(value)
  );
}

/**
 * Private, server-to-server HTTP API for the render-job control plane.
 * Not internet-facing: reached only by the Next.js BFF, which owns end-user
 * authentication (matching how the Python generation-api service is a
 * private dependency, not directly exposed to the browser).
 */
export interface RenderJobHttpServerOptions {
  /**
   * Shared with the SynaptixPlay backend (ServiceTokens:RenderWorker). Required for the
   * /internal routes the backend calls; they answer 503 without it.
   */
  serviceToken?: string;
  /**
   * Most queued-or-running jobs one player may have (RENDER_MAX_ACTIVE_JOBS_PER_OWNER). A
   * submission over it answers 429 render_quota_exceeded. Private callers are not limited.
   */
  maxActiveJobsPerOwner?: number;
}

/**
 * Most queued-or-running render jobs one player may have. Default 10 (a package export is a
 * master and its stems per state); 0 turns the limit off.
 */
export function maxActiveJobsPerOwnerFromEnv(raw: string | undefined): number | undefined {
  if (raw === undefined || raw.trim() === "") return 10;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new Error("RENDER_MAX_ACTIVE_JOBS_PER_OWNER must be a whole number (0 turns the limit off).");
  }
  return value === 0 ? undefined : value;
}

export function createRenderJobHttpServer(
  store: PostgresRenderJobStore,
  artifactDelivery?: ArtifactDelivery,
  options: RenderJobHttpServerOptions = {}
): Server {
  return createServer((req, res) => {
    void handleRequest(store, artifactDelivery, options, req, res);
  });
}

const RenderEvidenceRequestSchema = z.object({
  renderIds: z.array(z.string().uuid()).max(50),
  artifactIds: z.array(z.string().uuid()).max(500)
});

function isServiceAuthorized(req: IncomingMessage, expected: string): boolean {
  const supplied = Buffer.from(req.headers["x-service-token"]?.toString() ?? "");
  const wanted = Buffer.from(expected);
  return supplied.length === wanted.length && timingSafeEqual(supplied, wanted);
}

/**
 * The player a request acts for. The studio's BFF sets it after verifying the player's session
 * with the platform; every read and write is then scoped to that player. The worker is only
 * reachable on the private network, so requests without it (certification tooling, operators)
 * stay unscoped.
 */
export const RENDER_OWNER_HEADER = "x-synaptix-owner";

function renderOwner(req: IncomingMessage): string | undefined {
  const value = req.headers[RENDER_OWNER_HEADER];
  if (value === undefined) return undefined;
  const owner = (Array.isArray(value) ? value.join(",") : value).trim();
  if (owner.length === 0 || owner.length > 200 || owner.includes(",")) {
    throw new Error("The render owner header is invalid.");
  }
  return owner;
}

async function handleRequest(
  store: PostgresRenderJobStore,
  artifactDelivery: ArtifactDelivery | undefined,
  options: RenderJobHttpServerOptions,
  req: IncomingMessage,
  res: ServerResponse
): Promise<void> {
  const correlationId = req.headers["x-correlation-id"]?.toString() ?? crypto.randomUUID();
  const url = new URL(req.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);

  try {
    const owner = renderOwner(req);
    if (req.method === "POST" && url.pathname === "/internal/render-evidence") {
      if (!options.serviceToken) {
        return sendError(res, 503, "service_authentication_unavailable", "Render-worker service authentication is not configured.", correlationId);
      }
      if (!isServiceAuthorized(req, options.serviceToken)) {
        return sendError(res, 401, "service_authentication_required", "A valid render-worker service token is required.", correlationId);
      }
      const request = RenderEvidenceRequestSchema.parse(await readJsonBody(req));
      return sendJson(res, 200, await store.renderEvidence(request.renderIds, request.artifactIds));
    }
    if (req.method === "POST" && segments.length === 1 && segments[0] === "render-jobs") {
      await handleSubmit(store, req, res, correlationId, owner ?? null, options.maxActiveJobsPerOwner);
      return;
    }
    if (req.method === "GET" && segments.length === 1 && segments[0] === "render-jobs") {
      const statusParam = url.searchParams.get("status");
      if (statusParam !== null && !isRenderJobStatus(statusParam)) {
        return sendError(
          res,
          400,
          "invalid_status_filter",
          `Unknown status '${statusParam}'.`,
          correlationId
        );
      }
      const jobs = await store.list(statusParam ?? undefined, owner);
      return sendJson(res, 200, { jobs });
    }
    if (req.method === "GET" && segments.length === 2 && segments[0] === "renders") {
      // Frozen plug-in references name a render, not a job; this resolves one to the other.
      const job = await store.getByRenderId(segments[1]!, owner);
      if (!job) return sendError(res, 404, "render_not_found", `Render '${segments[1]}' was not found.`, correlationId);
      return sendJson(res, 200, job);
    }
    if (req.method === "GET" && segments.length === 2 && segments[0] === "render-jobs") {
      const job = await store.get(segments[1]!, owner);
      if (!job)
        return sendError(
          res,
          404,
          "render_job_not_found",
          `Render job '${segments[1]}' was not found.`,
          correlationId
        );
      return sendJson(res, 200, job);
    }
    if (
      req.method === "GET" &&
      segments.length === 3 &&
      segments[0] === "render-jobs" &&
      segments[2] === "events"
    ) {
      if (owner && !(await store.get(segments[1]!, owner))) {
        return sendError(res, 404, "render_job_not_found", `Render job '${segments[1]}' was not found.`, correlationId);
      }
      const events = await store.events(segments[1]!);
      return sendJson(res, 200, { events });
    }
    if (
      req.method === "GET" &&
      segments.length === 5 &&
      segments[0] === "render-jobs" &&
      segments[2] === "artifacts" &&
      segments[4] === "download-url"
    ) {
      if (!artifactDelivery) {
        return sendError(
          res,
          503,
          "artifact_delivery_unavailable",
          "Artifact delivery is not configured.",
          correlationId,
          true
        );
      }
      const job = await store.get(segments[1]!, owner);
      if (!job)
        return sendError(
          res,
          404,
          "render_job_not_found",
          `Render job '${segments[1]}' was not found.`,
          correlationId
        );
      const artifact = job.result?.artifacts.find(
        (candidate) => candidate.artifactId === segments[3]
      );
      if (!artifact) {
        return sendError(
          res,
          404,
          "render_artifact_not_found",
          `Artifact '${segments[3]}' was not found.`,
          correlationId
        );
      }
      const downloadUrl = await artifactDelivery.createDownloadUrl(
        artifact.renderId,
        artifact.fileName
      );
      return sendJson(res, 200, { artifactId: artifact.artifactId, downloadUrl });
    }
    if (
      req.method === "POST" &&
      segments.length === 3 &&
      segments[0] === "render-jobs" &&
      segments[2] === "cancel"
    ) {
      if (owner && !(await store.get(segments[1]!, owner))) {
        return sendError(res, 404, "render_job_not_found", `Render job '${segments[1]}' was not found.`, correlationId);
      }
      const job = await store.cancel(segments[1]!);
      return sendJson(res, 200, job);
    }
    sendError(res, 404, "not_found", "Route not found.", correlationId);
  } catch (error) {
    handleError(res, error, correlationId);
  }
}

async function handleSubmit(
  store: PostgresRenderJobStore,
  req: IncomingMessage,
  res: ServerResponse,
  correlationId: string,
  owner: string | null,
  maxActiveJobsPerOwner: number | undefined
): Promise<void> {
  const idempotencyKey = req.headers["idempotency-key"]?.toString();
  if (!idempotencyKey) {
    return sendError(
      res,
      400,
      "idempotency_key_required",
      "Idempotency-Key header is required.",
      correlationId
    );
  }

  const body = (await readJsonBody(req)) as { manifest?: unknown; maxAttempts?: number } | null;
  if (!body?.manifest) {
    return sendError(
      res,
      400,
      "invalid_render_job_request",
      "A render manifest is required.",
      correlationId
    );
  }

  const manifest = RenderManifestSchema.parse(body.manifest);
  assertWorkerEngine(manifest);
  const job = await store.submit(manifest, idempotencyKey, body.maxAttempts, owner, maxActiveJobsPerOwner);
  sendJson(res, 201, job);
}

// Business-rule failures are plain Error instances distinguished by message
// (matching the render-job store's existing error-handling convention); Zod
// parse failures and JSON syntax errors are client input errors (400).
function handleError(res: ServerResponse, error: unknown, correlationId: string): void {
  if (error instanceof EngineVersionMismatchError) {
    return sendError(res, 409, "engine_version_mismatch", error.message, correlationId);
  }
  if (error instanceof RenderQuotaExceededError) {
    return sendError(res, 429, "render_quota_exceeded", error.message, correlationId);
  }
  if (error instanceof ZodError) {
    return sendError(
      res,
      400,
      "invalid_render_job_request",
      error.issues.map((issue) => issue.message).join("; "),
      correlationId
    );
  }
  if (error instanceof SyntaxError) {
    return sendError(
      res,
      400,
      "invalid_json_body",
      "The request body is not valid JSON.",
      correlationId
    );
  }

  const message = error instanceof Error ? error.message : "Unexpected error.";
  if (message.includes("was not found"))
    return sendError(res, 404, "render_job_not_found", message, correlationId);
  if (
    message.includes("already terminal") ||
    message.includes("already used for a different render") ||
    message.includes("already used by another caller")
  ) {
    return sendError(res, 409, "render_job_conflict", message, correlationId);
  }
  sendError(res, 400, "invalid_render_job_request", message, correlationId);
}

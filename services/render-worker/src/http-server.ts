import { createServer, type IncomingMessage, type Server, type ServerResponse } from "node:http";

import { RenderManifestSchema, type RenderJobStatus } from "@synaptix/render-contracts";
import { ZodError } from "zod";

import type { PostgresRenderJobStore } from "./postgres-render-job-store.ts";

interface ErrorEnvelope {
  code: string;
  message: string;
  correlationId: string;
  retryable: boolean;
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json", "content-length": Buffer.byteLength(payload) });
  res.end(payload);
}

function sendError(res: ServerResponse, status: number, code: string, message: string, correlationId: string, retryable = false): void {
  sendJson(res, status, { code, message, correlationId, retryable } satisfies ErrorEnvelope);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  const raw = Buffer.concat(chunks).toString("utf8");
  return raw.length > 0 ? JSON.parse(raw) : null;
}

function isRenderJobStatus(value: string | null): value is RenderJobStatus {
  return value !== null && ["queued", "running", "completed", "failed", "cancelled", "dead_letter"].includes(value);
}

/**
 * Private, server-to-server HTTP API for the render-job control plane.
 * Not internet-facing: reached only by the Next.js BFF, which owns end-user
 * authentication (matching how the Python generation-api service is a
 * private dependency, not directly exposed to the browser).
 */
export function createRenderJobHttpServer(store: PostgresRenderJobStore): Server {
  return createServer((req, res) => {
    void handleRequest(store, req, res);
  });
}

async function handleRequest(store: PostgresRenderJobStore, req: IncomingMessage, res: ServerResponse): Promise<void> {
  const correlationId = req.headers["x-correlation-id"]?.toString() ?? crypto.randomUUID();
  const url = new URL(req.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);

  try {
    if (req.method === "POST" && segments.length === 1 && segments[0] === "render-jobs") {
      await handleSubmit(store, req, res, correlationId);
      return;
    }
    if (req.method === "GET" && segments.length === 1 && segments[0] === "render-jobs") {
      const statusParam = url.searchParams.get("status");
      if (statusParam !== null && !isRenderJobStatus(statusParam)) {
        return sendError(res, 400, "invalid_status_filter", `Unknown status '${statusParam}'.`, correlationId);
      }
      const jobs = await store.list(statusParam ?? undefined);
      return sendJson(res, 200, { jobs });
    }
    if (req.method === "GET" && segments.length === 2 && segments[0] === "render-jobs") {
      const job = await store.get(segments[1]!);
      if (!job) return sendError(res, 404, "render_job_not_found", `Render job '${segments[1]}' was not found.`, correlationId);
      return sendJson(res, 200, job);
    }
    if (req.method === "GET" && segments.length === 3 && segments[0] === "render-jobs" && segments[2] === "events") {
      const events = await store.events(segments[1]!);
      return sendJson(res, 200, { events });
    }
    if (req.method === "POST" && segments.length === 3 && segments[0] === "render-jobs" && segments[2] === "cancel") {
      const job = await store.cancel(segments[1]!);
      return sendJson(res, 200, job);
    }

    sendError(res, 404, "not_found", "Route not found.", correlationId);
  } catch (error) {
    handleError(res, error, correlationId);
  }
}

async function handleSubmit(store: PostgresRenderJobStore, req: IncomingMessage, res: ServerResponse, correlationId: string): Promise<void> {
  const idempotencyKey = req.headers["idempotency-key"]?.toString();
  if (!idempotencyKey) {
    return sendError(res, 400, "idempotency_key_required", "Idempotency-Key header is required.", correlationId);
  }

  const body = (await readJsonBody(req)) as { manifest?: unknown; maxAttempts?: number } | null;
  if (!body?.manifest) {
    return sendError(res, 400, "invalid_render_job_request", "A render manifest is required.", correlationId);
  }

  const manifest = RenderManifestSchema.parse(body.manifest);
  const job = await store.submit(manifest, idempotencyKey, body.maxAttempts);
  sendJson(res, 201, job);
}

// Business-rule failures are plain Error instances distinguished by message
// (matching the render-job store's existing error-handling convention); Zod
// parse failures and JSON syntax errors are client input errors (400).
function handleError(res: ServerResponse, error: unknown, correlationId: string): void {
  if (error instanceof ZodError) {
    return sendError(res, 400, "invalid_render_job_request", error.issues.map((issue) => issue.message).join("; "), correlationId);
  }
  if (error instanceof SyntaxError) {
    return sendError(res, 400, "invalid_json_body", "The request body is not valid JSON.", correlationId);
  }

  const message = error instanceof Error ? error.message : "Unexpected error.";
  if (message.includes("was not found")) return sendError(res, 404, "render_job_not_found", message, correlationId);
  if (message.includes("already terminal") || message.includes("already used for a different render")) {
    return sendError(res, 409, "render_job_conflict", message, correlationId);
  }
  sendError(res, 400, "invalid_render_job_request", message, correlationId);
}

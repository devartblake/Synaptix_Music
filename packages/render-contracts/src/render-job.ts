import { z } from "zod";

import { RenderManifestSchema, RenderResultSchema } from "./render-manifest.ts";

export const RENDER_JOB_CONTRACT_VERSION = "1.0.0" as const;

export const RenderJobStatusSchema = z.enum([
  "queued",
  "running",
  "completed",
  "failed",
  "cancelled",
  "dead_letter"
]);

export const RenderJobSchema = z.object({
  contractVersion: z.literal(RENDER_JOB_CONTRACT_VERSION),
  jobId: z.string().uuid(),
  idempotencyKey: z.string().min(1),
  manifest: RenderManifestSchema,
  status: RenderJobStatusSchema,
  attempt: z.number().int().nonnegative(),
  maxAttempts: z.number().int().positive(),
  submittedAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
  leaseOwnerId: z.string().min(1).nullable(),
  leaseExpiresAt: z.string().datetime().nullable(),
  nextAttemptAt: z.string().datetime().nullable(),
  result: RenderResultSchema.nullable(),
  lastError: z.string().nullable()
}).strict();

export type RenderJob = z.infer<typeof RenderJobSchema>;
export type RenderJobStatus = z.infer<typeof RenderJobStatusSchema>;

export const RenderJobEventTypeSchema = z.enum([
  "submitted",
  "leased",
  "heartbeat",
  "completed",
  "cancelled",
  "retry_scheduled",
  "dead_lettered",
  "lease_expired"
]);

export const RenderJobEventSchema = z.object({
  jobId: z.string().uuid(),
  type: RenderJobEventTypeSchema,
  occurredAt: z.string().datetime(),
  attempt: z.number().int().nonnegative(),
  detail: z.string().nullable()
}).strict();

export type RenderJobEvent = z.infer<typeof RenderJobEventSchema>;
export type RenderJobEventType = z.infer<typeof RenderJobEventTypeSchema>;

export const DEFAULT_MAX_ATTEMPTS = 5;
export const DEFAULT_LEASE_DURATION_MS = 60_000;
export const DEFAULT_RETRY_BASE_DELAY_MS = 2_000;
export const DEFAULT_RETRY_MAX_DELAY_MS = 5 * 60_000;

export function computeRetryDelayMs(
  attempt: number,
  baseDelayMs = DEFAULT_RETRY_BASE_DELAY_MS,
  maxDelayMs = DEFAULT_RETRY_MAX_DELAY_MS
): number {
  if (!Number.isInteger(attempt) || attempt < 1) {
    throw new Error("attempt must be a positive integer.");
  }
  const exponential = baseDelayMs * 2 ** (attempt - 1);
  return Math.min(exponential, maxDelayMs);
}

import { GenerationRequestSchema, GenerationProposalSchema } from "@synaptix/generator-contracts";
import { z } from "zod";

const IdSchema = z.string().min(1);
const IsoDateSchema = z.string().datetime({ offset: true });

export const PlatformUserSchema = z.object({
  userId: IdSchema,
  displayName: z.string().min(1),
  roles: z.array(z.string().min(1)),
  tenantId: IdSchema.optional()
});

export const MusicEntitlementsSchema = z.object({
  canCreateProjects: z.boolean(),
  canGenerateMusic: z.boolean(),
  canRenderAudio: z.boolean(),
  maxProjects: z.number().int().nonnegative(),
  maxStorageBytes: z.number().int().nonnegative(),
  generationCredits: z.number().int().nonnegative()
});

export const ProjectAccessSchema = z.object({
  projectId: IdSchema,
  ownerUserId: IdSchema,
  access: z.enum(["owner", "editor", "viewer"]),
  canGenerate: z.boolean(),
  canRender: z.boolean()
});

export const GenerationJobRequestSchema = z.object({
  idempotencyKey: IdSchema,
  correlationId: IdSchema,
  projectId: IdSchema,
  expectedRevisionId: IdSchema,
  generation: GenerationRequestSchema,
  requestedAt: IsoDateSchema
});

export const GenerationJobStatusSchema = z.enum([
  "queued",
  "running",
  "retryScheduled",
  "completed",
  "failed",
  "deadLetter",
  "cancelled"
]);

export const GenerationJobSchema = z.object({
  jobId: IdSchema,
  projectId: IdSchema,
  playerId: IdSchema,
  expectedRevisionId: IdSchema,
  status: GenerationJobStatusSchema,
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema,
  result: GenerationProposalSchema.nullable().optional(),
  errorCode: z.string().min(1).nullable().optional(),
  errorMessage: z.string().min(1).nullable().optional(),
  correlationId: IdSchema,
  reservationId: IdSchema.nullable().optional(),
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: IsoDateSchema.nullable().optional()
});

const RealtimeStatusSchema = z.string().transform((value, context) => {
  const normalized = value.charAt(0).toLowerCase() + value.slice(1);
  const parsed = GenerationJobStatusSchema.safeParse(normalized);
  if (!parsed.success) {
    context.addIssue({ code: "custom", message: `Unsupported generation status '${value}'.` });
    return z.NEVER;
  }
  return parsed.data;
});

export const GenerationJobStatusEventSchema = z.object({
  jobId: IdSchema,
  projectId: IdSchema,
  status: RealtimeStatusSchema,
  updatedAt: IsoDateSchema,
  attemptCount: z.number().int().nonnegative(),
  nextAttemptAt: IsoDateSchema.nullable().optional(),
  result: GenerationProposalSchema.nullable().optional(),
  errorCode: z.string().min(1).nullable().optional(),
  errorMessage: z.string().min(1).nullable().optional(),
  correlationId: IdSchema
});

export const PlatformErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  correlationId: IdSchema.optional().default("unknown"),
  retryable: z.boolean().optional().default(false)
});

export const TerminalGenerationJobStatuses = new Set([
  "completed",
  "failed",
  "deadLetter",
  "cancelled"
] as const);

export type PlatformUser = z.infer<typeof PlatformUserSchema>;
export type MusicEntitlements = z.infer<typeof MusicEntitlementsSchema>;
export type ProjectAccess = z.infer<typeof ProjectAccessSchema>;
export type GenerationJobRequest = z.infer<typeof GenerationJobRequestSchema>;
export type GenerationJobStatus = z.infer<typeof GenerationJobStatusSchema>;
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
export type GenerationJobStatusEvent = z.infer<typeof GenerationJobStatusEventSchema>;
export type PlatformError = z.infer<typeof PlatformErrorSchema>;

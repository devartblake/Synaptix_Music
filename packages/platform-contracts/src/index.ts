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

export const CreditReservationSchema = z.object({
  reservationId: IdSchema,
  amount: z.number().int().positive(),
  status: z.enum(["reserved", "committed", "released", "expired"]),
  expiresAt: IsoDateSchema
});

export const GenerationJobSchema = z.object({
  jobId: IdSchema,
  projectId: IdSchema,
  status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
  reservation: CreditReservationSchema,
  proposal: GenerationProposalSchema.optional(),
  failureCode: z.string().min(1).optional(),
  failureMessage: z.string().min(1).optional(),
  createdAt: IsoDateSchema,
  updatedAt: IsoDateSchema
});

export const PlatformErrorSchema = z.object({
  code: z.string().min(1),
  message: z.string().min(1),
  correlationId: IdSchema,
  retryable: z.boolean().default(false)
});

export type PlatformUser = z.infer<typeof PlatformUserSchema>;
export type MusicEntitlements = z.infer<typeof MusicEntitlementsSchema>;
export type ProjectAccess = z.infer<typeof ProjectAccessSchema>;
export type GenerationJobRequest = z.infer<typeof GenerationJobRequestSchema>;
export type GenerationJob = z.infer<typeof GenerationJobSchema>;
export type PlatformError = z.infer<typeof PlatformErrorSchema>;

import { z } from "zod";

const IdSchema = z.string().min(1);
const UuidSchema = z.string().uuid();
const ChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/);
const IsoDateSchema = z.string().datetime({ offset: true });

export const AdaptivePackageArtifactInputSchema = z.object({
  artifactId: UuidSchema,
  storageKey: z.string().min(1).max(500),
  mediaType: z.string().min(1).max(120),
  checksumSha256: ChecksumSchema,
  byteLength: z.number().int().nonnegative()
}).strict();

export const PublishAdaptivePackageRequestSchema = z.object({
  packageId: UuidSchema,
  projectId: UuidSchema,
  revisionId: IdSchema,
  projectChecksumSha256: ChecksumSchema,
  name: z.string().min(1).max(200),
  manifest: z.unknown(),
  artifacts: z.array(AdaptivePackageArtifactInputSchema).min(1)
}).strict();

export const AdaptivePackagePublishOutcomeSchema = z.enum([
  "accepted",
  "alreadyPublished",
  "forbidden",
  "revisionNotFound",
  "conflict"
]);

export const AdaptivePackagePublishResponseSchema = z.object({
  outcome: AdaptivePackagePublishOutcomeSchema,
  packageId: UuidSchema,
  version: z.number().int().nonnegative(),
  errorMessage: z.string().nullable()
}).strict();

export const AdaptivePackageSummarySchema = z.object({
  packageId: UuidSchema,
  projectId: UuidSchema,
  name: z.string().min(1),
  currentVersion: z.number().int().positive(),
  updatedAt: IsoDateSchema
}).strict();

export const AdaptivePackageVersionSummarySchema = z.object({
  version: z.number().int().positive(),
  revisionId: IdSchema,
  projectChecksumSha256: ChecksumSchema,
  createdAt: IsoDateSchema
}).strict();

export const AdaptivePackageVersionSchema = z.object({
  packageId: UuidSchema,
  version: z.number().int().positive(),
  projectId: UuidSchema,
  revisionId: IdSchema,
  projectChecksumSha256: ChecksumSchema,
  manifest: z.unknown(),
  createdAt: IsoDateSchema
}).strict();

export const AdaptivePackageDeliveryGrantRequestSchema = z.object({
  artifactId: UuidSchema,
  lifetimeSeconds: z.number().int().min(30).max(900).optional()
}).strict();

export const AdaptivePackageDeliveryGrantSchema = z.object({
  packageId: UuidSchema,
  version: z.number().int().positive(),
  artifactId: UuidSchema,
  url: z.string().startsWith("/"),
  expiresAt: IsoDateSchema,
  checksumSha256: ChecksumSchema,
  byteLength: z.number().int().nonnegative(),
  mediaType: z.string().min(1)
}).strict();

export const AdaptivePackageListSchema = z.array(AdaptivePackageSummarySchema);
export const AdaptivePackageVersionListSchema = z.array(AdaptivePackageVersionSummarySchema);

export type PublishAdaptivePackageRequest = z.infer<typeof PublishAdaptivePackageRequestSchema>;
export type AdaptivePackagePublishResponse = z.infer<typeof AdaptivePackagePublishResponseSchema>;
export type AdaptivePackageSummary = z.infer<typeof AdaptivePackageSummarySchema>;
export type AdaptivePackageVersionSummary = z.infer<typeof AdaptivePackageVersionSummarySchema>;
export type AdaptivePackageVersion = z.infer<typeof AdaptivePackageVersionSchema>;
export type AdaptivePackageDeliveryGrantRequest = z.infer<typeof AdaptivePackageDeliveryGrantRequestSchema>;
export type AdaptivePackageDeliveryGrant = z.infer<typeof AdaptivePackageDeliveryGrantSchema>;

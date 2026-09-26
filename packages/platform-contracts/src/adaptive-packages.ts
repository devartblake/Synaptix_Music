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
  artifacts: z.array(AdaptivePackageArtifactInputSchema).min(1),
  expiresAt: IsoDateSchema.optional()
}).strict();

// The platform serializes .NET enums by member name ("Accepted"); normalize to camelCase.
function camelEnum<const T extends readonly [string, ...string[]]>(values: T) {
  return z.preprocess(
    (value) => typeof value === "string" ? value.charAt(0).toLowerCase() + value.slice(1) : value,
    z.enum(values)
  );
}

export const AdaptivePackageRetentionStatusSchema = z.enum([
  "pending",
  "active",
  "superseded",
  "revoked",
  "expired"
]);

export const AdaptivePackageArtifactDescriptorSchema = z.object({
  artifactId: UuidSchema,
  mediaType: z.string().min(1),
  checksumSha256: ChecksumSchema,
  byteLength: z.number().int().positive()
}).strict();

export const AdaptivePackagePublishOutcomeSchema = camelEnum([
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
  createdAt: IsoDateSchema,
  retentionStatus: AdaptivePackageRetentionStatusSchema,
  expiresAt: IsoDateSchema.nullable()
}).strict();

export const AdaptivePackageVersionSchema = z.object({
  packageId: UuidSchema,
  version: z.number().int().positive(),
  projectId: UuidSchema,
  revisionId: IdSchema,
  projectChecksumSha256: ChecksumSchema,
  manifest: z.unknown(),
  createdAt: IsoDateSchema,
  retentionStatus: AdaptivePackageRetentionStatusSchema,
  expiresAt: IsoDateSchema.nullable(),
  artifacts: z.array(AdaptivePackageArtifactDescriptorSchema)
}).strict();

export const RevokeAdaptivePackageVersionRequestSchema = z.object({
  reason: z.string().trim().min(1).max(500)
}).strict();

export const AdaptivePackageRevokeResponseSchema = z.object({
  outcome: camelEnum(["revoked", "alreadyRevoked", "forbidden", "notFound"]),
  packageId: UuidSchema,
  version: z.number().int().positive(),
  restoredVersion: z.number().int().positive().nullable()
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
export type AdaptivePackageRetentionStatus = z.infer<typeof AdaptivePackageRetentionStatusSchema>;
export type RevokeAdaptivePackageVersionRequest = z.infer<typeof RevokeAdaptivePackageVersionRequestSchema>;
export type AdaptivePackageRevokeResponse = z.infer<typeof AdaptivePackageRevokeResponseSchema>;

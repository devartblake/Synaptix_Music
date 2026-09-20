import { z } from "zod";

import {
  RenderArtifactSchema,
  RenderFormatSchema,
  RenderRangeSchema,
  RenderScopeSchema
} from "./render-manifest.ts";

export const RENDER_ARTIFACT_MANIFEST_VERSION = "1.0.0" as const;

export const RenderArtifactManifestSchema = z
  .object({
    contractVersion: z.literal(RENDER_ARTIFACT_MANIFEST_VERSION),
    renderId: z.string().uuid(),
    projectId: z.string().min(1),
    revisionId: z.string().min(1),
    projectChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
    engineVersion: z.string().min(1),
    outputFormat: RenderFormatSchema,
    scope: RenderScopeSchema,
    range: RenderRangeSchema,
    artifacts: z.array(RenderArtifactSchema).min(1),
    previewArtifactId: z.string().uuid().nullable(),
    createdAt: z.string().datetime()
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.previewArtifactId !== null &&
      !value.artifacts.some((artifact) => artifact.artifactId === value.previewArtifactId)
    ) {
      context.addIssue({
        code: "custom",
        message: "previewArtifactId must reference an artifact in the manifest."
      });
    }
    for (const artifact of value.artifacts) {
      if (artifact.renderId !== value.renderId) {
        context.addIssue({
          code: "custom",
          message: `Artifact '${artifact.artifactId}' belongs to a different render.`
        });
      }
    }
  });

export type RenderArtifactManifest = z.infer<typeof RenderArtifactManifestSchema>;

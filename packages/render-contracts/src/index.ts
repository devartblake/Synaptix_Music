export {
  ADAPTIVE_GAME_AUDIO_CONTRACT_VERSION,
  AdaptiveCuePointSchema,
  AdaptiveGameAudioManifestSchema,
  AdaptiveMusicStateSchema,
  AdaptiveRuntimeEventSchema,
  AdaptiveTransitionSchema,
  type AdaptiveGameAudioManifest,
  type AdaptiveMusicState,
  type AdaptiveRuntimeEvent,
  type AdaptiveTransition
} from "./adaptive-game.ts";
export {
  buildAdaptiveGameAudioManifest,
  findAdaptiveTransition,
  planAdaptiveTransition,
  selectAdaptiveState,
  type AdaptivePackageBuildRequest,
  type CertifiedAdaptiveArtifact,
  type PlannedAdaptiveTransition,
  type TransitionClock
} from "./adaptive-runtime.ts";

import { z } from "zod";

export const RENDER_CONTRACT_VERSION = "1.0.0" as const;

export const RenderFormatSchema = z.enum(["wav", "mp3", "ogg"]);
export const RenderScopeSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("master") }),
  z.object({ kind: z.literal("stems"), trackIds: z.array(z.string().min(1)).min(1) })
]);

export const RenderRangeSchema = z.object({
  startTick: z.number().int().nonnegative(),
  endTick: z.number().int().positive()
}).refine((value) => value.endTick > value.startTick, {
  message: "Render endTick must be greater than startTick."
});

export const RenderOutputSchema = z.object({
  format: RenderFormatSchema,
  sampleRate: z.union([z.literal(44100), z.literal(48000), z.literal(96000)]),
  bitDepth: z.union([z.literal(16), z.literal(24), z.literal(32)]),
  normalizePeakDbfs: z.number().max(0).min(-12).nullable().default(null),
  includeTailSeconds: z.number().min(0).max(30).default(2)
});

export const RenderManifestSchema = z.object({
  contractVersion: z.literal(RENDER_CONTRACT_VERSION),
  renderId: z.string().uuid(),
  projectId: z.string().min(1),
  revisionId: z.string().min(1),
  projectChecksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  engineVersion: z.string().min(1),
  seed: z.number().int().nonnegative(),
  scope: RenderScopeSchema,
  range: RenderRangeSchema,
  output: RenderOutputSchema,
  requestedAt: z.string().datetime()
}).strict();

export const RenderArtifactSchema = z.object({
  artifactId: z.string().uuid(),
  renderId: z.string().uuid(),
  trackId: z.string().min(1).nullable(),
  fileName: z.string().min(1),
  mediaType: z.string().min(1),
  byteLength: z.number().int().nonnegative(),
  checksumSha256: z.string().regex(/^[a-f0-9]{64}$/),
  durationSeconds: z.number().positive()
}).strict();

export const RenderResultSchema = z.object({
  contractVersion: z.literal(RENDER_CONTRACT_VERSION),
  renderId: z.string().uuid(),
  status: z.enum(["completed", "failed", "cancelled"]),
  artifacts: z.array(RenderArtifactSchema),
  warnings: z.array(z.string()),
  errorCode: z.string().nullable(),
  errorMessage: z.string().nullable(),
  completedAt: z.string().datetime()
}).strict().superRefine((value, context) => {
  if (value.status === "completed" && value.artifacts.length === 0) {
    context.addIssue({ code: "custom", message: "Completed renders require at least one artifact." });
  }
  if (value.status === "failed" && !value.errorCode) {
    context.addIssue({ code: "custom", message: "Failed renders require an errorCode." });
  }
});

export type RenderManifest = z.infer<typeof RenderManifestSchema>;
export type RenderResult = z.infer<typeof RenderResultSchema>;

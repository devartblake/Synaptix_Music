import { z } from "zod";

export const ADAPTIVE_GAME_AUDIO_CONTRACT_VERSION = "1.0.0" as const;

const ChecksumSchema = z.string().regex(/^[a-f0-9]{64}$/);

export const AdaptiveMusicStateSchema = z.object({
  stateId: z.string().min(1),
  displayName: z.string().min(1),
  intensity: z.number().min(0).max(1),
  masterArtifactId: z.string().uuid(),
  stemArtifactIds: z.array(z.string().uuid()).default([]),
  loopStartSeconds: z.number().nonnegative(),
  loopEndSeconds: z.number().positive(),
  entryCueSeconds: z.number().nonnegative().default(0),
  exitCueSeconds: z.number().nonnegative().nullable().default(null),
  tags: z.array(z.string().min(1)).default([])
}).strict().superRefine((value, context) => {
  if (value.loopEndSeconds <= value.loopStartSeconds) {
    context.addIssue({ code: "custom", message: "loopEndSeconds must be greater than loopStartSeconds." });
  }
  if (value.exitCueSeconds !== null && value.exitCueSeconds > value.loopEndSeconds) {
    context.addIssue({ code: "custom", message: "exitCueSeconds cannot exceed loopEndSeconds." });
  }
});

export const AdaptiveTransitionSchema = z.object({
  transitionId: z.string().min(1),
  fromStateId: z.string().min(1),
  toStateId: z.string().min(1),
  trigger: z.enum(["immediate", "next-beat", "next-bar", "next-phrase", "cue-point"]),
  crossfadeMilliseconds: z.number().int().min(0).max(30000).default(500),
  cuePointId: z.string().min(1).nullable().default(null),
  minimumSourcePlaybackSeconds: z.number().nonnegative().default(0)
}).strict().superRefine((value, context) => {
  if (value.fromStateId === value.toStateId) {
    context.addIssue({ code: "custom", message: "Adaptive transitions must target a different state." });
  }
  if (value.trigger === "cue-point" && value.cuePointId === null) {
    context.addIssue({ code: "custom", message: "cue-point transitions require cuePointId." });
  }
});

export const AdaptiveCuePointSchema = z.object({
  cuePointId: z.string().min(1),
  stateId: z.string().min(1),
  positionSeconds: z.number().nonnegative(),
  semantic: z.enum(["entry", "exit", "impact", "loop", "custom"])
}).strict();

export const AdaptiveGameAudioManifestSchema = z.object({
  contractVersion: z.literal(ADAPTIVE_GAME_AUDIO_CONTRACT_VERSION),
  packageId: z.string().uuid(),
  projectId: z.string().min(1),
  revisionId: z.string().min(1),
  projectChecksumSha256: ChecksumSchema,
  renderEngineVersion: z.string().min(1),
  defaultStateId: z.string().min(1),
  states: z.array(AdaptiveMusicStateSchema).min(1),
  transitions: z.array(AdaptiveTransitionSchema).default([]),
  cuePoints: z.array(AdaptiveCuePointSchema).default([]),
  createdAt: z.string().datetime()
}).strict().superRefine((value, context) => {
  const stateIds = new Set(value.states.map((state) => state.stateId));
  if (stateIds.size !== value.states.length) {
    context.addIssue({ code: "custom", message: "Adaptive state IDs must be unique." });
  }
  if (!stateIds.has(value.defaultStateId)) {
    context.addIssue({ code: "custom", message: "defaultStateId must reference a declared state." });
  }
  for (const transition of value.transitions) {
    if (!stateIds.has(transition.fromStateId) || !stateIds.has(transition.toStateId)) {
      context.addIssue({ code: "custom", message: `Transition ${transition.transitionId} references an unknown state.` });
    }
  }
  for (const cuePoint of value.cuePoints) {
    if (!stateIds.has(cuePoint.stateId)) {
      context.addIssue({ code: "custom", message: `Cue point ${cuePoint.cuePointId} references an unknown state.` });
    }
  }
});

export const AdaptiveRuntimeEventSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("set-state"),
    eventId: z.string().uuid(),
    stateId: z.string().min(1),
    requestedAtMilliseconds: z.number().int().nonnegative()
  }).strict(),
  z.object({
    type: z.literal("set-intensity"),
    eventId: z.string().uuid(),
    intensity: z.number().min(0).max(1),
    requestedAtMilliseconds: z.number().int().nonnegative()
  }).strict(),
  z.object({
    type: z.literal("trigger-stinger"),
    eventId: z.string().uuid(),
    artifactId: z.string().uuid(),
    gainDb: z.number().min(-60).max(12).default(0),
    requestedAtMilliseconds: z.number().int().nonnegative()
  }).strict()
]);

export type AdaptiveGameAudioManifest = z.infer<typeof AdaptiveGameAudioManifestSchema>;
export type AdaptiveMusicState = z.infer<typeof AdaptiveMusicStateSchema>;
export type AdaptiveTransition = z.infer<typeof AdaptiveTransitionSchema>;
export type AdaptiveRuntimeEvent = z.infer<typeof AdaptiveRuntimeEventSchema>;

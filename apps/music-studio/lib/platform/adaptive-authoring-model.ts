import {
  buildAdaptiveGameAudioManifest,
  AdaptiveGameAudioManifestSchema,
  type AdaptiveGameAudioManifest,
  type CertifiedAdaptiveArtifact,
  type RenderArtifact,
  type RenderJob,
  type TransitionClock
} from "@synaptix/render-contracts";

export interface AdaptiveStateDraft {
  jobId: string;
  stateId: string;
  displayName: string;
  intensity: number;
  tags: string[];
  loopStartSeconds?: number;
  loopEndSeconds?: number;
  entryCueSeconds?: number;
  exitCueSeconds?: number | null;
}

/**
 * Stinger cues the game runtime triggers from gameplay events. A state tagged
 * "stinger" plus one of these cues plays as a one-shot accent instead of a
 * looping music state.
 */
export const ADAPTIVE_STINGER_CUES = [
  { cue: "correct", label: "Correct answer" },
  { cue: "wrong", label: "Wrong answer" },
  { cue: "streak", label: "Streak started" },
  { cue: "time-low", label: "Time running low" },
  { cue: "final-round", label: "Final round" },
  { cue: "victory", label: "Victory" },
  { cue: "defeat", label: "Defeat" }
] as const;

export type AdaptiveStingerCue = (typeof ADAPTIVE_STINGER_CUES)[number]["cue"];
export type AdaptiveStateRole = { kind: "music" } | { kind: "stinger"; cue: AdaptiveStingerCue };

const STINGER_TAG = "stinger";
const CUE_TAGS = new Set<string>(ADAPTIVE_STINGER_CUES.map((item) => item.cue));

export function adaptiveStateRole(tags: readonly string[]): AdaptiveStateRole {
  if (!tags.includes(STINGER_TAG)) return { kind: "music" };
  const cue = ADAPTIVE_STINGER_CUES.find((item) => tags.includes(item.cue))?.cue ?? "correct";
  return { kind: "stinger", cue };
}

/** Tags for [role], keeping any author tags that are not role tags. */
export function tagsForAdaptiveRole(role: AdaptiveStateRole, tags: readonly string[]): string[] {
  const kept = tags.filter((tag) => tag !== STINGER_TAG && !CUE_TAGS.has(tag));
  if (role.kind === "music") return kept.length ? kept : ["gameplay"];
  return [STINGER_TAG, role.cue, ...kept.filter((tag) => tag !== "gameplay")];
}

export function eligibleAdaptiveRenders(
  jobs: readonly RenderJob[],
  projectId: string
): RenderJob[] {
  return jobs.filter(
    (job) =>
      job.status === "completed" &&
      job.result?.status === "completed" &&
      job.manifest.projectId === projectId &&
      job.result.artifacts.some(
        (artifact) =>
          artifact.trackId === null &&
          artifact.mediaType.startsWith("audio/") &&
          !artifact.fileName.startsWith("preview.")
      )
  );
}

function masterArtifact(artifacts: readonly RenderArtifact[]): RenderArtifact {
  const masters = artifacts.filter(
    (artifact) =>
      artifact.trackId === null &&
      artifact.mediaType.startsWith("audio/") &&
      !artifact.fileName.startsWith("preview.")
  );
  const preferred = masters.find((artifact) => artifact.mediaType === "audio/wav") ?? masters[0];
  if (!preferred) throw new Error("Adaptive states require a completed master artifact.");
  return preferred;
}

export function buildAdaptiveDraft(
  packageId: string,
  projectId: string,
  states: readonly AdaptiveStateDraft[],
  jobs: readonly RenderJob[],
  configuration?: Pick<AdaptiveGameAudioManifest, "transitions" | "cuePoints">,
  createdAt = new Date().toISOString(),
  clock?: TransitionClock
): AdaptiveGameAudioManifest {
  if (states.length === 0) throw new Error("Add at least one certified render state.");
  const musicStates = states.filter((state) => adaptiveStateRole(state.tags).kind === "music");
  if (musicStates.length === 0)
    throw new Error("Add at least one music state; stingers only accent the music.");
  const cues = states.flatMap((state) => {
    const role = adaptiveStateRole(state.tags);
    return role.kind === "stinger" ? [role.cue] : [];
  });
  if (new Set(cues).size !== cues.length)
    throw new Error("Each stinger cue can only be assigned to one state.");
  const stingerIds = new Set(
    states.filter((state) => adaptiveStateRole(state.tags).kind === "stinger").map((state) => state.stateId)
  );
  const byId = new Map(jobs.map((job) => [job.jobId, job]));
  const selected = states.map((state) => {
    const job = byId.get(state.jobId);
    if (!job || job.status !== "completed" || job.result?.status !== "completed") {
      throw new Error(`Render job ${state.jobId} is not completed.`);
    }
    if (job.manifest.projectId !== projectId)
      throw new Error("All states must belong to the active project.");
    return { state, job, master: masterArtifact(job.result.artifacts) };
  });
  const anchor = selected[0]!.job.manifest;
  if (
    selected.some(
      ({ job }) =>
        job.manifest.revisionId !== anchor.revisionId ||
        job.manifest.projectChecksumSha256 !== anchor.projectChecksumSha256
    )
  ) {
    throw new Error("All adaptive states must use the same immutable project revision.");
  }

  const artifacts: CertifiedAdaptiveArtifact[] = selected.map(({ state, job, master }) => ({
    artifactId: master.artifactId,
    stateId: state.stateId,
    displayName: state.displayName,
    intensity: state.intensity,
    durationSeconds: master.durationSeconds,
    loopStartSeconds: state.loopStartSeconds,
    loopEndSeconds: state.loopEndSeconds,
    entryCueSeconds: state.entryCueSeconds,
    exitCueSeconds: state.exitCueSeconds,
    stemArtifactIds: job
      .result!.artifacts.filter((artifact) => artifact.trackId !== null)
      .map((artifact) => artifact.artifactId),
    tags: state.tags
  }));
  // Stingers are one-shots: they never join the looping transition chain.
  const transitions = musicStates.slice(0, -1).map((state, index) => ({
    transitionId: `${state.stateId}-to-${musicStates[index + 1]!.stateId}`,
    fromStateId: state.stateId,
    toStateId: musicStates[index + 1]!.stateId,
    trigger: "next-bar" as const,
    crossfadeMilliseconds: 500,
    cuePointId: null,
    minimumSourcePlaybackSeconds: 0
  }));
  const manifest = buildAdaptiveGameAudioManifest({
    packageId,
    projectId,
    revisionId: anchor.revisionId,
    projectChecksumSha256: anchor.projectChecksumSha256,
    renderEngineVersion: anchor.engineVersion,
    defaultStateId: musicStates[0]!.stateId,
    artifacts,
    transitions: configuration?.transitions ?? transitions,
    clock,
    createdAt
  });
  manifest.cuePoints = configuration?.cuePoints ?? [];
  for (const { state, master } of selected) {
    const value = manifest.states.find((item) => item.stateId === state.stateId)!;
    if (
      value.loopEndSeconds > master.durationSeconds ||
      value.entryCueSeconds >= value.loopEndSeconds
    )
      throw new Error(`${state.displayName}: loop and entry must fit within the audio duration.`);
  }
  const unique = (ids: string[], label: string) => {
    if (new Set(ids).size !== ids.length) throw new Error(`${label} IDs must be unique.`);
  };
  unique(
    manifest.transitions.map((item) => item.transitionId),
    "Transition"
  );
  unique(
    manifest.cuePoints.map((item) => item.cuePointId),
    "Cue"
  );
  for (const cue of manifest.cuePoints) {
    const state = manifest.states.find((item) => item.stateId === cue.stateId);
    if (!state || cue.positionSeconds >= state.loopEndSeconds)
      throw new Error("Cue points must lie before their state's loop end.");
  }
  if (
    manifest.transitions.some(
      (item) => stingerIds.has(item.fromStateId) || stingerIds.has(item.toStateId)
    )
  )
    throw new Error("Stingers play as one-shots and cannot be part of transitions.");
  for (const transition of manifest.transitions)
    if (
      transition.trigger === "cue-point" &&
      !manifest.cuePoints.some(
        (cue) => cue.cuePointId === transition.cuePointId && cue.stateId === transition.fromStateId
      )
    )
      throw new Error("Cue transitions require a cue in the source state.");
  return AdaptiveGameAudioManifestSchema.parse(manifest);
}

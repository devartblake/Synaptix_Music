import {
  ADAPTIVE_GAME_AUDIO_CONTRACT_VERSION,
  AdaptiveGameAudioManifestSchema,
  type AdaptiveGameAudioManifest,
  type AdaptiveMusicState,
  type AdaptiveTransition
} from "./adaptive-game.ts";

export interface CertifiedAdaptiveArtifact {
  artifactId: string;
  stateId: string;
  displayName: string;
  intensity: number;
  durationSeconds: number;
  loopStartSeconds?: number;
  loopEndSeconds?: number;
  entryCueSeconds?: number;
  exitCueSeconds?: number | null;
  stemArtifactIds?: string[];
  tags?: string[];
}

export interface AdaptivePackageBuildRequest {
  packageId: string;
  projectId: string;
  revisionId: string;
  projectChecksumSha256: string;
  renderEngineVersion: string;
  defaultStateId: string;
  artifacts: CertifiedAdaptiveArtifact[];
  transitions?: AdaptiveTransition[];
  createdAt: string;
}

export interface TransitionClock {
  beatsPerMinute: number;
  beatsPerBar: number;
  barsPerPhrase: number;
}

export interface PlannedAdaptiveTransition {
  transition: AdaptiveTransition;
  executeAtMilliseconds: number;
  delayMilliseconds: number;
}

function unique(values: readonly string[]): string[] {
  return [...new Set(values)];
}

function assertFiniteRange(value: number, minimum: number, maximum: number, label: string): void {
  if (!Number.isFinite(value) || value < minimum || value > maximum) {
    throw new Error(`${label} must be between ${minimum} and ${maximum}.`);
  }
}

export function buildAdaptiveGameAudioManifest(
  request: AdaptivePackageBuildRequest
): AdaptiveGameAudioManifest {
  if (request.artifacts.length === 0) {
    throw new Error("Adaptive packages require at least one certified artifact.");
  }

  const states: AdaptiveMusicState[] = request.artifacts.map((artifact) => {
    assertFiniteRange(artifact.intensity, 0, 1, `Intensity for ${artifact.stateId}`);
    if (!Number.isFinite(artifact.durationSeconds) || artifact.durationSeconds <= 0) {
      throw new Error(`Duration for ${artifact.stateId} must be positive.`);
    }

    const loopStartSeconds = artifact.loopStartSeconds ?? 0;
    const loopEndSeconds = artifact.loopEndSeconds ?? artifact.durationSeconds;

    return {
      stateId: artifact.stateId,
      displayName: artifact.displayName,
      intensity: artifact.intensity,
      masterArtifactId: artifact.artifactId,
      stemArtifactIds: unique(artifact.stemArtifactIds ?? []),
      loopStartSeconds,
      loopEndSeconds,
      entryCueSeconds: artifact.entryCueSeconds ?? loopStartSeconds,
      exitCueSeconds: artifact.exitCueSeconds ?? null,
      tags: unique(artifact.tags ?? []).sort()
    };
  });

  return AdaptiveGameAudioManifestSchema.parse({
    contractVersion: ADAPTIVE_GAME_AUDIO_CONTRACT_VERSION,
    packageId: request.packageId,
    projectId: request.projectId,
    revisionId: request.revisionId,
    projectChecksumSha256: request.projectChecksumSha256,
    renderEngineVersion: request.renderEngineVersion,
    defaultStateId: request.defaultStateId,
    states,
    transitions: request.transitions ?? [],
    cuePoints: [],
    createdAt: request.createdAt
  });
}

export function selectAdaptiveState(
  manifest: AdaptiveGameAudioManifest,
  intensity: number,
  requiredTags: readonly string[] = []
): AdaptiveMusicState {
  assertFiniteRange(intensity, 0, 1, "Requested intensity");
  const matching = manifest.states.filter((state) =>
    requiredTags.every((tag) => state.tags.includes(tag))
  );
  const candidates = matching.length > 0 ? matching : manifest.states;

  return [...candidates].sort((left, right) => {
    const leftDistance = Math.abs(left.intensity - intensity);
    const rightDistance = Math.abs(right.intensity - intensity);
    if (leftDistance !== rightDistance) return leftDistance - rightDistance;
    return left.stateId.localeCompare(right.stateId);
  })[0]!;
}

export function findAdaptiveTransition(
  manifest: AdaptiveGameAudioManifest,
  fromStateId: string,
  toStateId: string
): AdaptiveTransition | null {
  return (
    manifest.transitions.find(
      (transition) =>
        transition.fromStateId === fromStateId && transition.toStateId === toStateId
    ) ?? null
  );
}

function quantizationMilliseconds(
  trigger: AdaptiveTransition["trigger"],
  clock: TransitionClock
): number {
  if (!Number.isFinite(clock.beatsPerMinute) || clock.beatsPerMinute <= 0) {
    throw new Error("beatsPerMinute must be positive.");
  }
  if (!Number.isInteger(clock.beatsPerBar) || clock.beatsPerBar <= 0) {
    throw new Error("beatsPerBar must be a positive integer.");
  }
  if (!Number.isInteger(clock.barsPerPhrase) || clock.barsPerPhrase <= 0) {
    throw new Error("barsPerPhrase must be a positive integer.");
  }

  const beat = 60_000 / clock.beatsPerMinute;
  if (trigger === "next-beat") return beat;
  if (trigger === "next-bar") return beat * clock.beatsPerBar;
  if (trigger === "next-phrase") return beat * clock.beatsPerBar * clock.barsPerPhrase;
  return 0;
}

export function planAdaptiveTransition(
  transition: AdaptiveTransition,
  requestedAtMilliseconds: number,
  sourcePlaybackMilliseconds: number,
  clock: TransitionClock,
  cuePointMilliseconds?: number
): PlannedAdaptiveTransition {
  if (!Number.isFinite(requestedAtMilliseconds) || requestedAtMilliseconds < 0) {
    throw new Error("requestedAtMilliseconds must be nonnegative.");
  }
  if (!Number.isFinite(sourcePlaybackMilliseconds) || sourcePlaybackMilliseconds < 0) {
    throw new Error("sourcePlaybackMilliseconds must be nonnegative.");
  }

  const minimumDelay = Math.max(
    0,
    transition.minimumSourcePlaybackSeconds * 1000 - sourcePlaybackMilliseconds
  );
  let scheduled = requestedAtMilliseconds + minimumDelay;

  if (transition.trigger === "cue-point") {
    if (cuePointMilliseconds === undefined || cuePointMilliseconds < sourcePlaybackMilliseconds) {
      throw new Error("A future cue point is required for cue-point transitions.");
    }
    scheduled = requestedAtMilliseconds + (cuePointMilliseconds - sourcePlaybackMilliseconds);
  } else {
    const quantum = quantizationMilliseconds(transition.trigger, clock);
    if (quantum > 0) {
      scheduled = Math.ceil(scheduled / quantum) * quantum;
    }
  }

  return {
    transition,
    executeAtMilliseconds: Math.round(scheduled),
    delayMilliseconds: Math.round(scheduled - requestedAtMilliseconds)
  };
}

import {
  buildAdaptiveGameAudioManifest,
  type AdaptiveGameAudioManifest,
  type CertifiedAdaptiveArtifact,
  type RenderArtifact,
  type RenderJob
} from "@synaptix/render-contracts";

export interface AdaptiveStateDraft {
  jobId: string;
  stateId: string;
  displayName: string;
  intensity: number;
  tags: string[];
}

export function eligibleAdaptiveRenders(jobs: readonly RenderJob[], projectId: string): RenderJob[] {
  return jobs.filter((job) => job.status === "completed"
    && job.result?.status === "completed"
    && job.manifest.projectId === projectId
    && job.result.artifacts.some((artifact) => artifact.trackId === null));
}

function masterArtifact(artifacts: readonly RenderArtifact[]): RenderArtifact {
  const masters = artifacts.filter((artifact) => artifact.trackId === null);
  const preferred = masters.find((artifact) => artifact.mediaType === "audio/wav") ?? masters[0];
  if (!preferred) throw new Error("Adaptive states require a completed master artifact.");
  return preferred;
}

export function buildAdaptiveDraft(
  packageId: string,
  projectId: string,
  states: readonly AdaptiveStateDraft[],
  jobs: readonly RenderJob[]
): AdaptiveGameAudioManifest {
  if (states.length === 0) throw new Error("Add at least one certified render state.");
  const byId = new Map(jobs.map((job) => [job.jobId, job]));
  const selected = states.map((state) => {
    const job = byId.get(state.jobId);
    if (!job || job.status !== "completed" || job.result?.status !== "completed") {
      throw new Error(`Render job ${state.jobId} is not completed.`);
    }
    if (job.manifest.projectId !== projectId) throw new Error("All states must belong to the active project.");
    return { state, job, master: masterArtifact(job.result.artifacts) };
  });
  const anchor = selected[0]!.job.manifest;
  if (selected.some(({ job }) => job.manifest.revisionId !== anchor.revisionId
    || job.manifest.projectChecksumSha256 !== anchor.projectChecksumSha256)) {
    throw new Error("All adaptive states must use the same immutable project revision.");
  }

  const artifacts: CertifiedAdaptiveArtifact[] = selected.map(({ state, job, master }) => ({
    artifactId: master.artifactId,
    stateId: state.stateId,
    displayName: state.displayName,
    intensity: state.intensity,
    durationSeconds: master.durationSeconds,
    stemArtifactIds: job.result!.artifacts.filter((artifact) => artifact.trackId !== null).map((artifact) => artifact.artifactId),
    tags: state.tags
  }));
  const transitions = states.slice(0, -1).map((state, index) => ({
    transitionId: `${state.stateId}-to-${states[index + 1]!.stateId}`,
    fromStateId: state.stateId,
    toStateId: states[index + 1]!.stateId,
    trigger: "next-bar" as const,
    crossfadeMilliseconds: 500,
    cuePointId: null,
    minimumSourcePlaybackSeconds: 0
  }));
  return buildAdaptiveGameAudioManifest({
    packageId,
    projectId,
    revisionId: anchor.revisionId,
    projectChecksumSha256: anchor.projectChecksumSha256,
    renderEngineVersion: anchor.engineVersion,
    defaultStateId: states[0]!.stateId,
    artifacts,
    transitions,
    createdAt: new Date().toISOString()
  });
}

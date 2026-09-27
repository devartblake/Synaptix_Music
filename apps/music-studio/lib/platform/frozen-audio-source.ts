import type { FrozenAudioSource } from "@synaptix/daw-engine";
import type { FrozenPluginArtifactReference } from "@synaptix/project-model/v2";
import type { RenderJob } from "@synaptix/render-contracts";

async function sha256Hex(bytes: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

/**
 * Frozen plug-in audio from the signed-in player's renders, for browser playback when a
 * plug-in can't load here (cutover step F). The freeze must be the player's own completed
 * render, and the bytes must match the checksum the project's freeze reference pins.
 */
export function createPlatformFrozenAudioSource(fetchImpl: typeof fetch = (...args) => fetch(...args)): FrozenAudioSource {
  return {
    async load(reference: FrozenPluginArtifactReference) {
      const response = await fetchImpl(`/api/platform/renders/${encodeURIComponent(reference.renderId)}`, { cache: "no-store" });
      if (!response.ok) throw new Error(`The freeze render isn't available (HTTP ${response.status}).`);
      const job = (await response.json()) as RenderJob;
      if (job.status !== "completed" || job.manifest.renderId !== reference.renderId || job.manifest.projectId !== reference.sourceProjectId) {
        throw new Error("The freeze render doesn't match this project.");
      }
      const artifact = job.result?.artifacts.find((candidate) => candidate.artifactId === reference.artifactId);
      if (!artifact || artifact.checksumSha256 !== reference.artifactChecksumSha256) {
        throw new Error("The frozen audio isn't part of that render.");
      }
      const content = await fetchImpl(
        `/api/platform/render-jobs/${encodeURIComponent(job.jobId)}/artifacts/${encodeURIComponent(artifact.artifactId)}/content`,
        { cache: "no-store" }
      );
      if (!content.ok) throw new Error(`The frozen audio couldn't be fetched (HTTP ${content.status}).`);
      const audio = await content.arrayBuffer();
      if ((await sha256Hex(audio)) !== reference.artifactChecksumSha256) throw new Error("The frozen audio doesn't match its checksum.");
      return { audio, startTick: job.manifest.range.startTick };
    }
  };
}

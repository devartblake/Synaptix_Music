import {
  evaluateFrozenPluginEvidence,
  type AudioPluginDescriptor
} from "@synaptix/project-model/plugin";
import type { FrozenPluginArtifactReference, MusicProjectV2 } from "@synaptix/project-model/v2";

import { RenderArtifactManifestSchema, type RenderArtifactManifest } from "./artifact-manifest.ts";

/*
 * Plug-in freeze evidence linked to Stage 12 artifacts (Plugin Runtime Foundation v1, R6).
 *
 * A frozen reference never embeds audio. It points at a certified RenderArtifactManifest,
 * and production rendering may only substitute frozen audio for a live plug-in when both
 * the project-side evidence and the Stage 12 manifest evidence agree.
 */

export function verifyFrozenArtifactAgainstManifest(
  reference: FrozenPluginArtifactReference,
  manifestInput: RenderArtifactManifest
): string[] {
  const parsed = RenderArtifactManifestSchema.safeParse(manifestInput);
  if (!parsed.success) return ["Render artifact manifest is invalid."];
  const manifest = parsed.data;
  const issues: string[] = [];
  if (manifest.renderId !== reference.renderId) issues.push("Manifest belongs to a different render.");
  if (manifest.projectId !== reference.sourceProjectId) issues.push("Manifest belongs to a different project.");
  if (manifest.revisionId !== reference.sourceRevisionId) issues.push("Manifest was rendered from a different source revision.");
  if (manifest.projectChecksumSha256 !== reference.sourceProjectChecksumSha256) {
    issues.push("Manifest project checksum does not match the frozen source checksum.");
  }
  if (manifest.engineVersion !== reference.engineVersion) issues.push("Manifest engine version does not match.");
  const artifact = manifest.artifacts.find((candidate) => candidate.artifactId === reference.artifactId);
  if (!artifact) issues.push("Referenced artifact is not part of the manifest.");
  else if (artifact.checksumSha256 !== reference.artifactChecksumSha256) issues.push("Artifact checksum does not match.");
  return issues;
}

export type PluginProductionRenderMode = "deterministic" | "frozen" | "blocked";

export interface PluginProductionDecision {
  trackId: string;
  deviceId: string;
  pluginId: string;
  mode: PluginProductionRenderMode;
  reasons: string[];
}

export interface PluginProductionAssessment {
  certifiable: boolean;
  decisions: PluginProductionDecision[];
}

export interface PluginProductionAssessmentOptions {
  descriptorFor(device: MusicProjectV2["tracks"][number]["devices"][number]): AudioPluginDescriptor | undefined;
  manifestFor(renderId: string): RenderArtifactManifest | undefined;
}

/**
 * Decide, per enabled device, how certified production rendering may treat it:
 * built-ins and explicitly deterministic plug-ins render live; everything else
 * (browser-only AudioWorklet/WAM, native proxies, unknown plug-ins) requires a current,
 * manifest-verified frozen artifact, or the project is not certifiable.
 */
export async function assessPluginProductionEligibility(
  project: MusicProjectV2,
  options: PluginProductionAssessmentOptions
): Promise<PluginProductionAssessment> {
  const decisions: PluginProductionDecision[] = [];
  for (const track of project.tracks) {
    for (const device of track.devices) {
      if (!device.enabled) continue;
      const base = { trackId: track.id, deviceId: device.id, pluginId: device.plugin.pluginId };
      const descriptor = options.descriptorFor(device);
      if (
        device.plugin.runtimeKind === "builtin" ||
        descriptor?.compatibility.deterministicProductionRender === true
      ) {
        decisions.push({ ...base, mode: "deterministic", reasons: [] });
        continue;
      }
      const evidence = await evaluateFrozenPluginEvidence(project, device.id);
      if (evidence.status === "absent") {
        decisions.push({ ...base, mode: "blocked", reasons: ["Browser-only or external plug-in has no frozen artifact."] });
        continue;
      }
      if (evidence.status === "stale") {
        decisions.push({ ...base, mode: "blocked", reasons: evidence.reasons });
        continue;
      }
      const manifest = options.manifestFor(evidence.reference.renderId);
      const reasons = manifest
        ? verifyFrozenArtifactAgainstManifest(evidence.reference, manifest)
        : ["Render artifact manifest for the frozen artifact was not found."];
      decisions.push({ ...base, mode: reasons.length === 0 ? "frozen" : "blocked", reasons });
    }
  }
  return { certifiable: decisions.every((decision) => decision.mode !== "blocked"), decisions };
}

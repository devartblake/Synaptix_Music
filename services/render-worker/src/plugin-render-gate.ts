import type { MusicProject } from "@synaptix/project-model";
import { projectV2BuiltinView, type MusicProjectV2 } from "@synaptix/project-model/v2";
import type { RenderManifest } from "@synaptix/render-contracts";

import { resolveFrozenTracks, type FrozenArtifactSource } from "./frozen-playback.ts";
import { PluginRenderUnsupportedError } from "./plugin-render-error.ts";
import type { OfflineRenderOptions } from "./offline-renderer.ts";

export { PluginRenderUnsupportedError, type PluginRenderBlocker } from "./plugin-render-error.ts";

export interface RenderableProject {
  project: MusicProject;
  options: OfflineRenderOptions;
}

/**
 * Accept Project Schema v1 or v2 and return what the deterministic offline renderer can
 * execute. v2 projects render their built-in devices; an enabled plug-in on a rendered track
 * plays from its current, manifest-verified freeze (see resolveFrozenTracks) or fails closed,
 * because live browser/native processing is never a certification source.
 */
export async function resolveRenderableProject(
  project: MusicProject | MusicProjectV2,
  manifest: Pick<RenderManifest, "scope" | "range" | "output">,
  frozenSource?: FrozenArtifactSource
): Promise<RenderableProject> {
  if (manifest.scope.kind === "plugin-freeze") {
    throw new Error("Plug-in freeze renders are produced by renderPluginFreeze, not the mix renderer.");
  }
  if (project.schemaVersion === 1) return { project, options: {} };

  const { preFader, blockers } = await resolveFrozenTracks(project, manifest, frozenSource);
  if (blockers.length > 0) throw new PluginRenderUnsupportedError(blockers);
  return { project: projectV2BuiltinView(project), options: preFader.size > 0 ? { preFader } : {} };
}

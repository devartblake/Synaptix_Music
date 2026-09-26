import type { MusicProject } from "@synaptix/project-model";
import { evaluateFrozenPluginEvidence } from "@synaptix/project-model/plugin";
import { projectV2BuiltinView, type MusicProjectV2 } from "@synaptix/project-model/v2";
import type { RenderManifest } from "@synaptix/render-contracts";

/** Raised when a revision contains live plug-in processing this worker cannot certify. */
export class PluginRenderUnsupportedError extends Error {
  constructor(readonly devices: readonly { trackId: string; deviceId: string; pluginId: string; reason: string }[]) {
    super(
      `Render requires plug-in processing this worker cannot certify: ${devices
        .map((device) => `${device.pluginId} on track '${device.trackId}' (${device.reason})`)
        .join("; ")}.`
    );
    this.name = "PluginRenderUnsupportedError";
  }
}

/**
 * Accept Project Schema v1 or v2 and return what the deterministic offline renderer can
 * execute. v2 projects render their built-in devices; any enabled plug-in on a rendered track
 * fails closed, because live browser/native processing is never a certification source and
 * frozen-artifact playback is not implemented in this worker yet.
 */
export async function resolveRenderableProject(
  project: MusicProject | MusicProjectV2,
  manifest: Pick<RenderManifest, "scope">
): Promise<MusicProject> {
  if (project.schemaVersion === 1) return project;

  const inScope = manifest.scope.kind === "stems" ? new Set(manifest.scope.trackIds) : null;
  const unsupported: { trackId: string; deviceId: string; pluginId: string; reason: string }[] = [];
  for (const track of project.tracks) {
    if (inScope && !inScope.has(track.id)) continue;
    for (const device of track.devices) {
      if (!device.enabled || device.plugin.runtimeKind === "builtin") continue;
      const evidence = await evaluateFrozenPluginEvidence(project, device.id);
      const reason = evidence.status === "absent"
        ? "no frozen artifact"
        : evidence.status === "stale"
          ? "frozen artifact is stale"
          : "frozen artifact playback is not supported by this worker yet";
      unsupported.push({ trackId: track.id, deviceId: device.id, pluginId: device.plugin.pluginId, reason });
    }
  }
  if (unsupported.length > 0) throw new PluginRenderUnsupportedError(unsupported);
  return projectV2BuiltinView(project);
}

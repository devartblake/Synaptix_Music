import assert from "node:assert/strict";
import test from "node:test";
import { createEmptyProject, defaultMixer } from "@synaptix/project-model";
import { computeProjectChecksum } from "@synaptix/command-system";
import { computePluginStateChecksum, computeSignalChainChecksum } from "@synaptix/project-model/plugin";
import { downgradeProjectV2ToV1, projectV2BuiltinView, toProjectV2 } from "@synaptix/project-model/v2";
import {
  createExportManifest,
  livePluginsInScope,
  pinManifestToPlatformRevision,
  safeDownloadUrl,
  SYNC_BEFORE_RENDER_MESSAGE,
  type ExportOptions
} from "./render-export-model.ts";

const options: ExportOptions = { scope: "master", format: "wav", sampleRate: 48000, bitDepth: 24, tail: 2, normalize: false, trackIds: ["track"] };
test("export anchors the exact mixer-bearing project revision and validates stems", async () => {
  const project = createEmptyProject("export");
  project.tracks = [{ id: "track", name: "Bass", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0, devices: [], clips: [] }];
  project.mixer = defaultMixer(); project.mixer.master.volumeDb = -6;
  const manifest = await createExportManifest(project, options);
  assert.equal(manifest.projectChecksumSha256, await computeProjectChecksum(project));
  assert.equal(manifest.revisionId, project.revisionId);
  assert.equal(manifest.range.endTick, 15360);
  // Renders record which synthesis made them, so audio from the 1.0.0 renderer (aliasing saw
  // and square) is never mistaken for the band-limited kernel's.
  assert.equal(manifest.engineVersion, "1.1.0");
  await assert.rejects(createExportManifest(project, { ...options, scope: "stems", trackIds: [] }));
  await assert.rejects(createExportManifest(project, { ...options, scope: "stems", trackIds: ["missing"] }));
  const stems = await createExportManifest(project, { ...options, scope: "stems", normalize: true });
  assert.equal(stems.output.normalizePeakDbfs, -1);
});
test("download links reject executable URLs and embedded credentials", () => {
  assert.equal(safeDownloadUrl("https://example.com/master.wav?token=abc"), "https://example.com/master.wav?token=abc");
  for (const url of ["javascript:alert(1)", "data:text/html,example", "https://user:pass@example.com", "/relative", null]) assert.throws(() => safeDownloadUrl(url));
});

function v2Project() {
  const project = createEmptyProject("pinned");
  project.tracks = [{ id: "track", name: "Bass", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0, devices: [], clips: [] }];
  return toProjectV2(project);
}

test("renders pin the checksum of the snapshot the platform stored, v1 or v2", async () => {
  const editor = v2Project();
  const draft = await createExportManifest(projectV2BuiltinView(editor), options);

  // Flag 1: the platform holds the lossless v1 copy.
  const v1 = downgradeProjectV2ToV1(editor)!;
  const pinnedV1 = await pinManifestToPlatformRevision(draft, editor, { project: v1, checksumSha256: await computeProjectChecksum(v1) });
  assert.equal(pinnedV1.projectChecksumSha256, await computeProjectChecksum(v1));

  // Flag 2: the platform holds v2, so publication will compare against the v2 checksum.
  const pinnedV2 = await pinManifestToPlatformRevision(draft, editor, { project: editor });
  assert.equal(pinnedV2.projectChecksumSha256, await computeProjectChecksum(editor));
  assert.notEqual(pinnedV2.projectChecksumSha256, draft.projectChecksumSha256);

  // An upload rebased onto an older parent is still the same music.
  const rebased = { ...v1, parentRevisionId: "older" };
  await pinManifestToPlatformRevision(draft, editor, { project: rebased });
});

test("pinning refuses other revisions, changed music, bad checksums and live plug-ins", async () => {
  const editor = v2Project();
  const draft = await createExportManifest(projectV2BuiltinView(editor), options);

  await assert.rejects(pinManifestToPlatformRevision(draft, editor, { project: { ...editor, revisionId: "other" } }), { message: SYNC_BEFORE_RENDER_MESSAGE });
  await assert.rejects(pinManifestToPlatformRevision(draft, editor, { project: { ...editor, tracks: [] } }), { message: SYNC_BEFORE_RENDER_MESSAGE });
  await assert.rejects(pinManifestToPlatformRevision(draft, editor, { nothing: true }), { message: SYNC_BEFORE_RENDER_MESSAGE });
  await assert.rejects(pinManifestToPlatformRevision(draft, editor, { project: editor, checksumSha256: "0".repeat(64) }), /doesn't match its checksum/);

  const withPlugin = structuredClone(editor);
  withPlugin.tracks[0]!.devices.push({
    id: "drive", deviceType: "synaptix.reference-drive", deviceVersion: "1.0.0", enabled: true, parameters: [],
    plugin: { pluginId: "synaptix.reference-drive", vendorId: "synaptix", version: "1.0.0", runtimeKind: "audio-worklet", moduleChecksumSha256: null },
    pluginState: null, automation: [], frozen: null
  });
  assert.deepEqual(await livePluginsInScope(withPlugin, { kind: "master" }), [{ trackName: "Bass", pluginId: "synaptix.reference-drive" }]);
  assert.deepEqual(await livePluginsInScope(withPlugin, { kind: "stems", trackIds: [] }), []);
  await assert.rejects(pinManifestToPlatformRevision(draft, withPlugin, { project: withPlugin }), /can't play live plug-ins/);
});

test("plug-ins covered by a current freeze don't block rendering; stale freezes still do", async () => {
  const project = v2Project();
  project.tracks[0]!.devices.push({
    id: "drive", deviceType: "synaptix.reference-drive", deviceVersion: "1.0.0", enabled: true, parameters: [],
    plugin: { pluginId: "synaptix.reference-drive", vendorId: "synaptix", version: "1.0.0", runtimeKind: "audio-worklet", moduleChecksumSha256: null },
    pluginState: null, automation: [], frozen: null
  });
  const device = project.tracks[0]!.devices.at(-1)!;
  device.frozen = {
    renderId: "7f7b8f0e-7f55-4a41-9d4e-3b1f8f3f7a10", artifactId: "0c3f3f0e-1a55-4a41-9d4e-3b1f8f3f7a11",
    sourceProjectId: project.projectId, sourceRevisionId: project.revisionId, sourceProjectChecksumSha256: "c".repeat(64),
    sourceDeviceId: device.id, sourcePluginStateChecksumSha256: await computePluginStateChecksum(device),
    sourceSignalChainChecksumSha256: await computeSignalChainChecksum(project, device.id),
    artifactChecksumSha256: "d".repeat(64), engineVersion: "1.0.0", frozenAt: "2026-09-27T00:00:00Z"
  };
  assert.deepEqual(await livePluginsInScope(project, { kind: "master" }), []);

  device.parameters = [{ id: "drive", value: 4 }];
  assert.equal((await livePluginsInScope(project, { kind: "master" })).length, 1);
});

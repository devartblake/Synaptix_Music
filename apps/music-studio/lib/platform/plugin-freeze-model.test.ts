import assert from "node:assert/strict";
import test from "node:test";

import { computeProjectChecksum } from "@synaptix/command-system";
import { SetFrozenPluginArtifactEditorCommand } from "@synaptix/command-system/plugin";
import { createReferenceDriveDevice } from "@synaptix/daw-engine";
import { createEmptyProject } from "@synaptix/project-model";
import { evaluateFrozenPluginEvidence } from "@synaptix/project-model/plugin";
import { projectV2BuiltinView, toProjectV2, type MusicProjectV2 } from "@synaptix/project-model/v2";
import type { RenderJob } from "@synaptix/render-contracts";

import { arrangementBars, barTicks } from "../editor/timeline-model.ts";
import { canFreeze, createFreezeManifest, freezeReference, storedRevision } from "./plugin-freeze-model.ts";

function project(): MusicProjectV2 {
  const v1 = createEmptyProject("project-1", { revisionId: "revision-1" });
  v1.tracks = [{
    id: "bass", name: "Bass", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0,
    devices: [{ id: "synth", deviceType: "synaptix-bass-synth", deviceVersion: "1.0.0", enabled: true, parameters: [] }],
    clips: [{ id: "c", kind: "midi", name: "Bass", loop: false, range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: 3840 * 2 },
      notes: [{ id: "n", pitch: 45, velocity: 100, startTick: 0, durationTicks: 960 }] }]
  }];
  const value = toProjectV2(v1);
  value.tracks[0]!.devices.push(createReferenceDriveDevice("drive"));
  return value;
}

function completedJob(renderId: string): RenderJob {
  return {
    jobId: "20000000-0000-4000-8000-000000000000", status: "completed", attempt: 1, lastError: null,
    result: {
      contractVersion: "1.0.0", renderId, status: "completed", warnings: [], errorCode: null, errorMessage: null,
      completedAt: "2026-09-26T00:00:00.000Z",
      artifacts: [{ artifactId: "30000000-0000-4000-8000-000000000000", renderId, trackId: "bass",
        fileName: "freeze-bass-synaptix-reference-drive.wav", mediaType: "audio/wav", byteLength: 44,
        checksumSha256: "b".repeat(64), durationSeconds: 4 }]
    }
  } as unknown as RenderJob;
}

test("only first-party plug-ins without automation can be frozen", () => {
  const drive = createReferenceDriveDevice("d");
  assert.equal(canFreeze(drive), true);
  assert.equal(canFreeze({ ...drive, plugin: { ...drive.plugin, pluginId: "vendor.fx" } }), false);
  assert.equal(canFreeze({ ...drive, automation: [{}] as never }), false);
});

test("freezes render from the stored v2 revision and refuse anything else", async () => {
  const local = project();
  assert.equal((await storedRevision({ project: local }, local)).revisionId, "revision-1");
  await assert.rejects(storedRevision({ project: createEmptyProject("project-1") }, local), /v2/);
  await assert.rejects(storedRevision({ project: { ...local, revisionId: "revision-0" } }, local), /Save and sync/);
  await assert.rejects(storedRevision({ project: local, checksumSha256: "0".repeat(64) }, local), /checksum/);

  const manifest = await createFreezeManifest(local, "bass", "drive", "10000000-0000-4000-8000-000000000000", "2026-09-26T00:00:00.000Z");
  assert.deepEqual(manifest.scope, { kind: "plugin-freeze", trackId: "bass", deviceId: "drive" });
  assert.equal(manifest.projectChecksumSha256, await computeProjectChecksum(local));
  // The whole arrangement, the same range the Render screen uses.
  const builtin = projectV2BuiltinView(local);
  assert.equal(manifest.range.endTick, arrangementBars(builtin) * barTicks(builtin));
  await assert.rejects(createFreezeManifest(local, "bass", "synth"), /first-party/);
  await assert.rejects(createFreezeManifest(local, "bass", "missing"), /isn't in the synced revision/);
});

test("an attached freeze is current until the plug-in or its input changes", async () => {
  const stored = project();
  const manifest = await createFreezeManifest(stored, "bass", "drive", "10000000-0000-4000-8000-000000000000");
  const reference = await freezeReference(stored, manifest, completedJob(manifest.renderId));
  assert.equal(reference.artifactId, "30000000-0000-4000-8000-000000000000");

  const frozen = new SetFrozenPluginArtifactEditorCommand("bass", "drive", null, reference).execute(stored);
  assert.equal((await evaluateFrozenPluginEvidence(frozen, "drive", "bass")).status, "current");

  const retuned = structuredClone(frozen);
  retuned.tracks[0]!.devices[1]!.parameters = [{ id: "drive", value: 9 }];
  const evidence = await evaluateFrozenPluginEvidence(retuned, "drive", "bass");
  assert.equal(evidence.status, "stale");

  await assert.rejects(
    freezeReference(stored, manifest, { ...completedJob(manifest.renderId), status: "failed", result: null, lastError: "boom" } as RenderJob),
    /boom/
  );
});

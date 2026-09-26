import assert from "node:assert/strict";
import test from "node:test";

import { SetDeviceParameterEditorCommand } from "@synaptix/command-system/device";
import { EditorCommandHistory } from "@synaptix/command-system/editor";
import { SetAutomationLaneEditorCommand } from "@synaptix/command-system/plugin";
import { createEmptyProject } from "@synaptix/project-model";
import { migrateProjectV1ToV2, type MusicProjectV2 } from "@synaptix/project-model/v2";

import {
  InMemoryProjectStorage,
  LocalProjectRepository,
  ProjectStorageCorruptionError,
  parseMusicProjectV2,
  parseVersionedMusicProject
} from "./index.ts";

function pluginProject(): MusicProjectV2 {
  const value = migrateProjectV1ToV2(createEmptyProject("project-1", { revisionId: "revision-1", now: "2026-09-22T00:00:00.000Z" }));
  value.tracks.push({
    id: "track-1", name: "Lead", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0, clips: [],
    devices: [{
      id: "device-drive", deviceType: "synaptix.reference-drive", deviceVersion: "1.0.0", enabled: true,
      parameters: [{ id: "drive", value: 3 }],
      plugin: { pluginId: "synaptix.reference-drive", vendorId: "synaptix", version: "1.0.0", runtimeKind: "audio-worklet", moduleChecksumSha256: null },
      pluginState: { stateVersion: 1, encoding: "json", payload: "{\"preset\":\"warm\"}", checksumSha256: null },
      automation: [],
      frozen: null
    }]
  });
  return value;
}

test("plug-in parameters, state, and automation survive save/reload and immutable revisions", async () => {
  const storage = new InMemoryProjectStorage();
  const repository = new LocalProjectRepository<MusicProjectV2>(storage, { parse: parseMusicProjectV2 });
  const history = new EditorCommandHistory<MusicProjectV2>();

  const first = await history.execute(pluginProject(), new SetDeviceParameterEditorCommand("track-1", "device-drive", "drive", 3, 8));
  await repository.save(first.project, first.revision);
  const second = await history.execute(first.project, new SetAutomationLaneEditorCommand("track-1", "device-drive", "drive", null, [
    { tick: 0, value: 1, curve: "linear" }, { tick: 3840, value: 12, curve: "step" }
  ]));
  await repository.save(second.project, second.revision);

  assert.deepEqual(await repository.load("project-1"), second.project);
  assert.deepEqual(await repository.loadRevision("project-1", first.revision.revisionId), first.project);
  assert.deepEqual(await repository.loadRevision("project-1", second.revision.revisionId), second.project);
  assert.equal((await repository.revisions("project-1")).length, 2);
});

test("v1 repositories refuse v2 snapshots instead of silently downgrading them", async () => {
  const storage = new InMemoryProjectStorage();
  await new LocalProjectRepository<MusicProjectV2>(storage, { parse: parseMusicProjectV2 }).save(pluginProject());
  await assert.rejects(new LocalProjectRepository(storage).load("project-1"));
});

test("tampered plug-in snapshots fail checksum verification", async () => {
  const storage = new InMemoryProjectStorage();
  const repository = new LocalProjectRepository<MusicProjectV2>(storage, { parse: parseMusicProjectV2 });
  await repository.save(pluginProject());
  const record = (await storage.getProject("project-1"))!;
  (record.project as MusicProjectV2).tracks[0]!.devices[0]!.parameters[0]!.value = 99;
  await storage.putProject(record);
  await assert.rejects(repository.load("project-1"), ProjectStorageCorruptionError);
});

test("versioned parsing dispatches on schemaVersion", () => {
  const v1 = createEmptyProject("project-1", { revisionId: "revision-1", now: "2026-09-22T00:00:00.000Z" });
  assert.equal(parseVersionedMusicProject(v1).schemaVersion, 1);
  assert.equal(parseVersionedMusicProject(pluginProject()).schemaVersion, 2);
  assert.throws(() => parseVersionedMusicProject({ ...v1, schemaVersion: 3 }), ProjectStorageCorruptionError);
});

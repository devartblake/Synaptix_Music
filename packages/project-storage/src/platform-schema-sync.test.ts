import assert from "node:assert/strict";
import test from "node:test";

import { computeProjectChecksum } from "@synaptix/command-system";
import { createEmptyProject } from "@synaptix/project-model";
import { migrateProjectV1ToV2, type MusicProjectV2 } from "@synaptix/project-model/v2";

import { InMemoryProjectStorage, LocalProjectRepository, parseVersionedMusicProject, type StoredMusicProject } from "./index.ts";
import {
  HybridProjectRepository,
  InMemoryProjectSyncQueue,
  platformEnvelopeConverter,
  type PlatformProjectRepository,
  type PlatformRevisionEnvelope
} from "./platform-sync.ts";

function builtinProject(): MusicProjectV2 {
  const v1 = createEmptyProject("project-1", { revisionId: "revision-1", now: "2026-09-22T00:00:00.000Z" });
  v1.tracks.push({
    id: "track-1", name: "Lead", kind: "instrument", muted: false, solo: false, volumeDb: 0, pan: 0, clips: [],
    devices: [{ id: "device-1", deviceType: "synaptix-poly-synth", deviceVersion: "1.0.0", enabled: true, parameters: [] }]
  });
  return migrateProjectV1ToV2(v1);
}

function pluginProject(): MusicProjectV2 {
  const project = builtinProject();
  project.tracks[0]!.devices.push({
    id: "device-drive", deviceType: "synaptix.reference-drive", deviceVersion: "1.0.0", enabled: true, parameters: [],
    plugin: { pluginId: "synaptix.reference-drive", vendorId: "synaptix", version: "1.0.0", runtimeKind: "audio-worklet", moduleChecksumSha256: null },
    pluginState: null, automation: [], frozen: null
  });
  return project;
}

async function envelopeFor(project: MusicProjectV2): Promise<PlatformRevisionEnvelope> {
  return {
    projectId: project.projectId,
    project,
    revision: {
      revisionId: project.revisionId, parentRevisionId: null, transactionId: "transaction-1", commandIds: [],
      createdAt: "2026-09-22T00:00:00.000Z", checksumSha256: await computeProjectChecksum(project)
    }
  };
}

const unusedPlatform: PlatformProjectRepository = {
  listProjects: async () => [],
  getProject: async () => null,
  uploadRevision: async () => { throw new Error("not used"); }
};

function repository(accepts: 1 | 2) {
  const local = new LocalProjectRepository<StoredMusicProject>(new InMemoryProjectStorage(), { parse: parseVersionedMusicProject });
  const queue = new InMemoryProjectSyncQueue();
  const hybrid = new HybridProjectRepository(local, unusedPlatform, queue, { toPlatformEnvelope: platformEnvelopeConverter(accepts) });
  return { local, queue, hybrid };
}

test("v1-only platforms receive lossless v1 snapshots with matching checksums", async () => {
  const { local, queue, hybrid } = repository(1);
  const envelope = await envelopeFor(builtinProject());
  assert.deepEqual(await hybrid.saveAndQueue(envelope, null, "key-1"), { queued: true });

  const [queued] = await queue.list();
  assert.equal(queued!.envelope.project.schemaVersion, 1);
  assert.equal(queued!.envelope.revision.checksumSha256, await computeProjectChecksum(queued!.envelope.project));
  assert.equal(queued!.envelope.revision.revisionId, envelope.revision.revisionId);
  assert.equal((await local.load("project-1"))!.schemaVersion, 2, "the local copy keeps v2");
});

test("plug-in projects stay local-only when the platform accepts v1 only", async () => {
  const { local, queue, hybrid } = repository(1);
  assert.deepEqual(await hybrid.saveAndQueue(await envelopeFor(pluginProject()), null, "key-1"), { queued: false });
  assert.deepEqual(await queue.list(), []);
  assert.deepEqual(await local.load("project-1"), pluginProject());
});

test("v2 platforms receive plug-in projects unchanged", async () => {
  const { queue, hybrid } = repository(2);
  const envelope = await envelopeFor(pluginProject());
  await hybrid.saveAndQueue(envelope, null, "key-1");
  assert.deepEqual((await queue.list())[0]!.envelope, envelope);
});

test("after a local-only plug-in revision, the next upload chains from the last platform revision", async () => {
  const { queue, hybrid } = repository(1);
  const base = builtinProject();                                   // revision-1, known to the platform
  const withPlugin = pluginProject();
  withPlugin.revisionId = "revision-2"; withPlugin.parentRevisionId = "revision-1";
  const removed = builtinProject();
  removed.revisionId = "revision-3"; removed.parentRevisionId = "revision-2";

  assert.deepEqual(await hybrid.saveAndQueue(await envelopeFor(withPlugin), base.revisionId, "key-2"), { queued: false });
  assert.deepEqual(await hybrid.saveAndQueue(await envelopeFor(removed), "revision-2", "key-3"), { queued: true });

  const [queued] = await queue.list();
  assert.equal(queued!.expectedRevisionId, "revision-1");
  assert.equal(queued!.envelope.revision.parentRevisionId, "revision-1");
  assert.equal(queued!.envelope.project.parentRevisionId, "revision-1");
  assert.equal(queued!.envelope.revision.checksumSha256, await computeProjectChecksum(queued!.envelope.project));
});

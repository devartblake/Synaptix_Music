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

function platformAt(head: string | null): PlatformProjectRepository {
  return {
    listProjects: async () => [],
    getProject: async () => head === null ? null : { projectId: "project-1", project: builtinProject(), revision: {
      revisionId: head, parentRevisionId: null, transactionId: "t", commandIds: [], createdAt: "2026-09-22T00:00:00.000Z", checksumSha256: "a".repeat(64)
    } },
    uploadRevision: async () => { throw new Error("not used"); }
  };
}

/** Saves revision-1 (on the platform) then a plug-in revision-2 that could not be uploaded. */
async function localPluginHead(accepts: 1 | 2, platformHead: string | null) {
  const local = new LocalProjectRepository<StoredMusicProject>(new InMemoryProjectStorage(), { parse: parseVersionedMusicProject });
  const queue = new InMemoryProjectSyncQueue();
  const hybrid = new HybridProjectRepository(local, platformAt(platformHead), queue, { toPlatformEnvelope: platformEnvelopeConverter(accepts) });
  const first = await envelopeFor(builtinProject());
  await local.save(first.project, first.revision);
  const project = { ...pluginProject(), revisionId: "revision-2", parentRevisionId: "revision-1" };
  const second = await envelopeFor(project);
  await local.save(project, { ...second.revision, parentRevisionId: "revision-1" });
  return { queue, hybrid };
}

test("a plug-in head saved before the platform accepted v2 is queued once it does", async () => {
  const blocked = await localPluginHead(1, "revision-1");
  assert.equal(await blocked.hybrid.queueUnsyncedHead("project-1"), "blocked");
  assert.deepEqual(await blocked.queue.list(), []);

  const { queue, hybrid } = await localPluginHead(2, "revision-1");
  assert.equal(await hybrid.queueUnsyncedHead("project-1"), "queued");
  assert.equal(await hybrid.queueUnsyncedHead("project-1"), "queued", "not queued twice");
  const operations = await queue.list();
  assert.equal(operations.length, 1);
  assert.equal(operations[0]!.expectedRevisionId, "revision-1");
  assert.equal(operations[0]!.envelope.project.schemaVersion, 2);
  assert.equal(operations[0]!.envelope.revision.checksumSha256, await computeProjectChecksum(operations[0]!.envelope.project));
});

test("a head the platform already has, or a project with no saves, needs nothing", async () => {
  const { hybrid } = await localPluginHead(2, "revision-2");
  assert.equal(await hybrid.queueUnsyncedHead("project-1"), "current");
  assert.equal(await repository(2).hybrid.queueUnsyncedHead("project-1"), "missing");
});

test("a head that diverged from the cloud keeps its parent so the upload conflicts", async () => {
  const { queue, hybrid } = await localPluginHead(2, "someone-elses-revision");
  assert.equal(await hybrid.queueUnsyncedHead("project-1"), "queued");
  const [operation] = await queue.list();
  assert.equal(operation!.expectedRevisionId, "revision-1");
});

test("a project the platform has never seen uploads as new", async () => {
  const { queue, hybrid } = await localPluginHead(2, null);
  assert.equal(await hybrid.queueUnsyncedHead("project-1"), "queued");
  const [operation] = await queue.list();
  assert.equal(operation!.expectedRevisionId, null);
  assert.equal(operation!.envelope.project.parentRevisionId, null);
});

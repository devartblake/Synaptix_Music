import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject, type MusicProject } from "@synaptix/project-model";
import {
  HybridProjectRepository,
  InMemoryProjectSyncQueue,
  type PlatformProjectRepository,
  type PlatformRevisionEnvelope
} from "./platform-sync.ts";

const OPERATION_ID = "00000000-0000-4000-8000-000000000001";

function envelope(projectId: string, revisionId: string): PlatformRevisionEnvelope {
  return {
    projectId,
    project: {
      projectId,
      revisionId,
      schemaVersion: 1,
      metadata: {
        name: "Project",
        createdAt: "2026-08-04T16:00:00.000Z",
        updatedAt: "2026-08-04T16:00:00.000Z"
      }
    } as MusicProject,
    revision: {
      revisionId,
      parentRevisionId: null,
      transactionId: "transaction-1",
      commandIds: [],
      checksumSha256: "checksum",
      createdAt: "2026-08-04T16:00:00.000Z"
    }
  };
}

test("accepted uploads leave the persistent queue", async () => {
  const queue = new InMemoryProjectSyncQueue();
  const platform: PlatformProjectRepository = {
    listProjects: async () => [],
    getProject: async () => null,
    uploadRevision: async (value) => ({ outcome: "accepted", currentRevisionId: value.revision.revisionId })
  };
  const local = { save: async () => undefined, load: async () => null };
  const repository = new HybridProjectRepository(local, platform, queue);
  await repository.saveAndQueue(envelope("7f1c2a4e-8d3b-4f6a-9e21-5b0c7d8e9f10", "revision-1"), null, "key-1", OPERATION_ID);

  const results = await repository.drain();

  assert.equal(results[0]?.outcome, "accepted");
  assert.equal((await queue.list()).length, 0);
});

test("conflicting uploads remain queued for explicit resolution", async () => {
  const queue = new InMemoryProjectSyncQueue();
  const remote = envelope("7f1c2a4e-8d3b-4f6a-9e21-5b0c7d8e9f10", "revision-remote");
  const platform: PlatformProjectRepository = {
    listProjects: async () => [],
    getProject: async () => remote,
    uploadRevision: async () => ({
      outcome: "conflict",
      expectedRevisionId: "revision-0",
      currentRevisionId: "revision-remote",
      remote
    })
  };
  const local = { save: async () => undefined, load: async () => null };
  const repository = new HybridProjectRepository(local, platform, queue);
  await repository.saveAndQueue(
    envelope("7f1c2a4e-8d3b-4f6a-9e21-5b0c7d8e9f10", "revision-local"),
    "revision-0",
    "key-1",
    OPERATION_ID
  );

  const results = await repository.drain();

  assert.equal(results[0]?.outcome, "conflict");
  assert.equal((await queue.list()).length, 1);
});

test("uploads queued for browser-only projects are dropped instead of blocking the queue", async () => {
  const queue = new InMemoryProjectSyncQueue();
  const uploaded: string[] = [];
  const platform = {
    listProjects: async () => [],
    getProject: async () => null,
    uploadRevision: async (envelope: { projectId: string; revision: { revisionId: string } }) => {
      uploaded.push(envelope.projectId);
      return { outcome: "accepted" as const, currentRevisionId: envelope.revision.revisionId };
    }
  };
  const local = { save: async () => undefined, load: async () => null };
  const hybrid = new HybridProjectRepository(local, platform as never, queue);
  const demo = createEmptyProject("local-demo");
  const real = createEmptyProject("7f1c2a4e-8d3b-4f6a-9e21-5b0c7d8e9f11");
  for (const project of [demo, real]) {
    await queue.enqueue({
      operationId: `op-${project.projectId}`, projectId: project.projectId, expectedRevisionId: null,
      idempotencyKey: `key-${project.projectId}`, queuedAt: "2026-09-26T00:00:00.000Z", attemptCount: 0,
      envelope: { projectId: project.projectId, project, revision: {
        revisionId: project.revisionId, parentRevisionId: null, transactionId: "t", commandIds: [],
        createdAt: "2026-09-26T00:00:00.000Z", checksumSha256: "a".repeat(64) } }
    });
  }

  await hybrid.drain();
  assert.deepEqual(uploaded, [real.projectId]);
  assert.deepEqual(await queue.list(), []);
  assert.equal(await hybrid.queueUnsyncedHead("local-demo"), "blocked");
});

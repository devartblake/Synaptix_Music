import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject } from "@synaptix/project-model";
import type { PlatformRevisionEnvelope } from "@synaptix/project-storage/platform-sync";

import {
  EditorSessionCoordinator,
  ProjectTabLease,
  type BroadcastChannelLike,
  type ProjectTabLeaseMessage
} from "./editor-session-coordinator.ts";

function envelope(revisionId = "revision-1"): PlatformRevisionEnvelope {
  const project = createEmptyProject("project-1", { name: "Recovery" });
  project.revisionId = revisionId;
  return {
    projectId: project.projectId,
    project,
    revision: {
      revisionId,
      parentRevisionId: null,
      transactionId: "transaction-1",
      commandIds: ["command-1"],
      createdAt: "2026-08-04T00:00:00.000Z",
      checksumSha256: "a".repeat(64)
    }
  };
}

class FakeChannel implements BroadcastChannelLike {
  messages: ProjectTabLeaseMessage[] = [];
  listener: ((event: MessageEvent<ProjectTabLeaseMessage>) => void) | null = null;
  postMessage(message: ProjectTabLeaseMessage): void { this.messages.push(message); }
  addEventListener(_type: "message", listener: (event: MessageEvent<ProjectTabLeaseMessage>) => void): void { this.listener = listener; }
  removeEventListener(): void { this.listener = null; }
  close(): void {}
  receive(message: ProjectTabLeaseMessage): void { this.listener?.({ data: message } as MessageEvent<ProjectTabLeaseMessage>); }
}

test("failed persistence can retry the same revision without replaying a command", async () => {
  const coordinator = new EditorSessionCoordinator();
  const pending = envelope();
  coordinator.markUnsaved(pending);
  let attempts = 0;

  const succeeded = await coordinator.retry(async (value) => {
    attempts += 1;
    assert.equal(value.revision.revisionId, pending.revision.revisionId);
  });

  assert.equal(succeeded, true);
  assert.equal(attempts, 1);
  assert.equal(coordinator.snapshot.state, "clean");
  assert.equal(coordinator.snapshot.pendingRevisionId, null);
});

test("failed retry preserves the pending revision and unload warning", async () => {
  const coordinator = new EditorSessionCoordinator();
  coordinator.markUnsaved(envelope());

  const succeeded = await coordinator.retry(async () => {
    throw new Error("IndexedDB unavailable");
  });

  assert.equal(succeeded, false);
  assert.equal(coordinator.snapshot.state, "failed");
  assert.match(coordinator.snapshot.error ?? "", /IndexedDB unavailable/);
  assert.equal(coordinator.shouldWarnBeforeUnload(), true);
});

test("competing project tab puts the current editor into read-only mode", () => {
  const channel = new FakeChannel();
  const coordinator = new EditorSessionCoordinator();
  let now = 10_000;
  const lease = new ProjectTabLease(
    "project-1",
    channel,
    (tabId) => coordinator.setCompetingTab(tabId),
    () => now,
    60_000,
    6_000
  );
  const stop = lease.start();

  channel.receive({ type: "claim", projectId: "project-1", tabId: "other-tab", sentAt: now });
  assert.equal(coordinator.snapshot.readOnly, true);
  assert.equal(coordinator.snapshot.competingTabId, "other-tab");

  channel.receive({ type: "release", projectId: "project-1", tabId: "other-tab", sentAt: now });
  assert.equal(coordinator.snapshot.readOnly, false);

  now += 7_000;
  stop();
});

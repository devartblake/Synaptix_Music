import assert from "node:assert/strict";
import test from "node:test";

import type { HybridProjectRepository } from "@synaptix/project-storage/platform-sync";

import { PlatformRequestError } from "./platform-project-repository.ts";
import { ProjectSyncCoordinator, type ProjectSyncSnapshot } from "./project-sync-coordinator.ts";

function coordinatorFailingWith(error: unknown) {
  const snapshots: ProjectSyncSnapshot[] = [];
  const repository = { drain: async () => { throw error; } } as unknown as HybridProjectRepository;
  return { coordinator: new ProjectSyncCoordinator(repository, (snapshot) => snapshots.push(snapshot)), snapshots };
}

test("a sync refused for lack of a sign-in is reported as signed out, not as an error", async () => {
  const { coordinator } = coordinatorFailingWith(new PlatformRequestError("Authentication is required.", 401));
  const snapshot = await coordinator.drain();
  assert.equal(snapshot.state, "signed-out");
  assert.equal(snapshot.error, null);
});

test("other sync failures stay errors with their message", async () => {
  const { coordinator } = coordinatorFailingWith(new PlatformRequestError("Platform unavailable", 503));
  const snapshot = await coordinator.drain();
  assert.equal(snapshot.state, "error");
  assert.equal(snapshot.error, "Platform unavailable");
});

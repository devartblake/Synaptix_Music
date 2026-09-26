import assert from "node:assert/strict";
import test from "node:test";

import { createEmptyProject } from "@synaptix/project-model";
import type { PlatformRevisionEnvelope } from "@synaptix/project-storage/platform-sync";

import { clearRecovery, journalRevision, readRecovery } from "./recovery-journal.ts";

class MemoryStore {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

function envelope(revisionId: string): PlatformRevisionEnvelope {
  const project = createEmptyProject("p1", { name: "Journal" });
  project.revisionId = revisionId;
  return {
    projectId: "p1",
    project,
    revision: {
      revisionId, parentRevisionId: null, transactionId: "t", commandIds: ["c"],
      createdAt: "2026-09-25T00:00:00.000Z", checksumSha256: "a".repeat(64)
    }
  };
}

test("an unsaved edit newer than the saved revision is offered back", () => {
  const store = new MemoryStore();
  assert.equal(journalRevision(envelope("rev-2"), store, () => "2026-09-25T10:00:00.000Z"), true);

  const entry = readRecovery("p1", "rev-1", store);
  assert.equal(entry?.envelope.revision.revisionId, "rev-2");
  assert.equal(entry?.journaledAt, "2026-09-25T10:00:00.000Z");
});

test("an edit that did save is dropped silently", () => {
  const store = new MemoryStore();
  journalRevision(envelope("rev-2"), store);
  assert.equal(readRecovery("p1", "rev-2", store), null);
  assert.equal(store.values.size, 0);
});

test("damaged or mismatched entries are discarded, and clearing works", () => {
  const store = new MemoryStore();
  store.setItem("synaptix-music:recovery:v1:p1", "{broken");
  assert.equal(readRecovery("p1", null, store), null);
  assert.equal(store.values.size, 0);

  const wrongProject = envelope("rev-3");
  store.setItem("synaptix-music:recovery:v1:p1", JSON.stringify({
    envelope: { ...wrongProject, projectId: "other" }, journaledAt: "x"
  }));
  assert.equal(readRecovery("p1", null, store), null);

  journalRevision(envelope("rev-4"), store);
  clearRecovery("p1", store);
  assert.equal(readRecovery("p1", null, store), null);
});

test("a blocked or full journal never breaks editing", () => {
  const full = { getItem: () => null, removeItem: () => undefined,
    setItem: () => { throw new DOMException("full", "QuotaExceededError"); } };
  assert.equal(journalRevision(envelope("rev-2"), full), false);
  assert.equal(journalRevision(envelope("rev-2"), null), false);
  assert.equal(readRecovery("p1", null, null), null);
});

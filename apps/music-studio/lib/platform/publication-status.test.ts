import assert from "node:assert/strict";
import test from "node:test";

import { draftPackageId, loadPackageVersions, publicationStatus } from "./publication-status.ts";

const version = (number: number, retentionStatus: "pending" | "active" | "superseded" | "revoked" | "expired", revisionId = "r1") => ({
  version: number,
  revisionId,
  projectChecksumSha256: "a".repeat(64),
  createdAt: `2026-10-0${number}T00:00:00.000Z`,
  retentionStatus,
  expiresAt: null
});

test("the active version is live, and says whether it came from the current revision", () => {
  assert.deepEqual(publicationStatus([version(1, "superseded"), version(2, "active", "r2")], "r2"),
    { kind: "live", version: 2, publishedAt: "2026-10-02T00:00:00.000Z", fromCurrentRevision: true, finalizing: null });
  assert.equal((publicationStatus([version(2, "active", "r2")], "r3") as { fromCurrentRevision: boolean }).fromCurrentRevision, false);
  // A newer version still being finalized doesn't replace the live one yet.
  assert.equal((publicationStatus([version(2, "active"), version(3, "pending")], "r1") as { finalizing: number }).finalizing, 3);
});

test("without an active version: finalizing, not live (and why), or never published", () => {
  assert.deepEqual(publicationStatus([version(1, "pending")], "r1"), { kind: "finalizing", version: 1 });
  assert.deepEqual(publicationStatus([version(1, "superseded"), version(2, "revoked")], "r1"), { kind: "not-live", version: 2, reason: "revoked" });
  assert.deepEqual(publicationStatus([version(1, "expired")], "r1"), { kind: "not-live", version: 1, reason: "expired" });
  assert.deepEqual(publicationStatus([], "r1"), { kind: "unpublished" });
});

test("the package comes from the project's Adaptive states draft, and bad drafts are ignored", () => {
  const storage = (value: string | null) => ({ getItem: () => value });
  assert.equal(draftPackageId("p", storage(JSON.stringify({ packageId: "pkg-1", states: [] }))), "pkg-1");
  assert.equal(draftPackageId("p", storage(null)), null);
  assert.equal(draftPackageId("p", storage("{not json")), null);
  assert.equal(draftPackageId("p", { getItem: () => { throw new Error("blocked"); } }), null);
});

test("loading asks for the package's versions and rejects malformed responses", async () => {
  const paths: string[] = [];
  const versions = await loadPackageVersions("pkg 1", async (path) => { paths.push(path); return [version(1, "active")]; });
  assert.equal(publicationStatus(versions, "r1").kind, "live");
  assert.deepEqual(paths, ["adaptive-packages/pkg%201/versions"]);
  await assert.rejects(loadPackageVersions("pkg", async () => [{ version: "one" }]));
});

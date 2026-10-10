import assert from "node:assert/strict";
import test from "node:test";

import { AdaptivePackageSharingSchema } from "@synaptix/platform-contracts/adaptive-packages";

import { loadSharing, shareableVersion, shareVersion, sharingDetail } from "./community-sharing.ts";

const packageId = "10000000-0000-4000-8000-0000000000aa";
const sharing = (overrides: Record<string, unknown> = {}) => AdaptivePackageSharingSchema.parse({
  packageId,
  kind: "community",
  sharing: "shared",
  sharedAt: "2026-10-05T12:00:00.000Z",
  takenDownAt: null,
  takedownReason: null,
  versions: [],
  ...overrides
});
const review = (version: number, state: "none" | "pending" | "approved" | "rejected", reason: string | null = null) =>
  ({ version, review: state, requestedAt: null, reviewedAt: null, reason });
const version = (number: number, retentionStatus: "pending" | "active" | "superseded") =>
  ({ version: number, revisionId: "r1", projectChecksumSha256: "a".repeat(64), createdAt: "2026-10-05T12:00:00.000Z", retentionStatus, expiresAt: null });

test("sharing always sends the confirmation, because the platform refuses to share without it", async () => {
  const calls: { path: string; init?: RequestInit }[] = [];
  await shareVersion(packageId, 2, async (path, init) => { calls.push({ path, init }); return sharing(); });
  assert.equal(calls[0]!.path, `adaptive-packages/${packageId}/versions/2/share`);
  assert.equal(calls[0]!.init!.method, "POST");
  assert.deepEqual(JSON.parse(calls[0]!.init!.body as string), { confirmPermanent: true });
});

test("a sharing answer the studio doesn't understand is refused rather than shown wrongly", async () => {
  await assert.rejects(loadSharing(packageId, async () => sharing({ sharing: "public" })));
  assert.equal((await loadSharing(packageId, async () => sharing({ sharing: "private", sharedAt: null }))).sharing, "private");
});

test("only the version games play now can be shared; one still being finalized can't", () => {
  assert.equal(shareableVersion([version(1, "superseded"), version(2, "active"), version(3, "pending")]), 2);
  assert.equal(shareableVersion([version(1, "pending")]), null);
});

test("the card says who can use the music and where its review stands", () => {
  assert.equal(sharingDetail(sharing({ sharing: "private", sharedAt: null })), "Only you can use this music.");
  assert.equal(sharingDetail(sharing({ versions: [review(1, "pending")] })), "Version 1 is waiting for review before players see it.");
  // Players keep the approved version while a newer one waits.
  assert.equal(sharingDetail(sharing({ versions: [review(1, "approved"), review(2, "pending")] })),
    "Players get version 1; version 2 is waiting for review.");
  assert.equal(sharingDetail(sharing({ versions: [review(1, "approved"), review(2, "rejected", "Too quiet")] })),
    "Version 2 wasn't approved (Too quiet). Players get version 1.");
  assert.equal(sharingDetail(sharing({ versions: [review(1, "approved"), review(2, "none")] })), "Players can use version 1.");
  assert.equal(sharingDetail(sharing({ takenDownAt: "2026-10-06T00:00:00.000Z", takedownReason: "Copyright claim" })),
    "Taken down by SynaptixPlay: Copyright claim");
});

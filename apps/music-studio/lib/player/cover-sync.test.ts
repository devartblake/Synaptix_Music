import assert from "node:assert/strict";
import test from "node:test";

import { coverSyncAction } from "./cover-sync.ts";

// A project's cover should look the same on every device. The platform's copy is the shared one.

test("a cover matching the platform's copy is left alone", () => {
  assert.equal(coverSyncAction("abc", { sha256: "abc" }), "none");
  assert.equal(coverSyncAction(null, null), "none");
});

test("a new or changed cover on the platform is downloaded, even over one only saved here", () => {
  assert.equal(coverSyncAction("abc", null), "download");
  assert.equal(coverSyncAction("new", { sha256: "old" }), "download");
  // Two devices disagreeing would otherwise never converge.
  assert.equal(coverSyncAction("abc", {}), "download");
});

test("a cover removed on another device is removed here; one never uploaded is uploaded", () => {
  assert.equal(coverSyncAction(null, { sha256: "abc" }), "delete-local");
  assert.equal(coverSyncAction(null, {}), "upload");
});

import assert from "node:assert/strict";
import test from "node:test";

import {
  AdaptivePackagePublishResponseSchema,
  AdaptivePackageRevokeResponseSchema,
  AdaptivePackageVersionSchema
} from "@synaptix/platform-contracts/adaptive-packages";

const packageId = "11111111-1111-4111-8111-111111111111";

test("publish outcomes accept the platform's .NET enum casing", () => {
  const parsed = AdaptivePackagePublishResponseSchema.parse({
    outcome: "AlreadyPublished", packageId, version: 2, errorMessage: null
  });
  assert.equal(parsed.outcome, "alreadyPublished");
  assert.throws(() => AdaptivePackagePublishResponseSchema.parse({
    outcome: "Exploded", packageId, version: 2, errorMessage: null
  }));
});

test("versions carry retention state and client-verifiable artifact descriptors without storage keys", () => {
  const version = {
    packageId, version: 1, projectId: "22222222-2222-4222-8222-222222222222",
    revisionId: "rev-1", projectChecksumSha256: "a".repeat(64), manifest: {},
    createdAt: "2026-09-23T12:00:00.000Z", retentionStatus: "active", expiresAt: null,
    artifacts: [{ artifactId: "33333333-3333-4333-8333-333333333333", mediaType: "audio/wav",
      checksumSha256: "b".repeat(64), byteLength: 4096 }]
  };
  assert.equal(AdaptivePackageVersionSchema.parse(version).retentionStatus, "active");
  assert.throws(() => AdaptivePackageVersionSchema.parse({
    ...version, artifacts: [{ ...version.artifacts[0], storageKey: "renders/x.wav" }]
  }), "storage keys must never reach clients");
  assert.throws(() => AdaptivePackageVersionSchema.parse({ ...version, retentionStatus: "deleted" }));
});

test("revoking the active version reports the restored version", () => {
  const parsed = AdaptivePackageRevokeResponseSchema.parse({
    outcome: "Revoked", packageId, version: 3, restoredVersion: 2
  });
  assert.deepEqual(parsed, { outcome: "revoked", packageId, version: 3, restoredVersion: 2 });
});

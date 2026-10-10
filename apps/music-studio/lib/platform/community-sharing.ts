import {
  AdaptivePackageSharingSchema,
  type AdaptivePackageSharing,
  type AdaptivePackageVersionSummary
} from "@synaptix/platform-contracts/adaptive-packages";

/**
 * Letting other players use the music (docs/plans/implementation/community-music-sharing-v1.md).
 * Music is private until its creator shares a finished version; sharing is final, and each shared
 * version waits for a human review before other players see it.
 */
type Request = (path: string, init?: RequestInit) => Promise<unknown>;

export async function loadSharing(packageId: string, request: Request, signal?: AbortSignal): Promise<AdaptivePackageSharing> {
  return AdaptivePackageSharingSchema.parse(
    await request(`adaptive-packages/${encodeURIComponent(packageId)}/sharing`, { signal })
  );
}

export async function shareVersion(packageId: string, version: number, request: Request): Promise<AdaptivePackageSharing> {
  return AdaptivePackageSharingSchema.parse(
    await request(`adaptive-packages/${encodeURIComponent(packageId)}/versions/${version}/share`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ confirmPermanent: true })
    })
  );
}

/** The version to share: the one games play now. Pending versions can't be shared until finalized. */
export function shareableVersion(versions: readonly AdaptivePackageVersionSummary[]): number | null {
  return versions.find((item) => item.retentionStatus === "active")?.version ?? null;
}

/** The review a version is in, or "none" if it was never sent. */
export function reviewOf(sharing: AdaptivePackageSharing, version: number) {
  return sharing.versions.find((item) => item.version === version) ?? null;
}

/** One line on what other players can see, for the SynaptixPlay card. */
export function sharingDetail(sharing: AdaptivePackageSharing): string {
  if (sharing.takenDownAt) return `Taken down by SynaptixPlay${sharing.takedownReason ? `: ${sharing.takedownReason}` : "."}`;
  if (sharing.sharing === "private") return "Only you can use this music.";
  const newest = [...sharing.versions].filter((item) => item.review !== "none").sort((left, right) => right.version - left.version);
  const approved = newest.find((item) => item.review === "approved");
  const latest = newest[0];
  if (latest?.review === "pending")
    return approved
      ? `Players get version ${approved.version}; version ${latest.version} is waiting for review.`
      : `Version ${latest.version} is waiting for review before players see it.`;
  if (latest?.review === "rejected")
    return `Version ${latest.version} wasn't approved${latest.reason ? ` (${latest.reason})` : ""}.${approved ? ` Players get version ${approved.version}.` : ""}`;
  return approved ? `Players can use version ${approved.version}.` : "Waiting for review.";
}

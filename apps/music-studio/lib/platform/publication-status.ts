import { AdaptivePackageVersionListSchema, type AdaptivePackageVersionSummary } from "@synaptix/platform-contracts/adaptive-packages";

/**
 * Whether a project's adaptive music is in SynaptixPlay games. Versions start "pending" while the
 * platform finalizes their artifacts, then become "active" (what players get); publishing again
 * supersedes the active one, and owners can revoke a version. (Stage 13, docs/plans/implementation.)
 */
export type PublicationStatus =
  | { kind: "live"; version: number; publishedAt: string; fromCurrentRevision: boolean; finalizing: number | null }
  | { kind: "finalizing"; version: number }
  | { kind: "not-live"; version: number; reason: "superseded" | "revoked" | "expired" }
  | { kind: "unpublished" };

export function publicationStatus(versions: readonly AdaptivePackageVersionSummary[], currentRevisionId: string): PublicationStatus {
  const newest = [...versions].sort((left, right) => right.version - left.version);
  const pending = newest.find((item) => item.retentionStatus === "pending") ?? null;
  const active = newest.find((item) => item.retentionStatus === "active");
  if (active) {
    return {
      kind: "live",
      version: active.version,
      publishedAt: active.createdAt,
      fromCurrentRevision: active.revisionId === currentRevisionId,
      finalizing: pending && pending.version > active.version ? pending.version : null
    };
  }
  if (pending) return { kind: "finalizing", version: pending.version };
  const latest = newest[0];
  if (!latest) return { kind: "unpublished" };
  return { kind: "not-live", version: latest.version, reason: latest.retentionStatus as "superseded" | "revoked" | "expired" };
}

/** The adaptive package this browser is authoring for the project, from the Adaptive states draft. */
export function draftPackageId(projectId: string, storage: Pick<Storage, "getItem"> = localStorage): string | null {
  try {
    const raw = storage.getItem(`synaptix-music:adaptive:v1:${projectId}`);
    const packageId = raw ? (JSON.parse(raw) as { packageId?: unknown }).packageId : null;
    return typeof packageId === "string" ? packageId : null;
  } catch {
    return null;
  }
}

/** The package's versions from the platform (the status is worked out from them as the project changes). */
export async function loadPackageVersions(
  packageId: string,
  request: (path: string, init?: RequestInit) => Promise<unknown>,
  signal?: AbortSignal
): Promise<AdaptivePackageVersionSummary[]> {
  return AdaptivePackageVersionListSchema.parse(
    await request(`adaptive-packages/${encodeURIComponent(packageId)}/versions`, { signal })
  );
}

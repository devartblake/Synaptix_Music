/*
 * Keeping a project's cover the same on every device. The platform's project list carries each
 * cover's SHA-256; a local cover remembers the hash of the platform copy it matches (`sha256`), or
 * none while it has only been saved in this browser.
 */

export type CoverSyncAction = "none" | "download" | "upload" | "delete-local";

/**
 * What to do with this browser's cover given the platform's. The platform's copy wins when both
 * exist and differ, so every device shows the same cover; a cover only ever saved here is uploaded.
 */
export function coverSyncAction(remoteSha256: string | null, local: { sha256?: string } | null): CoverSyncAction {
  if (remoteSha256) return local?.sha256 === remoteSha256 ? "none" : "download";
  if (!local) return "none";
  // The platform has no cover: removed on another device if this one was synced, otherwise never uploaded.
  return local.sha256 ? "delete-local" : "upload";
}

/** Uploads a cover; the platform copy's SHA-256, or null when the project isn't in the cloud or no one is signed in. */
export async function uploadCover(projectId: string, blob: Blob): Promise<string | null> {
  try {
    const response = await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/cover`, {
      method: "PUT",
      credentials: "include",
      headers: { "content-type": blob.type },
      body: blob
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { sha256?: unknown };
    return typeof body.sha256 === "string" ? body.sha256 : null;
  } catch {
    return null;
  }
}

export async function deleteRemoteCover(projectId: string): Promise<void> {
  try {
    await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/cover`, { method: "DELETE", credentials: "include" });
  } catch {
    // Offline or signed out: the next cloud sync sees the platform's cover and offers it again.
  }
}

export async function downloadCover(projectId: string): Promise<Blob | null> {
  try {
    const response = await fetch(`/api/platform/projects/${encodeURIComponent(projectId)}/cover`, {
      credentials: "include",
      cache: "no-store"
    });
    return response.ok ? await response.blob() : null;
  } catch {
    return null;
  }
}

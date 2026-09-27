"use client";

import type { RenderArtifact, RenderJob } from "@synaptix/render-contracts";
import {
  cacheVerifiedRender,
  IndexedDbMediaStore,
  type CachedRenderSummary,
  type MediaStore
} from "@synaptix/project-storage/media";
import { create } from "zustand";

import { extractErrorMessage } from "../platform/platform-project-repository";

/*
 * Rendered mixes saved in this browser for offline listening. Files come through this app's
 * own origin, are checked against the render worker's size and SHA-256 before being stored,
 * and are played from the local copy whenever one exists.
 */

let store: MediaStore | null = null;
function media(): MediaStore {
  store ??= new IndexedDbMediaStore();
  return store;
}

interface OfflineState {
  renders: CachedRenderSummary[];
  loaded: boolean;
  /** artifactId -> "downloading" | error message */
  pending: Record<string, string>;
  refresh(): Promise<void>;
  download(job: RenderJob, artifact: RenderArtifact): Promise<void>;
  remove(artifactId: string): Promise<void>;
}

export const useOfflineRenders = create<OfflineState>((set, get) => ({
  renders: [],
  loaded: false,
  pending: {},

  async refresh() {
    try {
      set({ renders: await media().listRenders(), loaded: true });
    } catch {
      set({ loaded: true });
    }
  },

  async download(job, artifact) {
    const { artifactId } = artifact;
    set((state) => ({ pending: { ...state.pending, [artifactId]: "downloading" } }));
    try {
      // Ask the browser not to evict downloads under storage pressure (best effort).
      await navigator.storage?.persist?.().catch(() => false);
      const response = await fetch(
        `/api/platform/render-jobs/${encodeURIComponent(job.jobId)}/artifacts/${encodeURIComponent(artifactId)}/content`,
        { credentials: "include", cache: "no-store" }
      );
      if (!response.ok) throw new Error(extractErrorMessage(await response.text(), response.status));
      const blob = await response.blob();
      await cacheVerifiedRender(media(), {
        artifactId,
        renderId: job.manifest.renderId,
        jobId: job.jobId,
        projectId: job.manifest.projectId,
        revisionId: job.manifest.revisionId,
        fileName: artifact.fileName,
        mediaType: artifact.mediaType,
        byteLength: artifact.byteLength,
        checksumSha256: artifact.checksumSha256,
        durationSeconds: artifact.durationSeconds
      }, blob.type ? blob : new Blob([blob], { type: artifact.mediaType }));
      set((state) => {
        const { [artifactId]: _done, ...pending } = state.pending;
        return { pending };
      });
      await get().refresh();
    } catch (cause) {
      set((state) => ({
        pending: { ...state.pending, [artifactId]: cause instanceof Error ? cause.message : "Download failed." }
      }));
    }
  },

  async remove(artifactId) {
    await media().deleteRender(artifactId);
    await get().refresh();
  }
}));

/** Object URL for a downloaded render, or null when it isn't stored. The caller revokes it. */
export async function cachedRenderUrl(artifactId: string): Promise<string | null> {
  try {
    const record = await media().getRender(artifactId);
    return record ? URL.createObjectURL(record.blob) : null;
  } catch {
    return null;
  }
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

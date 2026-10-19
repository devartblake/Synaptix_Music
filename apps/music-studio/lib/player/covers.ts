"use client";

import { useEffect } from "react";
import { IndexedDbMediaStore, type MediaStore } from "@synaptix/project-storage/media";
import { create } from "zustand";

import { prepareCoverImage } from "./cover-art";
import { coverSyncAction, deleteRemoteCover, downloadCover, uploadCover } from "./cover-sync";

/*
 * Custom cover art, shared by every view that shows a project's artwork. Object URLs are
 * created once per project and revoked when a cover changes, so the Library grid, the mini
 * player and Now Playing all update together. Covers of cloud projects are also kept on the
 * platform, so they follow the project to every device (see cover-sync.ts).
 */

let store: MediaStore | null = null;
function media(): MediaStore {
  store ??= new IndexedDbMediaStore();
  return store;
}

interface CoverState {
  /** projectId -> object URL, null when the project has no custom cover. Missing = not loaded. */
  urls: Record<string, string | null>;
}

export const useCovers = create<CoverState>(() => ({ urls: {} }));
const loading = new Set<string>();

function setUrl(projectId: string, url: string | null): void {
  const previous = useCovers.getState().urls[projectId];
  if (previous) URL.revokeObjectURL(previous);
  useCovers.setState((state) => ({ urls: { ...state.urls, [projectId]: url } }));
}

async function load(projectId: string): Promise<void> {
  if (loading.has(projectId) || projectId in useCovers.getState().urls) return;
  loading.add(projectId);
  try {
    const record = await media().getArtwork(projectId);
    setUrl(projectId, record ? URL.createObjectURL(record.blob) : null);
  } catch {
    setUrl(projectId, null);
  } finally {
    loading.delete(projectId);
  }
}

/** The project's custom cover URL, or null to fall back to generated artwork. */
export function useCoverUrl(projectId: string | null | undefined): string | null {
  const url = useCovers((state) => (projectId ? state.urls[projectId] : undefined));
  useEffect(() => {
    if (projectId) void load(projectId);
  }, [projectId]);
  return url ?? null;
}

export async function setProjectCover(projectId: string, file: File): Promise<void> {
  const prepared = await prepareCoverImage(file);
  const record = { projectId, ...prepared, updatedAt: new Date().toISOString() };
  await media().putArtwork(record);
  setUrl(projectId, URL.createObjectURL(prepared.blob));
  // Local-only projects (and signed-out sessions) keep the cover in this browser.
  const sha256 = await uploadCover(projectId, prepared.blob);
  if (sha256) await media().putArtwork({ ...record, sha256 });
}

export async function removeProjectCover(projectId: string): Promise<void> {
  await media().deleteArtwork(projectId);
  setUrl(projectId, null);
  await deleteRemoteCover(projectId);
}

/** Brings this browser's cover in line with the platform's (from the cloud project list). */
export async function syncProjectCover(projectId: string, remoteSha256: string | null): Promise<void> {
  const local = await media().getArtwork(projectId);
  switch (coverSyncAction(remoteSha256, local)) {
    case "download": {
      const blob = await downloadCover(projectId);
      if (!blob) return;
      const bitmap = await createImageBitmap(blob);
      const record = {
        projectId, blob, mediaType: blob.type, width: bitmap.width, height: bitmap.height,
        updatedAt: new Date().toISOString(), sha256: remoteSha256!
      };
      bitmap.close();
      await media().putArtwork(record);
      setUrl(projectId, URL.createObjectURL(blob));
      return;
    }
    case "delete-local":
      await media().deleteArtwork(projectId);
      setUrl(projectId, null);
      return;
    case "upload": {
      const sha256 = await uploadCover(projectId, local!.blob);
      if (sha256) await media().putArtwork({ ...local!, sha256 });
      return;
    }
    case "none":
      return;
  }
}

export function coverUrlFor(projectId: string): string | null {
  return useCovers.getState().urls[projectId] ?? null;
}

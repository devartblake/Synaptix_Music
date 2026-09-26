"use client";

import { useEffect } from "react";
import { IndexedDbMediaStore, type MediaStore } from "@synaptix/project-storage/media";
import { create } from "zustand";

import { prepareCoverImage } from "./cover-art";

/*
 * Custom cover art, shared by every view that shows a project's artwork. Object URLs are
 * created once per project and revoked when a cover changes, so the Library grid, the mini
 * player and Now Playing all update together.
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
  await media().putArtwork({ projectId, ...prepared, updatedAt: new Date().toISOString() });
  setUrl(projectId, URL.createObjectURL(prepared.blob));
}

export async function removeProjectCover(projectId: string): Promise<void> {
  await media().deleteArtwork(projectId);
  setUrl(projectId, null);
}

export function coverUrlFor(projectId: string): string | null {
  return useCovers.getState().urls[projectId] ?? null;
}

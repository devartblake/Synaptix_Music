"use client";

import { useEffect, useState } from "react";
import { toProjectV2, type MusicProjectV2 } from "@synaptix/project-model/v2";
import { IndexedDbProjectStorage, parseVersionedMusicProject } from "@synaptix/project-storage";

import { projectDurationSeconds, type PlaybackItem } from "./playback-model";

export interface LibraryEntry {
  projectId: string;
  name: string;
  updatedAt: string;
  project: MusicProjectV2 | null;
  durationSeconds: number;
}

export type LibraryStatus = "loading" | "ready" | "error";

/** Every project saved in this browser, newest first, with its parsed contents for artwork and timing. */
export function useLibrary(): { entries: LibraryEntry[]; status: LibraryStatus } {
  const [entries, setEntries] = useState<LibraryEntry[]>([]);
  const [status, setStatus] = useState<LibraryStatus>("loading");

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const storage = new IndexedDbProjectStorage();
        const summaries = await storage.listProjects();
        const loaded = await Promise.all(summaries.map(async (summary): Promise<LibraryEntry> => {
          try {
            const record = await storage.getProject(summary.projectId);
            const project = record ? toProjectV2(parseVersionedMusicProject(record.project)) : null;
            return {
              projectId: summary.projectId, name: summary.name, updatedAt: summary.updatedAt, project,
              durationSeconds: project ? projectDurationSeconds(project) : 0
            };
          } catch {
            // A damaged record stays listed but unplayable; the studio's recovery flow handles it.
            return { projectId: summary.projectId, name: summary.name, updatedAt: summary.updatedAt, project: null, durationSeconds: 0 };
          }
        }));
        if (!cancelled) {
          setEntries(loaded);
          setStatus("ready");
        }
      } catch {
        if (!cancelled) setStatus("error");
      }
    })();
    return () => { cancelled = true; };
  }, []);

  return { entries, status };
}

export function projectSubtitle(project: MusicProjectV2 | null): string {
  if (!project) return "Can't be read";
  const tracks = project.tracks.length;
  return `${tracks} ${tracks === 1 ? "track" : "tracks"} · ${Math.round(project.tempoMap[0]?.bpm ?? 120)} BPM`;
}

export function mixItem(entry: Pick<LibraryEntry, "projectId" | "name" | "project">): PlaybackItem {
  return { kind: "project", projectId: entry.projectId, title: entry.name, subtitle: projectSubtitle(entry.project), soloTrackId: null };
}

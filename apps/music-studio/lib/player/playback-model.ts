import type { MusicProject } from "@synaptix/project-model";
import { projectV2BuiltinView, type AnyMusicProject, type MusicProjectV2 } from "@synaptix/project-model/v2";

import { arrangementBars, barTicks } from "../editor/timeline-model.ts";

/** What the listening player can play: a live project (optionally one track solo) or a rendered file. */
export type PlaybackItem =
  | { kind: "project"; projectId: string; title: string; subtitle: string; soloTrackId: string | null }
  | { kind: "render"; projectId: string; title: string; subtitle: string; jobId: string; renderId: string; artifactId: string };

export type RepeatMode = "off" | "all" | "one";

export function playbackItemKey(item: PlaybackItem): string {
  return item.kind === "project"
    ? `project:${item.projectId}:${item.soloTrackId ?? "mix"}`
    : `render:${item.renderId}:${item.artifactId}`;
}

function v1(project: AnyMusicProject): MusicProject {
  return projectV2BuiltinView(project);
}

export function projectDurationTicks(project: AnyMusicProject): number {
  const view = v1(project);
  return arrangementBars(view) * barTicks(view);
}

export function ticksToSeconds(project: AnyMusicProject, ticks: number): number {
  const bpm = project.tempoMap[0]?.bpm ?? 120;
  return (ticks / project.transport.ticksPerQuarterNote) * (60 / bpm);
}

export function projectDurationSeconds(project: AnyMusicProject): number {
  return ticksToSeconds(project, projectDurationTicks(project));
}

export function formatClock(seconds: number): string {
  const safe = Number.isFinite(seconds) && seconds > 0 ? Math.floor(seconds) : 0;
  return `${Math.floor(safe / 60)}:${String(safe % 60).padStart(2, "0")}`;
}

/**
 * The project as the listening player should hear it: the whole mix, or one track soloed,
 * with the studio's loop switched off so a play-through ends and the queue can advance.
 */
export function listeningProject<P extends AnyMusicProject>(project: P, soloTrackId: string | null, repeat: RepeatMode): P {
  const copy = structuredClone(project);
  copy.transport.loopEnabled = repeat === "one";
  const duration = projectDurationTicks(project);
  copy.transport.loopRange = { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: duration };
  if (soloTrackId) {
    for (const track of copy.tracks) {
      track.solo = track.id === soloTrackId;
      if (track.id === soloTrackId) track.muted = false;
    }
  }
  return copy;
}

export interface QueueState {
  items: PlaybackItem[];
  index: number;
}

/** Index after the current item finishes, or null when playback should stop. */
export function nextIndex(queue: QueueState, repeat: RepeatMode, manual = false): number | null {
  if (queue.items.length === 0) return null;
  if (repeat === "one" && !manual) return queue.index;
  if (queue.index + 1 < queue.items.length) return queue.index + 1;
  return repeat === "all" || manual ? 0 : null;
}

/** "Previous" restarts the current item unless it has barely started, like most players. */
export function previousIndex(queue: QueueState, positionSeconds: number): number {
  if (positionSeconds > 3 || queue.items.length === 0) return queue.index;
  return queue.index > 0 ? queue.index - 1 : queue.items.length - 1;
}

export interface TrackSummary {
  trackId: string;
  name: string;
  kind: string;
  noteCount: number;
  instrument: string;
  pluginCount: number;
}

export function summarizeTracks(project: AnyMusicProject): TrackSummary[] {
  return project.tracks.map((track) => ({
    trackId: track.id,
    name: track.name,
    kind: track.kind,
    noteCount: track.clips.reduce((sum, clip) => sum + (clip.kind === "midi" ? clip.notes.length : 0), 0),
    instrument: (track.devices.find((device) => device.enabled)?.deviceType ?? "no instrument")
      .replace(/^synaptix[.-]/, "")
      .replace(/[-.]/g, " "),
    pluginCount: project.schemaVersion === 2
      ? (track as MusicProjectV2["tracks"][number]).devices
        .filter((device) => device.enabled && device.plugin.runtimeKind !== "builtin").length
      : 0
  }));
}

/** Stable 32-bit hash for deterministic artwork. */
export function hashString(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

export interface ArtworkPalette {
  hueA: number;
  hueB: number;
  hueC: number;
  rotation: number;
}

/** Generated cover colors; each project keeps the same artwork everywhere it appears. */
export function artworkPalette(seed: string): ArtworkPalette {
  const hash = hashString(seed);
  const hueA = hash % 360;
  return {
    hueA,
    hueB: (hueA + 40 + ((hash >>> 9) % 80)) % 360,
    hueC: (hueA + 180 + ((hash >>> 17) % 60)) % 360,
    rotation: (hash >>> 3) % 360
  };
}

/** Up to `count` normalized note heights (0..1) for the artwork's waveform, from the project's notes. */
export function artworkContour(project: AnyMusicProject | null, count = 24): number[] {
  const pitches = project?.tracks.flatMap((track) =>
    track.clips.flatMap((clip) => (clip.kind === "midi" ? clip.notes.map((note) => note.pitch) : []))
  ) ?? [];
  if (pitches.length === 0) return Array.from({ length: count }, (_, index) => 0.35 + 0.25 * Math.sin(index / 2));
  const min = Math.min(...pitches);
  const span = Math.max(1, Math.max(...pitches) - min);
  return Array.from({ length: count }, (_, index) => {
    const pitch = pitches[Math.floor((index / count) * pitches.length)]!;
    return 0.2 + 0.8 * ((pitch - min) / span);
  });
}

"use client";

import { BrowserAudioEngine } from "@synaptix/daw-engine";
import { toProjectV2, type MusicProjectV2 } from "@synaptix/project-model/v2";
import { IndexedDbProjectStorage, parseVersionedMusicProject } from "@synaptix/project-storage";
import { z } from "zod";
import { create } from "zustand";

import { platformRequest } from "../platform/platform-request";
import { safeDownloadUrl } from "../platform/render-export-model";
import {
  listeningProject,
  nextIndex,
  previousIndex,
  projectDurationSeconds,
  projectDurationTicks,
  type PlaybackItem,
  type RepeatMode
} from "./playback-model";

/*
 * The listening player. One module-level store survives client-side navigation between Home
 * and the Library, so the mini player keeps playing. Tone.js has a single global transport,
 * so the studio calls `release()` on mount: the player stops and the studio's own engine
 * takes the audio. Live projects play through a BrowserAudioEngine; renders through <audio>.
 */

export type PlayerStatus = "idle" | "loading" | "playing" | "paused" | "error";

export interface PlayerState {
  queue: PlaybackItem[];
  index: number;
  status: PlayerStatus;
  positionSeconds: number;
  durationSeconds: number;
  repeat: RepeatMode;
  error: string | null;
  expanded: boolean;
  playQueue(items: PlaybackItem[], startIndex?: number): Promise<void>;
  toggle(): Promise<void>;
  next(): Promise<void>;
  previous(): Promise<void>;
  seek(seconds: number): void;
  cycleRepeat(): void;
  setExpanded(expanded: boolean): void;
  /** Stop and free the audio device (the studio calls this when it opens). */
  release(): void;
}

let engine: BrowserAudioEngine | null = null;
let audio: HTMLAudioElement | null = null;
let loaded: { project: MusicProjectV2; durationTicks: number } | null = null;
let pollTimer: ReturnType<typeof setInterval> | null = null;
let loadToken = 0;

function stopBackends(): void {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = null;
  engine?.stop();
  if (audio) {
    audio.pause();
    audio.removeAttribute("src");
    audio.load();
  }
  loaded = null;
}

async function loadProject(projectId: string): Promise<MusicProjectV2> {
  const record = await new IndexedDbProjectStorage().getProject(projectId);
  if (!record) throw new Error("This project is no longer saved in this browser.");
  return toProjectV2(parseVersionedMusicProject(record.project));
}

const DownloadSchema = z.object({ artifactId: z.string(), downloadUrl: z.string() });

export const usePlayer = create<PlayerState>((set, get) => {
  function current(): PlaybackItem | undefined {
    const { queue, index } = get();
    return queue[index];
  }

  async function finished(): Promise<void> {
    const { queue, index, repeat } = get();
    const following = nextIndex({ items: queue, index }, repeat);
    if (following === null) {
      stopBackends();
      set({ status: "paused", positionSeconds: 0 });
      return;
    }
    set({ index: following });
    await start();
  }

  function updateMediaSession(item: PlaybackItem, playing: boolean): void {
    if (typeof navigator === "undefined" || !("mediaSession" in navigator)) return;
    navigator.mediaSession.metadata = new MediaMetadata({ title: item.title, artist: item.subtitle, album: "Synaptix Music" });
    navigator.mediaSession.playbackState = playing ? "playing" : "paused";
    navigator.mediaSession.setActionHandler("play", () => void get().toggle());
    navigator.mediaSession.setActionHandler("pause", () => void get().toggle());
    navigator.mediaSession.setActionHandler("nexttrack", () => void get().next());
    navigator.mediaSession.setActionHandler("previoustrack", () => void get().previous());
    navigator.mediaSession.setActionHandler("seekto", (details) => {
      if (details.seekTime !== undefined) get().seek(details.seekTime);
    });
  }

  async function start(): Promise<void> {
    const item = current();
    if (!item) return;
    const token = ++loadToken;
    stopBackends();
    set({ status: "loading", positionSeconds: 0, durationSeconds: 0, error: null });
    try {
      if (item.kind === "project") {
        const project = listeningProject(await loadProject(item.projectId), item.soloTrackId, get().repeat);
        if (token !== loadToken) return;
        engine ??= new BrowserAudioEngine();
        engine.loadProject(project);
        engine.stop();
        loaded = { project, durationTicks: projectDurationTicks(project) };
        set({ durationSeconds: projectDurationSeconds(project) });
        await engine.play();
        pollTimer = setInterval(() => {
          if (!engine || !loaded) return;
          const snapshot = engine.snapshot();
          set({ positionSeconds: snapshot.positionSeconds });
          if (get().repeat !== "one" && snapshot.playing && snapshot.positionTicks >= loaded.durationTicks) void finished();
        }, 200);
      } else {
        const result = DownloadSchema.parse(await platformRequest(
          `render-jobs/${encodeURIComponent(item.jobId)}/artifacts/${encodeURIComponent(item.artifactId)}/download-url`
        ));
        if (token !== loadToken) return;
        if (result.artifactId !== item.artifactId) throw new Error("The render link did not match the requested file.");
        audio ??= new Audio();
        audio.src = safeDownloadUrl(result.downloadUrl);
        audio.loop = get().repeat === "one";
        audio.ontimeupdate = () => set({ positionSeconds: audio!.currentTime, durationSeconds: audio!.duration || 0 });
        audio.onended = () => void finished();
        await audio.play();
      }
      if (token !== loadToken) return;
      set({ status: "playing" });
      updateMediaSession(item, true);
    } catch (cause) {
      if (token !== loadToken) return;
      stopBackends();
      set({ status: "error", error: cause instanceof Error ? cause.message : "Playback failed." });
    }
  }

  return {
    queue: [],
    index: 0,
    status: "idle",
    positionSeconds: 0,
    durationSeconds: 0,
    repeat: "off",
    error: null,
    expanded: false,

    async playQueue(items, startIndex = 0) {
      if (items.length === 0) return;
      set({ queue: items, index: Math.min(Math.max(0, startIndex), items.length - 1) });
      await start();
    },

    async toggle() {
      const { status } = get();
      const item = current();
      if (!item) return;
      if (status === "playing") {
        if (item.kind === "project") engine?.pause();
        else audio?.pause();
        set({ status: "paused" });
        updateMediaSession(item, false);
        return;
      }
      if (status === "paused" && (loaded || (item.kind === "render" && audio?.src))) {
        if (item.kind === "project") await engine?.play();
        else await audio?.play();
        set({ status: "playing" });
        updateMediaSession(item, true);
        return;
      }
      await start();
    },

    async next() {
      const { queue, index, repeat } = get();
      const following = nextIndex({ items: queue, index }, repeat, true);
      if (following === null) return;
      set({ index: following });
      await start();
    },

    async previous() {
      const { queue, index, positionSeconds } = get();
      const target = previousIndex({ items: queue, index }, positionSeconds);
      if (target === index) {
        get().seek(0);
        return;
      }
      set({ index: target });
      await start();
    },

    seek(seconds) {
      const item = current();
      if (!item) return;
      const clamped = Math.max(0, Math.min(seconds, get().durationSeconds || seconds));
      if (item.kind === "project" && engine && loaded) {
        const ticks = Math.round((clamped / Math.max(get().durationSeconds, 0.001)) * loaded.durationTicks);
        engine.seek({ bar: 0, beat: 0, tick: Math.max(0, ticks) });
      } else if (audio) {
        audio.currentTime = clamped;
      }
      set({ positionSeconds: clamped });
    },

    cycleRepeat() {
      const order: RepeatMode[] = ["off", "all", "one"];
      const repeat = order[(order.indexOf(get().repeat) + 1) % order.length]!;
      set({ repeat });
      if (audio) audio.loop = repeat === "one";
      if (engine && loaded) {
        // Re-apply the loop flag without restarting playback.
        engine.setLoop(repeat === "one");
      }
    },

    setExpanded(expanded) {
      set({ expanded });
    },

    release() {
      loadToken += 1;
      stopBackends();
      engine?.dispose();
      engine = null;
      set({ status: "idle", positionSeconds: 0, expanded: false });
    }
  };
});

export function currentItem(state: Pick<PlayerState, "queue" | "index">): PlaybackItem | undefined {
  return state.queue[state.index];
}

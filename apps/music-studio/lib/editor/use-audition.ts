"use client";

import { useCallback, useEffect, useState } from "react";
import type { AudioTransport } from "@synaptix/daw-engine";

const STORAGE_KEY = "synaptix-music:audition:v1";

const CHANGE_EVENT = "synaptix-audition-change";

export function readAuditionPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/** Saves the choice and tells every open editor (the piano roll, drums and Settings share it). */
export function writeAuditionPreference(value: boolean): void {
  try {
    localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
  } catch {
    // Storage unavailable: the choice lasts for this session only.
  }
  window.dispatchEvent(new CustomEvent(CHANGE_EVENT, { detail: value }));
}

/** Whether notes play as they are edited, kept in step with the other editors and Settings. */
export function useAuditionPreference(): [boolean, (value: boolean) => void] {
  const [enabled, setEnabled] = useState(true);
  useEffect(() => {
    setEnabled(readAuditionPreference());
    const changed = (event: Event) => setEnabled((event as CustomEvent<boolean>).detail);
    window.addEventListener(CHANGE_EVENT, changed);
    return () => window.removeEventListener(CHANGE_EVENT, changed);
  }, []);
  return [enabled, writeAuditionPreference];
}

/**
 * Plays notes as they are edited. On by default; the choice is remembered in
 * this browser. Preview is best-effort: audio that is not ready yet (before the
 * engine's first user gesture, or a muted/unloaded track) is silently skipped.
 */
export function useAudition(engine: AudioTransport, trackId: string) {
  const [enabled, setEnabled] = useAuditionPreference();

  const audition = useCallback(
    (pitch: number, velocity = 100) => {
      if (!enabled) return;
      void engine.auditionNote({ trackId, pitch, velocity }).catch(() => undefined);
    },
    [enabled, engine, trackId]
  );

  return { enabled, setEnabled, audition };
}

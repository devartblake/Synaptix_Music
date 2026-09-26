"use client";

import { useCallback, useEffect, useState } from "react";
import type { AudioTransport } from "@synaptix/daw-engine";

const STORAGE_KEY = "synaptix-music:audition:v1";

function readPreference(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

/**
 * Plays notes as they are edited. On by default; the choice is remembered in
 * this browser. Preview is best-effort: audio that is not ready yet (before the
 * engine's first user gesture, or a muted/unloaded track) is silently skipped.
 */
export function useAudition(engine: AudioTransport, trackId: string) {
  const [enabled, setEnabledState] = useState(true);
  useEffect(() => setEnabledState(readPreference()), []);

  const setEnabled = useCallback((value: boolean) => {
    setEnabledState(value);
    try {
      localStorage.setItem(STORAGE_KEY, value ? "on" : "off");
    } catch {
      // Storage unavailable: the choice lasts for this session only.
    }
  }, []);

  const audition = useCallback(
    (pitch: number, velocity = 100) => {
      if (!enabled) return;
      void engine.auditionNote({ trackId, pitch, velocity }).catch(() => undefined);
    },
    [enabled, engine, trackId]
  );

  return { enabled, setEnabled, audition };
}

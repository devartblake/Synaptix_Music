"use client";

import { useEffect, useState } from "react";

const KEY = "synaptix-music:studio-settings:v1";

/** Studio features people can turn off in Settings. Saved per browser; notes stay in the project either way. */
export interface StudioSettings {
  /** The project notebook, opened from the transport bar. */
  notebook: boolean;
  /** Sticky notes on track headers and in the inspector. */
  stickyNotes: boolean;
}
export const DEFAULT_STUDIO_SETTINGS: StudioSettings = { notebook: true, stickyNotes: true };

export function parseStudioSettings(raw: string | null): StudioSettings {
  try {
    const data: unknown = JSON.parse(raw ?? "null");
    if (!data || typeof data !== "object") return DEFAULT_STUDIO_SETTINGS;
    const stored = data as Record<string, unknown>;
    return {
      notebook: typeof stored.notebook === "boolean" ? stored.notebook : DEFAULT_STUDIO_SETTINGS.notebook,
      stickyNotes: typeof stored.stickyNotes === "boolean" ? stored.stickyNotes : DEFAULT_STUDIO_SETTINGS.stickyNotes
    };
  } catch {
    return DEFAULT_STUDIO_SETTINGS;
  }
}

export function useStudioSettings() {
  const [settings, setSettings] = useState<StudioSettings>(DEFAULT_STUDIO_SETTINGS);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    try { setSettings(parseStudioSettings(localStorage.getItem(KEY))); }
    catch { /* Unavailable storage: the defaults apply. */ }
    setReady(true);
  }, []);
  useEffect(() => {
    if (!ready) return;
    try { localStorage.setItem(KEY, JSON.stringify(settings)); }
    catch { /* The choice lasts until reload. */ }
  }, [settings, ready]);
  return {
    settings,
    update: (patch: Partial<StudioSettings>) => setSettings((current) => ({ ...current, ...patch }))
  };
}

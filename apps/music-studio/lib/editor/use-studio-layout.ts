"use client";

import { useEffect, useState } from "react";

const KEY = "synaptix-music:studio-layout:v1";
const DEFAULT = {
  navigationOpen: true,
  inspectorOpen: true,
  navigationWidth: null as number | null,
  inspectorWidth: 272,
  mixerHeight: 320
};
type StudioLayout = typeof DEFAULT;
const size = (value: unknown, min: number, max: number, fallback: number) =>
  typeof value === "number" && Number.isFinite(value)
    ? Math.max(min, Math.min(max, Math.round(value)))
    : fallback;

export function useStudioLayout() {
  const [layout, setLayout] = useState<StudioLayout>(DEFAULT);
  const [ready, setReady] = useState(false);
  const [viewport, setViewport] = useState({ width: 1440, height: 900 });

  useEffect(() => {
    try {
      const stored: unknown = JSON.parse(localStorage.getItem(KEY) ?? "null");
      if (stored && typeof stored === "object") {
        const data = stored as Record<string, unknown>;
        setLayout({
          navigationOpen: typeof data.navigationOpen === "boolean" ? data.navigationOpen : true,
          inspectorOpen: typeof data.inspectorOpen === "boolean" ? data.inspectorOpen : true,
          navigationWidth:
            data.navigationWidth == null ? null : size(data.navigationWidth, 160, 320, 208),
          inspectorWidth: size(data.inspectorWidth, 220, 400, 272),
          mixerHeight: size(data.mixerHeight, 180, 640, 320)
        });
      }
    } catch {
      /* Missing, invalid, and unavailable preference storage use defaults. */
    }
    setReady(true);
    const measure = () => setViewport({ width: window.innerWidth, height: window.innerHeight });
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(KEY, JSON.stringify(layout));
    } catch {
      /* Layout works without storage. */
    }
  }, [layout, ready]);

  const mobile = viewport.width <= 760;
  const narrow = viewport.width <= 1120;
  const navigationWidth = layout.navigationWidth ?? (narrow ? 184 : 208);
  const mixerMax = Math.max(180, Math.min(640, viewport.height - 220));
  return {
    layout,
    update: (patch: Partial<StudioLayout>) => setLayout((current) => ({ ...current, ...patch })),
    reset: () => setLayout(DEFAULT),
    navigationWidth,
    navigationVisible: layout.navigationOpen && !mobile,
    inspectorVisible: layout.inspectorOpen && !narrow,
    mixerHeight: Math.min(layout.mixerHeight, mixerMax),
    mixerMax,
    mobile,
    narrow
  };
}

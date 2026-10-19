"use client";

import { useEffect, useState } from "react";

const KEY = "synaptix-music:studio-layout:v1";
const DEFAULT = {
  navigationOpen: true,
  inspectorOpen: true,
  navigationWidth: null as number | null,
  inspectorWidth: 272,
  mixerHeight: 320,
  /** "v2" is the DAW layout (docs/plans/ui/studio-ui-v2.md), the default since step 9b; "v1" is the classic layout. */
  shell: "v2" as "v1" | "v2",
  /** 2 since the DAW layout became the default: a stored "v1" from before then was the old default, not a choice. */
  layoutVersion: 2,
  dockHeight: 320,
  dockTab: "editor" as DockTab,
  dockOpen: true
};
export type DockTab = "editor" | "devices" | "mixer";
const DOCK_TABS: readonly DockTab[] = ["editor", "devices", "mixer"];
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
          mixerHeight: size(data.mixerHeight, 180, 640, 320),
          shell: data.shell === "v1" && data.layoutVersion === 2 ? "v1" : "v2",
          layoutVersion: 2,
          dockHeight: size(data.dockHeight, 180, 640, 320),
          dockTab: DOCK_TABS.includes(data.dockTab as DockTab) ? (data.dockTab as DockTab) : "editor",
          dockOpen: typeof data.dockOpen === "boolean" ? data.dockOpen : true
        });
      }
    } catch {
      /* Missing, invalid, and unavailable preference storage use defaults. */
    }
    setReady(true);
    // The layout viewport, as CSS media queries see it. innerWidth is the visual viewport, which a phone
    // widens when it zooms out to fit the desktop-sized first paint, and then the phone layout never applies.
    const measure = () => setViewport({ width: document.documentElement.clientWidth, height: document.documentElement.clientHeight });
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
  const dockMax = Math.max(180, Math.min(640, viewport.height - 260));
  return {
    layout,
    update: (patch: Partial<StudioLayout>) => setLayout((current) => ({ ...current, ...patch })),
    // Panel sizes only: resetting doesn't switch shells.
    reset: () => setLayout((current) => ({ ...DEFAULT, shell: current.shell })),
    navigationWidth,
    navigationVisible: layout.navigationOpen && !mobile,
    inspectorVisible: layout.inspectorOpen && !narrow,
    mixerHeight: Math.min(layout.mixerHeight, mixerMax),
    mixerMax,
    v2: layout.shell === "v2",
    dockHeight: Math.min(layout.dockHeight, dockMax),
    dockMax,
    mobile,
    narrow
  };
}

"use client";

import type { ReactNode } from "react";

import { Button } from "../../../components/ui/StudioControls";
import { ResizeHandle } from "../../../components/ui/ResizeHandle";
import { PlatformAccount } from "../../../components/PlatformAccount";
import type { DockTab } from "../../../lib/editor/use-studio-layout";
import { MasterMeter } from "./MasterMeter";
import { ProjectTitle } from "./ProjectTitle";
import type { StudioTopbarProps } from "./StudioTopbar";

// The Studio UI v2 shell (docs/plans/ui/studio-ui-v2.md, step 2): transport bar, bottom dock and
// status bar. Content comes in as slots so both shells share the same editors and workspaces.

export type StudioView = "arrange" | "adaptive";

export const DOCK_TAB_LABELS: Record<DockTab, string> = { editor: "Editor", devices: "Devices", mixer: "Mixer" };
const DOCK_TAB_ORDER: readonly DockTab[] = ["editor", "devices", "mixer"];

/** One bar for playback, position, tempo, view, project actions, save and sync state. */
export function StudioTransportBar(props: StudioTopbarProps & {
  position: ReactNode;
  view: StudioView;
  onView: (view: StudioView) => void;
  onGenerate: () => void;
  onExport: () => void;
  layoutMenu: ReactNode;
}) {
  const { engine, playing, bpm } = props;
  return (
    <header className="studio-transportbar">
      <a className="studio-home" href="/" aria-label="Back to projects"><span className="studio-mark" aria-hidden="true">S</span></a>
      <div className="studio-title">
        <ProjectTitle name={props.name} disabled={props.renameDisabled} onRename={props.onRename} />
        <small>{props.storageStatus}</small>
      </div>
      <div className="transport-group" role="group" aria-label="Transport controls">
        <Button className="transport-primary" onClick={playing ? props.onPause : props.onPlay}>{playing ? "Pause" : "Play"}</Button>
        <Button onClick={props.onStop}>Stop</Button>
        <Button className="transport-icon" aria-label="Loop" title="Loop" aria-pressed={props.loopEnabled} onClick={props.onToggleLoop}><span aria-hidden="true">⟲</span></Button>
      </div>
      <div className="transport-group transport-readouts">
        {props.position}
        <label className="transport-lcd">
          <input type="number" min={20} max={300} value={bpm} aria-label="Tempo"
            onChange={(event) => {
              const raw = event.currentTarget.value;
              const next = event.currentTarget.valueAsNumber;
              if (raw === "" || !Number.isFinite(next) || next < 20 || next > 300 || next === bpm) return;
              props.onTempo(next);
            }} />
          <span aria-hidden="true">BPM</span>
        </label>
      </div>
      <div className="transport-group" role="group" aria-label="History">
        <Button className="transport-icon" aria-label="Undo" title="Undo" disabled={!props.canUndo} onClick={props.onUndo}><span aria-hidden="true">↶</span></Button>
        <Button className="transport-icon" aria-label="Redo" title="Redo" disabled={!props.canRedo} onClick={props.onRedo}><span aria-hidden="true">↷</span></Button>
      </div>
      <div className="view-switch" role="group" aria-label="View">
        {(["arrange", "adaptive"] as const).map((view) => (
          <Button key={view} aria-pressed={props.view === view} onClick={() => props.onView(view)}>
            {view === "arrange" ? "Arrange" : "Adaptive states"}
          </Button>
        ))}
      </div>
      <span className="transport-spacer" />
      <Button className="generation-cta" onClick={props.onGenerate}>Generate</Button>
      <Button onClick={props.onExport}>Export</Button>
      {props.layoutMenu}
      <div className="studio-status">
        <MasterMeter engine={engine} />
        <PlatformAccount compact />
      </div>
    </header>
  );
}

/** Save state, sync state and Sync now; in the v2 status bar. */
export function SaveSyncStatus({ saveState: session, syncLabel, syncTone, onSyncNow }: Pick<StudioTopbarProps, "saveState" | "syncLabel" | "syncTone" | "onSyncNow">) {
  return <>
    <span className="status-pill" role="status" aria-label="Save state">
      <span className={`status-dot ${session.state === "failed" ? "danger" : session.state === "saving" ? "warning" : ""}`} />
      {session.readOnly ? "Read-only" : session.state === "saving" ? "Saving…" : session.state === "failed" ? "Not saved" : session.state === "unsaved" ? "Unsaved" : "Saved"}
    </span>
    <span className="status-pill"><span className={`status-dot ${syncTone}`} />{syncLabel}</span>
    <Button className="studio-sync-now" onClick={onSyncNow}>Sync now</Button>
  </>;
}

/** The bottom dock: one tab at a time, about the selected clip or track (Alt+1/2/3). */
export function StudioDock({ tab, open, onTab, height, maxHeight, onResize, context, panels }: {
  tab: DockTab;
  open: boolean;
  /** Choosing the open tab collapses the dock; choosing another opens it on that tab. */
  onTab: (tab: DockTab) => void;
  height: number;
  maxHeight: number;
  onResize: (height: number) => void;
  context: ReactNode;
  panels: Record<DockTab, ReactNode>;
}) {
  return (
    <section id="studio-dock" className={`studio-dock${open ? "" : " studio-dock-collapsed"}`} aria-label="Dock"
      style={open ? { height } : undefined}>
      {open && <ResizeHandle label="Dock height" controls="studio-dock" orientation="horizontal"
        value={height} min={180} max={maxHeight} direction={-1} onChange={onResize} />}
      <div className="studio-dock-tabs">
        <div role="tablist" aria-label="Dock panels">
        {DOCK_TAB_ORDER.map((id, index) => (
          <button key={id} type="button" role="tab" id={`dock-tab-${id}`} aria-controls={`dock-panel-${id}`}
            aria-selected={open && tab === id} tabIndex={tab === id ? 0 : -1}
            onClick={() => onTab(id)}
            onKeyDown={(event) => {
              const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : 0;
              if (!step) return;
              event.preventDefault();
              const next = DOCK_TAB_ORDER[(index + step + DOCK_TAB_ORDER.length) % DOCK_TAB_ORDER.length]!;
              onTab(next);
              document.getElementById(`dock-tab-${next}`)?.focus();
            }}>
            {DOCK_TAB_LABELS[id]}<kbd aria-hidden="true">Alt+{index + 1}</kbd>
          </button>
        ))}
        </div>
        <span className="studio-dock-context">{context}</span>
        <Button className="studio-dock-toggle" aria-expanded={open} aria-controls="studio-dock" onClick={() => onTab(tab)}>
          {open ? "Collapse" : "Expand"}
        </Button>
      </div>
      {open && (
        <div className="studio-dock-body" role="tabpanel" id={`dock-panel-${tab}`} aria-labelledby={`dock-tab-${tab}`}>
          {panels[tab]}
        </div>
      )}
    </section>
  );
}

/** FL-style hint bar: what the focused or hovered control does, plus project facts. */
export function StudioStatusBar({ hint, facts }: { hint: string; facts: ReactNode }) {
  return (
    <footer className="studio-statusbar">
      <span className="studio-hint">{hint}</span>
      <span className="transport-spacer" />
      {facts}
    </footer>
  );
}

/** The hint for an element: its accessible name, else its text. */
export function hintFor(target: EventTarget | null): string | null {
  if (!(target instanceof Element)) return null;
  const control = target.closest("button, a, input, select, textarea, [role='slider'], [role='tab'], [aria-label]");
  if (!control) return null;
  const labelled = control.getAttribute("aria-label")
    ?? control.getAttribute("title")
    ?? (control instanceof HTMLInputElement || control instanceof HTMLSelectElement ? control.labels?.[0]?.textContent : null)
    ?? control.textContent;
  const text = labelled?.replace(/\s+/g, " ").trim();
  return text ? text.slice(0, 80) : null;
}

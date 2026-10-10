"use client";

import { Button } from "../../../components/ui/StudioControls";
import { ResizeHandle } from "../../../components/ui/ResizeHandle";
import type { Clip, Track } from "@synaptix/project-model";
import type { useStudioLayout } from "../../../lib/editor/use-studio-layout";

/** Right panel: project facts, the generator entry point and publication readiness. */
export function StudioInspector({ panelLayout, projectId, trackCount, bars, bpm, syncLabel, onOpenGenerator, selection, overlay }: {
  panelLayout: ReturnType<typeof useStudioLayout>;
  projectId: string;
  trackCount: number;
  bars: number;
  bpm: number;
  syncLabel: string;
  onOpenGenerator: () => void;
  /** The DAW layout: the selected clip and its track, shown above the project facts. */
  selection?: { clip: Clip; track: Track; instrument: string; output: string; bars: number; startBar: number } | null;
  /** The DAW layout on narrow screens: shown over the timeline when opened from the transport bar. */
  overlay?: { open: boolean; onClose: () => void };
}) {
  const asOverlay = Boolean(overlay?.open) && !panelLayout.inspectorVisible;
  return (
    <aside id="studio-inspector" className={`studio-inspector${asOverlay ? " studio-overlay studio-overlay-right" : ""}`}
      aria-label="Project inspector" hidden={!panelLayout.inspectorVisible && !asOverlay}
      onKeyDown={asOverlay ? (event) => { if (event.key === "Escape") { event.preventDefault(); overlay!.onClose(); } } : undefined}>
      {!asOverlay && <div className="inspector-resize-edge"><ResizeHandle label="Inspector panel size" controls="studio-inspector" orientation="vertical"
        value={panelLayout.layout.inspectorWidth} min={220} max={400} direction={-1}
        onChange={(inspectorWidth) => panelLayout.update({ inspectorWidth })} /></div>}
      <div className="inspector-heading"><h2 tabIndex={-1}>Project inspector</h2>
        {asOverlay ? <Button className="studio-overlay-close" onClick={overlay!.onClose}>Close</Button> : <span className="inspector-chip">Live</span>}
      </div>
      {selection && <section className="inspector-card inspector-selection" aria-label="Selection">
        <strong>{selection.clip.name}</strong>
        <dl className="property-list">
          <div className="property-row"><dt>Track</dt><dd>{selection.track.name}</dd></div>
          <div className="property-row"><dt>Instrument</dt><dd>{selection.instrument}</dd></div>
          <div className="property-row"><dt>Starts</dt><dd>Bar {selection.startBar}</dd></div>
          <div className="property-row"><dt>Length</dt><dd>{selection.bars} bars</dd></div>
          <div className="property-row"><dt>Notes</dt><dd>{selection.clip.kind === "midi" ? selection.clip.notes.length : "Audio"}</dd></div>
          <div className="property-row"><dt>Volume</dt><dd>{selection.track.volumeDb} dB</dd></div>
          <div className="property-row"><dt>Output</dt><dd>{selection.output}</dd></div>
        </dl>
      </section>}
      <dl className="property-list">
        <div className="property-row"><dt>Project</dt><dd>{projectId}</dd></div>
        <div className="property-row"><dt>Tracks</dt><dd>{trackCount}</dd></div>
        <div className="property-row"><dt>Length</dt><dd>{bars} bars</dd></div>
        <div className="property-row"><dt>Tempo</dt><dd>{bpm} BPM</dd></div>
        <div className="property-row"><dt>Sync</dt><dd>{syncLabel}</dd></div>
      </dl>
      <section className="inspector-card">
        <strong>AI generation</strong>
        <p>Create a variation from the active project while preserving its canonical revision history.</p>
        <Button className="generation-cta" onClick={onOpenGenerator}>Open generator</Button>
      </section>
      <section className="inspector-card">
        <strong>Publication readiness</strong>
        <div className="adaptive-row"><span className="adaptive-orb" />Stage 12 artifacts supported</div>
        <p>Certification evidence and immutable adaptive-package publication remain visible gates.</p>
      </section>
    </aside>
  );
}

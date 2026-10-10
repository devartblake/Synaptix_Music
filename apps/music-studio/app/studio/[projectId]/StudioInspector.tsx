"use client";

import { Button } from "../../../components/ui/StudioControls";
import { ResizeHandle } from "../../../components/ui/ResizeHandle";
import type { useStudioLayout } from "../../../lib/editor/use-studio-layout";

/** Right panel: project facts, the generator entry point and publication readiness. */
export function StudioInspector({ panelLayout, projectId, trackCount, bars, bpm, syncLabel, onOpenGenerator }: {
  panelLayout: ReturnType<typeof useStudioLayout>;
  projectId: string;
  trackCount: number;
  bars: number;
  bpm: number;
  syncLabel: string;
  onOpenGenerator: () => void;
}) {
  return (
    <aside id="studio-inspector" className="studio-inspector" aria-label="Project inspector" hidden={!panelLayout.inspectorVisible}>
      <div className="inspector-resize-edge"><ResizeHandle label="Inspector panel size" controls="studio-inspector" orientation="vertical"
        value={panelLayout.layout.inspectorWidth} min={220} max={400} direction={-1}
        onChange={(inspectorWidth) => panelLayout.update({ inspectorWidth })} /></div>
      <div className="inspector-heading"><h2>Project inspector</h2><span className="inspector-chip">Live</span></div>
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

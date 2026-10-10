"use client";

import { useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import type { AudioTransport } from "@synaptix/daw-engine";
import type { MusicProject } from "@synaptix/project-model";
import {
  SetLoopRegionEditorCommand,
  SetMarkersEditorCommand,
  type EditorCommand,
  type ProjectMarkers
} from "@synaptix/command-system/editor";
import { Button } from "../../../components/ui/StudioControls";
import { barRange, barTicks, positionTicks, tickPosition } from "../../../lib/editor/timeline-model";
import styles from "./editing.module.css";

// The DAW layout's section markers and loop brace (Studio UI v2, step 3b). Every change is one
// editor command, so it undoes like any other edit.

interface LaneProps {
  project: MusicProject;
  engine: AudioTransport;
  bars: number;
  duration: number;
  onExecute(command: EditorCommand): Promise<void>;
}

const percent = (ticks: number, duration: number) => `${(ticks / duration) * 100}%`;

/** Section markers: add at the playhead, click to jump, double-click or F2 to rename, Delete to remove. */
export function MarkerLane({ project, engine, duration, onExecute }: LaneProps) {
  const [renaming, setRenaming] = useState<string | null>(null);
  const markers = [...project.markers].sort((a, b) => positionTicks(project, a.position) - positionTicks(project, b.position));
  const replace = (next: ProjectMarkers) => onExecute(new SetMarkersEditorCommand(project.markers, next));

  function addMarker() {
    const bar = tickPosition(project, engine.snapshot().positionTicks).bar;
    const used = new Set(project.markers.map((marker) => marker.name));
    let index = project.markers.length + 1;
    while (used.has(`Section ${index}`)) index++;
    const marker = { id: crypto.randomUUID(), name: `Section ${index}`, kind: "section" as const, position: { bar, beat: 0, tick: 0 } };
    void replace([...project.markers, marker]).then(() => setRenaming(marker.id));
  }

  function rename(id: string, name: string) {
    setRenaming(null);
    const trimmed = name.trim();
    const current = project.markers.find((marker) => marker.id === id);
    if (!current || !trimmed || trimmed === current.name) return;
    void replace(project.markers.map((marker) => marker.id === id ? { ...marker, name: trimmed } : marker));
  }

  return (
    <div className={styles.laneRow}>
      <div className={styles.laneTitle}>
        <span>Markers</span>
        <Button className={styles.laneAction} onClick={addMarker} title="Add a section marker at the playhead's bar">+ Marker</Button>
      </div>
      <div className={styles.markerLane} role="list" aria-label="Section markers">
        {markers.map((marker) => (
          <div key={marker.id} role="listitem" className={styles.marker}
            style={{ left: percent(positionTicks(project, marker.position), duration) }}>
            {renaming === marker.id ? (
              <input aria-label={`Rename ${marker.name}`} defaultValue={marker.name} autoFocus maxLength={40}
                onBlur={(event) => rename(marker.id, event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") event.currentTarget.blur();
                  if (event.key === "Escape") setRenaming(null);
                }} />
            ) : (
              <button type="button" aria-label={`${marker.name}, bar ${marker.position.bar + 1}`}
                title="Click to jump · Double-click or F2 to rename · Delete to remove"
                onClick={() => engine.seek(marker.position)}
                onDoubleClick={() => setRenaming(marker.id)}
                onKeyDown={(event) => {
                  if (event.key === "F2") { event.preventDefault(); setRenaming(marker.id); }
                  if (event.key === "Delete" || event.key === "Backspace") {
                    event.preventDefault();
                    void replace(project.markers.filter((candidate) => candidate.id !== marker.id));
                  }
                }}>
                {marker.name}
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/** The loop brace: drag across bars to set the loop; the brace shows it, dimmed while looping is off. */
export function LoopLane({ project, bars, duration, onExecute }: LaneProps) {
  const lane = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<{ from: number; to: number } | null>(null);
  const { loopEnabled, loopRange } = project.transport;
  const previous = { enabled: loopEnabled, range: loopRange };

  const barAt = (event: ReactPointerEvent) => {
    const rect = lane.current!.getBoundingClientRect();
    return Math.max(0, Math.min(bars - 1, Math.floor(((event.clientX - rect.left) / rect.width) * bars)));
  };
  const shown = drag ? barRange(project, drag.from, drag.to) : loopRange;
  const firstBar = shown ? shown.start.bar + 1 : 0;
  const lastBar = shown ? Math.ceil((positionTicks(project, shown.start) + shown.durationTicks) / barTicks(project)) : 0;

  return (
    <div className={styles.laneRow}>
      <div className={styles.laneTitle}>
        <span>Loop</span>
        {loopRange && (
          <Button className={styles.laneAction} aria-label="Clear loop"
            onClick={() => void onExecute(new SetLoopRegionEditorCommand(previous, { enabled: false, range: null }))}>×</Button>
        )}
      </div>
      <div ref={lane} className={styles.loopLane} title="Drag across bars to set the loop"
        onPointerDown={(event) => {
          if (event.button !== 0) return;
          event.currentTarget.setPointerCapture(event.pointerId);
          const bar = barAt(event);
          setDrag({ from: bar, to: bar });
        }}
        onPointerMove={(event) => { if (drag) setDrag({ ...drag, to: barAt(event) }); }}
        onPointerUp={() => {
          if (!drag) return;
          setDrag(null);
          void onExecute(new SetLoopRegionEditorCommand(previous, { enabled: true, range: barRange(project, drag.from, drag.to) }));
        }}
        onPointerCancel={() => setDrag(null)}>
        {shown && (
          <div className={styles.loopBrace} data-enabled={drag !== null || loopEnabled} role="img"
            aria-label={`Loop: bars ${firstBar} to ${lastBar}${loopEnabled || drag ? "" : " (off)"}`}
            style={{ left: percent(positionTicks(project, shown.start), duration), width: percent(shown.durationTicks, duration) }}>
            <span>{firstBar === lastBar ? `Bar ${firstBar}` : `Bars ${firstBar}–${lastBar}`}</span>
          </div>
        )}
      </div>
    </div>
  );
}

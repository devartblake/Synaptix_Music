"use client";

import { useMemo, useRef, useState } from "react";

import type { EditorCommand } from "@synaptix/command-system/editor";
import {
  AddMidiNoteCommand,
  MoveMidiNotesCommand,
  QuantizeMidiNotesCommand,
  RemoveMidiNotesCommand,
  ResizeMidiNotesCommand,
  SetMidiVelocityCommand,
  TransposeMidiNotesCommand
} from "@synaptix/command-system/midi";
import type { MusicProject } from "@synaptix/project-model";

import {
  PIANO_ROLL_GRIDS,
  pitchFromPointer,
  snapTick,
  tickFromPointer,
  toggleSelection
} from "../../../lib/editor/piano-roll-model";

const LOWEST_PITCH = 36;
const HIGHEST_PITCH = 84;
const ROW_HEIGHT = 18;
const EDITOR_WIDTH = 1280;

type MidiClip = Extract<MusicProject["tracks"][number]["clips"][number], { kind: "midi" }>;
type DragState = {
  noteIds: string[];
  startX: number;
  startY: number;
  mode: "move" | "resize";
};

export interface PianoRollProps {
  project: MusicProject;
  trackId: string;
  clipId: string;
  onExecute(command: EditorCommand): Promise<void>;
  onClose(): void;
}

function noteName(pitch: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

export function PianoRoll({ project, trackId, clipId, onExecute, onClose }: PianoRollProps) {
  const track = project.tracks.find((value) => value.id === trackId);
  const clip = track?.clips.find((value) => value.id === clipId);
  if (!track || !clip || clip.kind !== "midi") return null;

  return <PianoRollEditor project={project} trackId={trackId} clip={clip} onExecute={onExecute} onClose={onClose} />;
}

function PianoRollEditor({
  project,
  trackId,
  clip,
  onExecute,
  onClose
}: {
  project: MusicProject;
  trackId: string;
  clip: MidiClip;
  onExecute(command: EditorCommand): Promise<void>;
  onClose(): void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [gridTicks, setGridTicks] = useState(240);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [velocity, setVelocity] = useState(100);
  const dragRef = useRef<DragState | null>(null);
  const rows = HIGHEST_PITCH - LOWEST_PITCH + 1;
  const editorHeight = rows * ROW_HEIGHT;
  const selectedIds = useMemo(() => [...selected], [selected]);

  async function addNote(event: React.MouseEvent<HTMLDivElement>): Promise<void> {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rawTick = tickFromPointer(event.clientX - rect.left, rect.width, clip.range.durationTicks);
    const startTick = snapEnabled ? snapTick(rawTick, gridTicks, clip.range.durationTicks - gridTicks) : rawTick;
    const pitch = pitchFromPointer(event.clientY - rect.top, rect.height, HIGHEST_PITCH, LOWEST_PITCH);
    const note = {
      id: crypto.randomUUID(),
      pitch,
      velocity,
      startTick,
      durationTicks: Math.min(gridTicks, clip.range.durationTicks - startTick)
    };
    await onExecute(new AddMidiNoteCommand(trackId, clip.id, note));
    setSelected(new Set([note.id]));
  }

  function beginDrag(event: React.PointerEvent, noteId: string, mode: "move" | "resize"): void {
    event.stopPropagation();
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextSelected = selected.has(noteId) ? selected : new Set([noteId]);
    setSelected(nextSelected);
    dragRef.current = { noteIds: [...nextSelected], startX: event.clientX, startY: event.clientY, mode };
  }

  async function endDrag(event: React.PointerEvent): Promise<void> {
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const deltaX = event.clientX - drag.startX;
    const deltaY = event.clientY - drag.startY;
    const rawTicks = Math.round((deltaX / EDITOR_WIDTH) * clip.range.durationTicks);
    const deltaTicks = snapEnabled ? Math.round(rawTicks / gridTicks) * gridTicks : rawTicks;
    if (drag.mode === "resize") {
      if (deltaTicks !== 0) await onExecute(new ResizeMidiNotesCommand(trackId, clip.id, drag.noteIds, deltaTicks));
      return;
    }
    const deltaPitch = -Math.round(deltaY / ROW_HEIGHT);
    if (deltaTicks !== 0 || deltaPitch !== 0) {
      await onExecute(new MoveMidiNotesCommand(trackId, clip.id, drag.noteIds, deltaTicks, deltaPitch));
    }
  }

  async function removeSelected(): Promise<void> {
    if (selectedIds.length === 0) return;
    await onExecute(new RemoveMidiNotesCommand(trackId, clip.id, selectedIds));
    setSelected(new Set());
  }

  return (
    <section aria-label="Piano roll editor" style={{ marginTop: 18, border: "1px solid #343943", borderRadius: 8, background: "#14171d" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: 12, borderBottom: "1px solid #343943" }}>
        <strong>{clip.name}</strong>
        <button onClick={onClose}>Arrangement</button>
        <label>Grid <select value={gridTicks} onChange={(event) => setGridTicks(Number(event.target.value))}>
          {PIANO_ROLL_GRIDS.map((grid) => <option key={grid.label} value={grid.ticks}>{grid.label}</option>)}
        </select></label>
        <label><input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} /> Snap</label>
        <button disabled={selectedIds.length === 0} onClick={() => void onExecute(new QuantizeMidiNotesCommand(trackId, clip.id, selectedIds, gridTicks))}>Quantize</button>
        <button disabled={selectedIds.length === 0} onClick={() => void onExecute(new TransposeMidiNotesCommand(trackId, clip.id, selectedIds, -1))}>−1 semitone</button>
        <button disabled={selectedIds.length === 0} onClick={() => void onExecute(new TransposeMidiNotesCommand(trackId, clip.id, selectedIds, 1))}>+1 semitone</button>
        <button disabled={selectedIds.length === 0} onClick={() => void removeSelected()}>Delete</button>
        <label>Velocity <input type="range" min={1} max={127} value={velocity} onChange={(event) => setVelocity(Number(event.target.value))}
          onPointerUp={() => selectedIds.length > 0 && void onExecute(new SetMidiVelocityCommand(trackId, clip.id, selectedIds, velocity))} /></label>
        <small>{selectedIds.length} selected · double-click grid to add</small>
      </header>
      <div style={{ overflow: "auto", maxHeight: 620 }}>
        <div style={{ display: "grid", gridTemplateColumns: "72px 1280px", width: 1352 }}>
          <div aria-hidden="true">
            {Array.from({ length: rows }, (_, index) => {
              const pitch = HIGHEST_PITCH - index;
              const black = [1, 3, 6, 8, 10].includes(pitch % 12);
              return <div key={pitch} style={{ height: ROW_HEIGHT, paddingRight: 6, textAlign: "right", fontSize: 11, background: black ? "#20242c" : "#e7e9ee", color: black ? "#fff" : "#111", borderBottom: "1px solid #333" }}>{noteName(pitch)}</div>;
            })}
          </div>
          <div
            onDoubleClick={(event) => void addNote(event)}
            onClick={() => setSelected(new Set())}
            style={{
              position: "relative",
              width: EDITOR_WIDTH,
              height: editorHeight,
              backgroundColor: "#171a20",
              backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${ROW_HEIGHT - 1}px, #292e37 ${ROW_HEIGHT - 1}px, #292e37 ${ROW_HEIGHT}px), repeating-linear-gradient(to right, transparent 0, transparent calc(${(gridTicks / clip.range.durationTicks) * 100}% - 1px), #2d3340 calc(${(gridTicks / clip.range.durationTicks) * 100}% - 1px), #2d3340 ${(gridTicks / clip.range.durationTicks) * 100}%)`
            }}
          >
            {clip.notes.filter((note) => note.pitch >= LOWEST_PITCH && note.pitch <= HIGHEST_PITCH).map((note) => {
              const isSelected = selected.has(note.id);
              const left = (note.startTick / clip.range.durationTicks) * EDITOR_WIDTH;
              const width = Math.max(4, (note.durationTicks / clip.range.durationTicks) * EDITOR_WIDTH);
              const top = (HIGHEST_PITCH - note.pitch) * ROW_HEIGHT + 2;
              return <div
                key={note.id}
                title={`${noteName(note.pitch)} · velocity ${note.velocity}`}
                onClick={(event) => {
                  event.stopPropagation();
                  setSelected(toggleSelection(selected, note.id, event.ctrlKey || event.metaKey || event.shiftKey));
                }}
                onPointerDown={(event) => beginDrag(event, note.id, "move")}
                onPointerUp={(event) => void endDrag(event)}
                style={{ position: "absolute", left, top, width, height: ROW_HEIGHT - 4, borderRadius: 3, border: isSelected ? "2px solid #fff" : "1px solid #8593ff", background: isSelected ? "#6877ff" : "#34417d", cursor: "grab", boxSizing: "border-box" }}
              >
                <span
                  onPointerDown={(event) => beginDrag(event, note.id, "resize")}
                  onPointerUp={(event) => void endDrag(event)}
                  style={{ position: "absolute", right: 0, top: 0, width: 6, height: "100%", cursor: "ew-resize", background: "rgba(255,255,255,.35)" }}
                />
              </div>;
            })}
          </div>
        </div>
      </div>
    </section>
  );
}

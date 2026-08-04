"use client";

import { useMemo, useRef, useState } from "react";

import type { EditorCommand } from "@synaptix/command-system/editor";
import {
  AddMidiNoteCommand,
  DuplicateMidiNotesCommand,
  MoveMidiNotesCommand,
  QuantizeMidiNotesCommand,
  RemoveMidiNotesCommand,
  ResizeMidiNotesCommand,
  SetMidiVelocityCommand,
  TransposeMidiNotesCommand
} from "@synaptix/command-system/midi";
import type { MusicProject } from "@synaptix/project-model";

import { isDrumTrack } from "../../../lib/editor/drum-step-sequencer-model";
import {
  clampZoom,
  notesInsideMarquee,
  rectangleFromPoints,
  type Point,
  type Rectangle
} from "../../../lib/editor/piano-roll-interactions";
import {
  PIANO_ROLL_GRIDS,
  pitchFromPointer,
  snapTick,
  tickFromPointer,
  toggleSelection
} from "../../../lib/editor/piano-roll-model";
import { DrumStepSequencer } from "./DrumStepSequencer";

const LOWEST_PITCH = 36;
const HIGHEST_PITCH = 84;
const BASE_ROW_HEIGHT = 18;
const BASE_EDITOR_WIDTH = 1280;

type Track = MusicProject["tracks"][number];
type MidiClip = Extract<Track["clips"][number], { kind: "midi" }>;
type DragState = { noteIds: string[]; startX: number; startY: number; mode: "move" | "resize" };
type MarqueeState = { start: Point; current: Point };

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
  if (isDrumTrack(track)) {
    return <DrumStepSequencer project={project} track={track} clip={clip} onExecute={onExecute} onClose={onClose} />;
  }
  return <PianoRollEditor trackId={trackId} clip={clip} onExecute={onExecute} onClose={onClose} />;
}

function PianoRollEditor({ trackId, clip, onExecute, onClose }: {
  trackId: string;
  clip: MidiClip;
  onExecute(command: EditorCommand): Promise<void>;
  onClose(): void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [gridTicks, setGridTicks] = useState(240);
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [velocity, setVelocity] = useState(100);
  const [horizontalZoom, setHorizontalZoom] = useState(1);
  const [verticalZoom, setVerticalZoom] = useState(1);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const rows = HIGHEST_PITCH - LOWEST_PITCH + 1;
  const rowHeight = BASE_ROW_HEIGHT * verticalZoom;
  const editorWidth = BASE_EDITOR_WIDTH * horizontalZoom;
  const editorHeight = rows * rowHeight;
  const selectedIds = useMemo(() => [...selected], [selected]);

  async function addNote(event: React.MouseEvent<HTMLDivElement>): Promise<void> {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rawTick = tickFromPointer(event.clientX - rect.left, rect.width, clip.range.durationTicks);
    const startTick = snapEnabled ? snapTick(rawTick, gridTicks, clip.range.durationTicks - gridTicks) : rawTick;
    const pitch = pitchFromPointer(event.clientY - rect.top, rect.height, HIGHEST_PITCH, LOWEST_PITCH);
    const note = { id: crypto.randomUUID(), pitch, velocity, startTick, durationTicks: Math.min(gridTicks, clip.range.durationTicks - startTick) };
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
    const rawTicks = Math.round(((event.clientX - drag.startX) / editorWidth) * clip.range.durationTicks);
    const deltaTicks = snapEnabled ? Math.round(rawTicks / gridTicks) * gridTicks : rawTicks;
    if (drag.mode === "resize") {
      if (deltaTicks !== 0) await onExecute(new ResizeMidiNotesCommand(trackId, clip.id, drag.noteIds, deltaTicks));
      return;
    }
    const deltaPitch = -Math.round((event.clientY - drag.startY) / rowHeight);
    if (deltaTicks !== 0 || deltaPitch !== 0) await onExecute(new MoveMidiNotesCommand(trackId, clip.id, drag.noteIds, deltaTicks, deltaPitch));
  }

  function beginMarquee(event: React.PointerEvent<HTMLDivElement>): void {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const point = { x: event.clientX - rect.left, y: event.clientY - rect.top };
    event.currentTarget.setPointerCapture(event.pointerId);
    setMarquee({ start: point, current: point });
  }

  function moveMarquee(event: React.PointerEvent<HTMLDivElement>): void {
    if (!marquee) return;
    const rect = event.currentTarget.getBoundingClientRect();
    setMarquee({ ...marquee, current: { x: event.clientX - rect.left, y: event.clientY - rect.top } });
  }

  function endMarquee(): void {
    if (!marquee) return;
    const box = rectangleFromPoints(marquee.start, marquee.current);
    const noteRects = clip.notes.filter((note) => note.pitch >= LOWEST_PITCH && note.pitch <= HIGHEST_PITCH).map((note) => ({
      id: note.id,
      left: (note.startTick / clip.range.durationTicks) * editorWidth,
      right: ((note.startTick + note.durationTicks) / clip.range.durationTicks) * editorWidth,
      top: (HIGHEST_PITCH - note.pitch) * rowHeight,
      bottom: (HIGHEST_PITCH - note.pitch + 1) * rowHeight
    }));
    setSelected(notesInsideMarquee(box, noteRects));
    setMarquee(null);
  }

  async function removeSelected(): Promise<void> {
    if (selectedIds.length === 0) return;
    await onExecute(new RemoveMidiNotesCommand(trackId, clip.id, selectedIds));
    setSelected(new Set());
  }

  const marqueeRect: Rectangle | null = marquee ? rectangleFromPoints(marquee.start, marquee.current) : null;

  return <section aria-label="Piano roll editor" style={{ marginTop: 18, border: "1px solid #343943", borderRadius: 8, background: "#14171d" }}>
    <header style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: 12, borderBottom: "1px solid #343943" }}>
      <strong>{clip.name}</strong><button onClick={onClose}>Arrangement</button>
      <label>Grid <select value={gridTicks} onChange={(event) => setGridTicks(Number(event.target.value))}>{PIANO_ROLL_GRIDS.map((grid) => <option key={grid.label} value={grid.ticks}>{grid.label}</option>)}</select></label>
      <label><input type="checkbox" checked={snapEnabled} onChange={(event) => setSnapEnabled(event.target.checked)} /> Snap</label>
      <button disabled={!selectedIds.length} onClick={() => void onExecute(new QuantizeMidiNotesCommand(trackId, clip.id, selectedIds, gridTicks))}>Quantize</button>
      <button disabled={!selectedIds.length} onClick={() => void onExecute(new DuplicateMidiNotesCommand(trackId, clip.id, selectedIds, gridTicks))}>Duplicate</button>
      <button disabled={!selectedIds.length} onClick={() => void onExecute(new TransposeMidiNotesCommand(trackId, clip.id, selectedIds, -1))}>−1</button>
      <button disabled={!selectedIds.length} onClick={() => void onExecute(new TransposeMidiNotesCommand(trackId, clip.id, selectedIds, 1))}>+1</button>
      <button disabled={!selectedIds.length} onClick={() => void removeSelected()}>Delete</button>
      <label>H zoom <input type="range" min={0.5} max={4} step={0.25} value={horizontalZoom} onChange={(event) => setHorizontalZoom(clampZoom(Number(event.target.value)))} /></label>
      <label>V zoom <input type="range" min={0.5} max={3} step={0.25} value={verticalZoom} onChange={(event) => setVerticalZoom(clampZoom(Number(event.target.value), 0.5, 3))} /></label>
      <small>{selectedIds.length} selected</small>
    </header>
    <div style={{ overflow: "auto", maxHeight: 620 }}><div style={{ display: "grid", gridTemplateColumns: `72px ${editorWidth}px`, width: 72 + editorWidth }}>
      <div aria-hidden="true">{Array.from({ length: rows }, (_, index) => { const pitch = HIGHEST_PITCH - index; const black = [1, 3, 6, 8, 10].includes(pitch % 12); return <div key={pitch} style={{ height: rowHeight, paddingRight: 6, textAlign: "right", fontSize: 11, background: black ? "#20242c" : "#e7e9ee", color: black ? "#fff" : "#111", borderBottom: "1px solid #333", boxSizing: "border-box" }}>{noteName(pitch)}</div>; })}</div>
      <div onDoubleClick={(event) => void addNote(event)} onPointerDown={beginMarquee} onPointerMove={moveMarquee} onPointerUp={endMarquee} style={{ position: "relative", width: editorWidth, height: editorHeight, backgroundColor: "#171a20", backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${rowHeight - 1}px, #292e37 ${rowHeight - 1}px, #292e37 ${rowHeight}px), repeating-linear-gradient(to right, transparent 0, transparent calc(${(gridTicks / clip.range.durationTicks) * 100}% - 1px), #2d3340 calc(${(gridTicks / clip.range.durationTicks) * 100}% - 1px), #2d3340 ${(gridTicks / clip.range.durationTicks) * 100}%)` }}>
        {clip.notes.filter((note) => note.pitch >= LOWEST_PITCH && note.pitch <= HIGHEST_PITCH).map((note) => { const isSelected = selected.has(note.id); const left = (note.startTick / clip.range.durationTicks) * editorWidth; const width = Math.max(4, (note.durationTicks / clip.range.durationTicks) * editorWidth); const top = (HIGHEST_PITCH - note.pitch) * rowHeight + 2; return <div key={note.id} title={`${noteName(note.pitch)} · velocity ${note.velocity}`} onClick={(event) => { event.stopPropagation(); setSelected(toggleSelection(selected, note.id, event.ctrlKey || event.metaKey || event.shiftKey)); }} onPointerDown={(event) => beginDrag(event, note.id, "move")} onPointerUp={(event) => void endDrag(event)} style={{ position: "absolute", left, top, width, height: rowHeight - 4, borderRadius: 3, border: isSelected ? "2px solid #fff" : "1px solid #8593ff", background: isSelected ? "#6877ff" : "#34417d", cursor: "grab", boxSizing: "border-box" }}><span onPointerDown={(event) => beginDrag(event, note.id, "resize")} onPointerUp={(event) => void endDrag(event)} style={{ position: "absolute", right: 0, top: 0, width: 6, height: "100%", cursor: "ew-resize", background: "rgba(255,255,255,.35)" }} /></div>; })}
        {marqueeRect && <div aria-hidden="true" style={{ position: "absolute", left: marqueeRect.left, top: marqueeRect.top, width: marqueeRect.right - marqueeRect.left, height: marqueeRect.bottom - marqueeRect.top, border: "1px solid #9aa6ff", background: "rgba(104,119,255,.15)", pointerEvents: "none" }} />}
      </div>
    </div></div>
    <footer style={{ padding: 12, borderTop: "1px solid #343943" }}><label>Velocity lane <input type="range" min={1} max={127} value={velocity} onChange={(event) => setVelocity(Number(event.target.value))} onPointerUp={() => selectedIds.length > 0 && void onExecute(new SetMidiVelocityCommand(trackId, clip.id, selectedIds, velocity))} style={{ width: "100%" }} /></label></footer>
  </section>;
}

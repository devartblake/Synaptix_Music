"use client";

import { Button, Panel, Toolbar } from "../../../components/ui/StudioControls";

import { useMemo, useRef, useState } from "react";
import type { AudioTransport } from "@synaptix/daw-engine";
import { CommitSlider } from "../../../components/ui/CommitSlider";
import {
  boundedNoteMove,
  boundedNoteResize as clampResizeDelta
} from "../../../lib/editor/note-editing";
import { barTicks } from "../../../lib/editor/timeline-model";
import { Playhead } from "./TransportPosition";
import styles from "./editing.module.css";

import type { EditorCommand } from "@synaptix/command-system/editor";
import {
  AddMidiNoteCommand,
  DuplicateMidiNotesCommand,
  MoveMidiNotesCommand,
  QuantizeMidiNotesCommand,
  RemoveMidiNotesCommand,
  ResizeMidiNotesCommand,
  SetMidiVelocityCommand
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
  engine: AudioTransport;
  trackId: string;
  clipId: string;
  onExecute(command: EditorCommand): Promise<void>;
  onClose(): void;
}

function noteName(pitch: number): string {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  return `${names[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

export function PianoRoll({
  project,
  engine,
  trackId,
  clipId,
  onExecute,
  onClose
}: PianoRollProps) {
  const track = project.tracks.find((value) => value.id === trackId);
  const clip = track?.clips.find((value) => value.id === clipId);
  if (!track || !clip || clip.kind !== "midi") return null;
  if (isDrumTrack(track)) {
    return (
      <DrumStepSequencer
        engine={engine}
        project={project}
        track={track}
        clip={clip}
        onExecute={onExecute}
        onClose={onClose}
      />
    );
  }
  return (
    <PianoRollEditor
      engine={engine}
      project={project}
      trackId={trackId}
      clip={clip}
      onExecute={onExecute}
      onClose={onClose}
    />
  );
}

function PianoRollEditor({
  project,
  engine,
  trackId,
  clip,
  onExecute: executeCommand,
  onClose
}: {
  project: MusicProject;
  engine: AudioTransport;
  trackId: string;
  clip: MidiClip;
  onExecute(command: EditorCommand): Promise<void>;
  onClose(): void;
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [gridRatio, setGridRatio] = useState(0.25);
  const gridTicks = Math.max(1, Math.round(project.transport.ticksPerQuarterNote * gridRatio));
  const [snapEnabled, setSnapEnabled] = useState(true);
  const [velocity, setVelocity] = useState(100);
  const [horizontalZoom, setHorizontalZoom] = useState(1);
  const [verticalZoom, setVerticalZoom] = useState(1);
  const [marquee, setMarquee] = useState<MarqueeState | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const highest = Math.max(HIGHEST_PITCH, ...clip.notes.map((note) => note.pitch));
  const lowest = Math.min(LOWEST_PITCH, ...clip.notes.map((note) => note.pitch));
  const rows = highest - lowest + 1;
  const [newPitch, setNewPitch] = useState(60);
  const [newTick, setNewTick] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const gridRef = useRef<HTMLDivElement>(null);
  async function onExecute(command: EditorCommand): Promise<void> {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await executeCommand(command);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The edit could not be saved.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }
  const rowHeight = BASE_ROW_HEIGHT * verticalZoom;
  const editorWidth = BASE_EDITOR_WIDTH * horizontalZoom;
  const editorHeight = rows * rowHeight;
  const selectedIds = useMemo(
    () => clip.notes.filter((note) => selected.has(note.id)).map((note) => note.id),
    [selected, clip.notes]
  );

  async function addNote(event: React.MouseEvent<HTMLDivElement>): Promise<void> {
    if (event.target !== event.currentTarget) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const rawTick = tickFromPointer(
      event.clientX - rect.left,
      rect.width,
      clip.range.durationTicks
    );
    const startTick = Math.min(
      clip.range.durationTicks - 1,
      snapEnabled
        ? snapTick(rawTick, gridTicks, Math.max(0, clip.range.durationTicks - gridTicks))
        : rawTick
    );
    const pitch = pitchFromPointer(event.clientY - rect.top, rect.height, highest, lowest);
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
    if (event.button !== 0) return;
    event.preventDefault();
    event.stopPropagation();
    (event.currentTarget.closest("button") as HTMLButtonElement)?.focus({ preventScroll: true });
    event.currentTarget.setPointerCapture(event.pointerId);
    const nextSelected =
      event.ctrlKey || event.metaKey || event.shiftKey
        ? toggleSelection(selected, noteId, true)
        : selected.has(noteId)
          ? selected
          : new Set([noteId]);
    setSelected(nextSelected);
    if (!nextSelected.has(noteId)) {
      dragRef.current = null;
      return;
    }
    dragRef.current = {
      noteIds: [...nextSelected],
      startX: event.clientX,
      startY: event.clientY,
      mode
    };
  }

  async function endDrag(event: React.PointerEvent): Promise<void> {
    event.stopPropagation();
    const drag = dragRef.current;
    dragRef.current = null;
    if (!drag) return;
    const rawTicks = Math.round(
      ((event.clientX - drag.startX) / editorWidth) * clip.range.durationTicks
    );
    const deltaTicks = snapEnabled ? Math.round(rawTicks / gridTicks) * gridTicks : rawTicks;
    if (drag.mode === "resize") {
      const safeDeltaTicks = clampResizeDelta(clip, drag.noteIds, deltaTicks);
      if (safeDeltaTicks !== 0) {
        await onExecute(new ResizeMidiNotesCommand(trackId, clip.id, drag.noteIds, safeDeltaTicks));
      }
      return;
    }
    const deltaPitch = -Math.round((event.clientY - drag.startY) / rowHeight);
    await moveNotes(drag.noteIds, deltaTicks, deltaPitch);
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
    setMarquee({
      ...marquee,
      current: { x: event.clientX - rect.left, y: event.clientY - rect.top }
    });
  }

  function endMarquee(): void {
    if (!marquee) return;
    const box = rectangleFromPoints(marquee.start, marquee.current);
    const noteRects = clip.notes.map((note) => ({
      id: note.id,
      left: (note.startTick / clip.range.durationTicks) * editorWidth,
      right: ((note.startTick + note.durationTicks) / clip.range.durationTicks) * editorWidth,
      top: (highest - note.pitch) * rowHeight,
      bottom: (highest - note.pitch + 1) * rowHeight
    }));
    setSelected(notesInsideMarquee(box, noteRects));
    setMarquee(null);
  }

  async function removeSelected(): Promise<void> {
    if (selectedIds.length === 0) return;
    await onExecute(new RemoveMidiNotesCommand(trackId, clip.id, selectedIds));
    setSelected(new Set());
  }

  async function moveNotes(ids: string[], ticks: number, pitch: number) {
    const delta = boundedNoteMove(clip, ids, ticks, pitch);
    if (delta.ticks || delta.pitch)
      await onExecute(new MoveMidiNotesCommand(trackId, clip.id, ids, delta.ticks, delta.pitch));
  }
  async function duplicate(ids: string[]) {
    const ticks = boundedNoteMove(clip, ids, gridTicks, 0).ticks;
    if (ticks > 0) await onExecute(new DuplicateMidiNotesCommand(trackId, clip.id, ids, ticks));
    else setError("Move the selection away from the clip end before duplicating.");
  }
  function keyboard(event: React.KeyboardEvent, noteId?: string) {
    const ids = noteId && !selected.has(noteId) ? [noteId] : selectedIds;
    const modifier = event.ctrlKey || event.metaKey;
    if (modifier && event.key.toLowerCase() === "a") {
      event.preventDefault();
      setSelected(new Set(clip.notes.map((note) => note.id)));
      return;
    }
    if (event.key === "Escape") {
      event.preventDefault();
      setSelected(new Set());
      dragRef.current = null;
      setMarquee(null);
      return;
    }
    if (event.altKey && ["ArrowLeft", "ArrowRight"].includes(event.key)) {
      event.preventDefault();
      const buttons = Array.from(
        gridRef.current?.querySelectorAll<HTMLButtonElement>("[data-note-id]") ?? []
      );
      const index = buttons.findIndex((button) => button.dataset.noteId === noteId);
      buttons[
        Math.max(0, Math.min(buttons.length - 1, index + (event.key === "ArrowLeft" ? -1 : 1)))
      ]?.focus();
      return;
    }
    if (!ids.length || (modifier && event.key.toLowerCase() !== "d")) return;
    if (
      !["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Delete", "Backspace"].includes(
        event.key
      ) &&
      !(modifier && event.key.toLowerCase() === "d")
    )
      return;
    event.preventDefault();
    setSelected(new Set(ids));
    if (event.repeat || busy.current) return;
    if (event.key === "Delete" || event.key === "Backspace") {
      void onExecute(new RemoveMidiNotesCommand(trackId, clip.id, ids)).then(() => {
        setSelected(new Set());
        gridRef.current?.focus();
      });
      return;
    }
    if (modifier) {
      void duplicate(ids);
      return;
    }
    const horizontal = event.key === "ArrowLeft" || event.key === "ArrowRight";
    const delta = event.key === "ArrowLeft" || event.key === "ArrowDown" ? -1 : 1;
    if (horizontal && event.shiftKey) {
      const ticks = clampResizeDelta(clip, ids, delta * gridTicks);
      if (ticks) void onExecute(new ResizeMidiNotesCommand(trackId, clip.id, ids, ticks));
    } else
      void moveNotes(
        ids,
        horizontal ? delta * (snapEnabled ? gridTicks : 1) : 0,
        horizontal ? 0 : delta * (event.shiftKey ? 12 : 1)
      );
  }

  const marqueeRect: Rectangle | null = marquee
    ? rectangleFromPoints(marquee.start, marquee.current)
    : null;

  return (
    <Panel aria-label="Piano roll editor">
      <Toolbar>
        <strong>{clip.name}</strong>
        <Button onClick={onClose}>Arrangement</Button>
        <label>
          Grid{" "}
          <select value={gridRatio} onChange={(event) => setGridRatio(Number(event.target.value))}>
            {PIANO_ROLL_GRIDS.map((item) => (
              <option key={item.label} value={item.ticks / 960}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={snapEnabled}
            onChange={(event) => setSnapEnabled(event.target.checked)}
          />{" "}
          Snap
        </label>
        <Button
          disabled={!selectedIds.length || pending}
          onClick={() =>
            void onExecute(new QuantizeMidiNotesCommand(trackId, clip.id, selectedIds, gridTicks))
          }
        >
          Quantize
        </Button>
        <Button
          disabled={!selectedIds.length || pending}
          onClick={() => void duplicate(selectedIds)}
        >
          Duplicate
        </Button>
        <Button
          aria-label="Transpose down"
          disabled={!selectedIds.length || pending}
          onClick={() => void moveNotes(selectedIds, 0, -1)}
        >
          −1
        </Button>
        <Button
          aria-label="Transpose up"
          disabled={!selectedIds.length || pending}
          onClick={() => void moveNotes(selectedIds, 0, 1)}
        >
          +1
        </Button>
        <Button disabled={!selectedIds.length || pending} onClick={() => void removeSelected()}>
          Delete
        </Button>
        <label>
          H zoom{" "}
          <input
            type="range"
            min={0.5}
            max={4}
            step={0.25}
            value={horizontalZoom}
            onChange={(event) => setHorizontalZoom(clampZoom(Number(event.target.value)))}
          />
        </label>
        <label>
          V zoom{" "}
          <input
            type="range"
            min={0.5}
            max={3}
            step={0.25}
            value={verticalZoom}
            onChange={(event) => setVerticalZoom(clampZoom(Number(event.target.value), 0.5, 3))}
          />
        </label>
        <span role="status" aria-label="Note selection">
          {selectedIds.length} selected
        </span>
      </Toolbar>
      <Toolbar aria-label="Insert MIDI note">
        <label>
          New note pitch{" "}
          <input
            type="number"
            min={0}
            max={127}
            value={newPitch}
            onChange={(event) =>
              setNewPitch(Math.max(0, Math.min(127, Math.round(Number(event.target.value)))))
            }
          />
        </label>
        <label>
          New note tick{" "}
          <input
            type="number"
            min={0}
            max={clip.range.durationTicks - 1}
            value={newTick}
            onChange={(event) =>
              setNewTick(
                Math.max(
                  0,
                  Math.min(clip.range.durationTicks - 1, Math.round(Number(event.target.value)))
                )
              )
            }
          />
        </label>
        <Button
          disabled={pending}
          onClick={() => {
            const startTick = snapEnabled
              ? snapTick(newTick, gridTicks, clip.range.durationTicks - 1)
              : newTick;
            const note = {
              id: crypto.randomUUID(),
              pitch: newPitch,
              startTick,
              velocity,
              durationTicks: Math.min(gridTicks, clip.range.durationTicks - startTick)
            };
            void onExecute(new AddMidiNoteCommand(trackId, clip.id, note)).then(() =>
              setSelected(new Set([note.id]))
            );
          }}
        >
          Add note
        </Button>
      </Toolbar>
      <p className={styles.hint} id="note-keyboard-help">
        Space selects · Shift-click adds to selection · Arrows move · Shift + left/right resizes ·
        Shift + up/down moves an octave · Alt + left/right focuses notes · Ctrl/Cmd+A selects all ·
        Ctrl/Cmd+D duplicates · Delete removes · Escape clears
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div className={styles.editorScroll}>
        <div style={{ width: editorWidth + 64 }}>
          <div
            style={{
              marginLeft: 64,
              display: "flex",
              height: 28,
              background: "var(--sx-surface-raised)"
            }}
            aria-hidden="true"
          >
            {Array.from(
              { length: Math.ceil(clip.range.durationTicks / barTicks(project)) },
              (_, bar) => (
                <span
                  key={bar}
                  style={{
                    width: `${(barTicks(project) / clip.range.durationTicks) * 100}%`,
                    padding: 6,
                    fontSize: 10
                  }}
                >
                  {bar + 1}
                </span>
              )
            )}
          </div>
          <div style={{ display: "grid", gridTemplateColumns: `64px ${editorWidth}px` }}>
            <div className={styles.pianoKeys} aria-hidden="true">
              {Array.from({ length: rows }, (_, index) => {
                const pitch = highest - index;
                return (
                  <div
                    key={pitch}
                    className={styles.pianoKey}
                    data-black={[1, 3, 6, 8, 10].includes(pitch % 12)}
                    style={{ height: rowHeight }}
                  >
                    {noteName(pitch)}
                  </div>
                );
              })}
            </div>
            <div
              ref={gridRef}
              className={styles.pianoGrid}
              role="group"
              aria-label="MIDI notes"
              aria-describedby="note-keyboard-help"
              tabIndex={0}
              onKeyDown={(event) => {
                if (event.target === event.currentTarget) keyboard(event);
              }}
              onDoubleClick={(event) => void addNote(event)}
              onPointerDown={beginMarquee}
              onPointerMove={moveMarquee}
              onPointerUp={endMarquee}
              onPointerCancel={() => {
                setMarquee(null);
                dragRef.current = null;
              }}
              style={{
                width: editorWidth,
                height: editorHeight,
                backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${rowHeight - 1}px, var(--sx-line-soft) ${rowHeight - 1}px, var(--sx-line-soft) ${rowHeight}px), repeating-linear-gradient(to right, transparent 0, transparent calc(${(gridTicks / clip.range.durationTicks) * 100}% - 1px), var(--sx-line-soft) calc(${(gridTicks / clip.range.durationTicks) * 100}% - 1px), var(--sx-line-soft) ${(gridTicks / clip.range.durationTicks) * 100}%)`
              }}
            >
              <Playhead
                engine={engine}
                project={project}
                clip={clip}
                duration={clip.range.durationTicks}
              />
              {clip.notes.map((note, index) => (
                <button
                  key={note.id}
                  type="button"
                  className={styles.note}
                  data-note-id={note.id}
                  data-pitch={note.pitch}
                  data-start={note.startTick}
                  data-duration={note.durationTicks}
                  data-velocity={note.velocity}
                  aria-label={`${noteName(note.pitch)}, tick ${note.startTick}, duration ${note.durationTicks}, velocity ${note.velocity}`}
                  aria-pressed={selected.has(note.id)}
                  tabIndex={
                    selectedIds[0] === note.id || (!selectedIds.length && index === 0) ? 0 : -1
                  }
                  onClick={(event) => {
                    if (event.detail === 0)
                      setSelected(
                        toggleSelection(
                          selected,
                          note.id,
                          event.ctrlKey || event.metaKey || event.shiftKey
                        )
                      );
                  }}
                  onKeyDown={(event) => keyboard(event, note.id)}
                  onPointerDown={(event) => beginDrag(event, note.id, "move")}
                  onPointerUp={(event) => void endDrag(event)}
                  onPointerCancel={() => {
                    dragRef.current = null;
                  }}
                  style={{
                    left: (note.startTick / clip.range.durationTicks) * editorWidth,
                    top: (highest - note.pitch) * rowHeight + 2,
                    width: Math.max(
                      6,
                      (note.durationTicks / clip.range.durationTicks) * editorWidth
                    ),
                    height: rowHeight - 4
                  }}
                >
                  <span
                    className={styles.noteResize}
                    aria-hidden="true"
                    onPointerDown={(event) => beginDrag(event, note.id, "resize")}
                    onPointerUp={(event) => void endDrag(event)}
                  />
                </button>
              ))}
              {marqueeRect && (
                <div
                  aria-hidden="true"
                  className={styles.marquee}
                  style={{
                    left: marqueeRect.left,
                    top: marqueeRect.top,
                    width: marqueeRect.right - marqueeRect.left,
                    height: marqueeRect.bottom - marqueeRect.top
                  }}
                />
              )}
            </div>
          </div>
        </div>
      </div>
      <footer className={styles.velocity}>
        <CommitSlider
          label="Velocity"
          value={
            selectedIds.length
              ? clip.notes.find((note) => selected.has(note.id))!.velocity
              : velocity
          }
          min={1}
          max={127}
          step={1}
          disabled={pending}
          format={(value) => String(value)}
          onCommit={async (value) => {
            setVelocity(value);
            if (selectedIds.length)
              await onExecute(new SetMidiVelocityCommand(trackId, clip.id, selectedIds, value));
          }}
        />
      </footer>
    </Panel>
  );
}

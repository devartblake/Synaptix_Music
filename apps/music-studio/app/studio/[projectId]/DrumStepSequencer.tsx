"use client";

import { Button, Panel, Toolbar } from "../../../components/ui/StudioControls";

import { useMemo, useRef, useState } from "react";

import type { AudioTransport } from "@synaptix/daw-engine";
import { useTransport } from "../../../lib/editor/use-transport";
import { clipPlaybackTick } from "../../../lib/editor/timeline-model";
import styles from "./editing.module.css";
import type { EditorCommand } from "@synaptix/command-system/editor";
import {
  RemoveMidiNotesCommand,
  DuplicateMidiNotesCommand,
  SetMidiVelocityCommand,
  ToggleDrumStepCommand
} from "@synaptix/command-system/midi";
import type { MusicProject } from "@synaptix/project-model";

import {
  nextStepVelocity,
  noteAtStep,
  notesInBar,
  resolveDrumLanes,
  ticksPerBar,
  ticksPerStep
} from "../../../lib/editor/drum-step-sequencer-model";

type Track = MusicProject["tracks"][number];
type MidiClip = Extract<Track["clips"][number], { kind: "midi" }>;

export interface DrumStepSequencerProps {
  project: MusicProject;
  engine: AudioTransport;
  track: Track;
  clip: MidiClip;
  onExecute(command: EditorCommand): Promise<void>;
  onClose(): void;
}

export function DrumStepSequencer({
  project,
  engine,
  track,
  clip,
  onExecute: executeCommand,
  onClose
}: DrumStepSequencerProps) {
  const [patternBars, setPatternBars] = useState(1);
  const [defaultVelocity, setDefaultVelocity] = useState(100);
  const [startBar, setStartBar] = useState(0);
  const [follow, setFollow] = useState(true);
  const [focus, setFocus] = useState({ lane: 0, step: 0 });
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const busy = useRef(false);
  const root = useRef<HTMLDivElement>(null);
  const lanes = useMemo(() => resolveDrumLanes(track), [track]);
  const barTicks = ticksPerBar(project);
  const stepTicks = Math.max(1, Math.round(ticksPerStep(project)));
  const barCount = Math.max(1, Math.ceil(clip.range.durationTicks / barTicks));
  const snapshot = useTransport(engine);
  const localTick = clipPlaybackTick(project, clip, snapshot.positionTicks);
  const visibleBar =
    follow && snapshot.playing && localTick !== null
      ? Math.floor(localTick / barTicks / patternBars) * patternBars
      : Math.min(startBar, barCount - 1);
  const firstStep = visibleBar * 16;
  const totalSteps = Math.min(
    patternBars * 16,
    Math.ceil(clip.range.durationTicks / stepTicks) - firstStep
  );
  const activeStep = localTick === null ? -1 : Math.floor(localTick / stepTicks);
  const rowStyle = { gridTemplateColumns: `130px repeat(${totalSteps}, 34px)` };
  async function onExecute(command: EditorCommand) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await executeCommand(command);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The step could not be saved.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  async function toggleStep(pitch: number, absoluteStep: number): Promise<void> {
    await onExecute(
      new ToggleDrumStepCommand(
        track.id,
        clip.id,
        pitch,
        absoluteStep * stepTicks,
        Math.max(
          1,
          Math.min(Math.floor(stepTicks * 0.8), clip.range.durationTicks - absoluteStep * stepTicks)
        ),
        defaultVelocity
      )
    );
  }

  async function cycleVelocity(pitch: number, absoluteStep: number): Promise<void> {
    const note = noteAtStep(clip.notes, pitch, absoluteStep, stepTicks);
    if (!note) return;
    await onExecute(
      new SetMidiVelocityCommand(track.id, clip.id, [note.id], nextStepVelocity(note.velocity))
    );
  }

  async function duplicateBar(sourceBar: number): Promise<void> {
    if (sourceBar + 1 >= barCount) return;
    const source = notesInBar(clip.notes, sourceBar, barTicks).filter(
      (note) =>
        lanes.some((lane) => lane.pitch === note.pitch) &&
        note.startTick + barTicks + note.durationTicks <= clip.range.durationTicks
    );
    if (source.length === 0) return;
    await onExecute(
      new DuplicateMidiNotesCommand(
        track.id,
        clip.id,
        source.map((note) => note.id),
        barTicks,
        (note) => `${note.id}-bar-${sourceBar + 2}-${crypto.randomUUID()}`
      )
    );
  }

  const visibleNotes = clip.notes.filter(
    (note) =>
      lanes.some((lane) => lane.pitch === note.pitch) &&
      note.startTick >= firstStep * stepTicks &&
      note.startTick < (firstStep + totalSteps) * stepTicks
  );

  return (
    <Panel aria-label="Drum step sequencer">
      <Toolbar>
        <strong>{clip.name} · Steps</strong>
        <Button onClick={onClose}>Arrangement</Button>
        <label>
          Pattern{" "}
          <select
            value={patternBars}
            onChange={(event) => {
              setPatternBars(Number(event.target.value));
              setFocus({ lane: 0, step: 0 });
            }}
          >
            {[1, 2, 4].map((bars) => (
              <option key={bars} value={bars}>
                {bars} {bars === 1 ? "bar" : "bars"}
              </option>
            ))}
          </select>
        </label>
        <label>
          Start bar{" "}
          <select
            value={visibleBar}
            onChange={(event) => {
              setStartBar(Number(event.target.value));
              setFollow(false);
              setFocus({ lane: 0, step: 0 });
            }}
          >
            {Array.from({ length: barCount }, (_, bar) => (
              <option key={bar} value={bar}>
                {bar + 1}
              </option>
            ))}
          </select>
        </label>
        <label>
          <input
            type="checkbox"
            checked={follow}
            onChange={(event) => setFollow(event.target.checked)}
          />{" "}
          Follow playback
        </label>
        <label>
          New-step velocity{" "}
          <input
            type="range"
            min={1}
            max={127}
            value={defaultVelocity}
            onChange={(event) => setDefaultVelocity(Number(event.target.value))}
          />{" "}
          {defaultVelocity}
        </label>
        <Button
          disabled={totalSteps < 32 || pending}
          onClick={() => void duplicateBar(visibleBar + Math.floor(totalSteps / 16) - 2)}
        >
          Duplicate previous bar
        </Button>
        <Button
          disabled={!visibleNotes.length || pending}
          onClick={() =>
            void onExecute(
              new RemoveMidiNotesCommand(
                track.id,
                clip.id,
                visibleNotes.map((note) => note.id)
              )
            )
          }
        >
          Clear visible steps
        </Button>
      </Toolbar>
      <p className={styles.hint} id="step-keyboard-help">
        Arrows navigate · Home/End moves within a lane · Space or Enter toggles · V or right-click
        cycles velocity · Delete clears a step · Highlight follows the project transport
      </p>
      {error && (
        <p role="alert" className={styles.error}>
          {error}
        </p>
      )}
      <div
        className={styles.stepScroll}
        ref={root}
        role="group"
        aria-label="Drum steps"
        aria-describedby="step-keyboard-help"
      >
        <div style={{ minWidth: 130 + totalSteps * 38 }}>
          <div className={styles.stepRow} style={rowStyle} aria-hidden="true">
            <strong className={styles.laneName}>LANE</strong>
            {Array.from({ length: totalSteps }, (_, step) => (
              <span className={styles.stepNumber} key={step}>
                {step % 16 === 0 ? `${visibleBar + Math.floor(step / 16) + 1}.1` : (step % 16) + 1}
              </span>
            ))}
          </div>
          {lanes.map((lane, laneIndex) => (
            <div key={lane.id} className={styles.stepRow} style={rowStyle}>
              <div className={styles.laneName}>
                <strong>{lane.label}</strong>
                <small>MIDI {lane.pitch}</small>
              </div>
              {Array.from({ length: totalSteps }, (_, step) => {
                const absolute = firstStep + step;
                const note = noteAtStep(clip.notes, lane.pitch, absolute, stepTicks);
                return (
                  <button
                    type="button"
                    key={step}
                    className={styles.step}
                    aria-label={`${lane.label} step ${absolute + 1}`}
                    aria-pressed={Boolean(note)}
                    aria-description={note ? `Velocity ${note.velocity}` : "Empty step"}
                    aria-current={snapshot.playing && activeStep === absolute ? "step" : undefined}
                    data-lane={laneIndex}
                    data-step={step}
                    data-beat={step % 4 === 0}
                    data-velocity={
                      note
                        ? note.velocity >= 115
                          ? "accent"
                          : note.velocity < 80
                            ? "soft"
                            : "normal"
                        : undefined
                    }
                    tabIndex={
                      focus.lane === laneIndex && Math.min(focus.step, totalSteps - 1) === step
                        ? 0
                        : -1
                    }
                    onFocus={() => setFocus({ lane: laneIndex, step })}
                    onClick={() => void toggleStep(lane.pitch, absolute)}
                    onContextMenu={(event) => {
                      event.preventDefault();
                      void cycleVelocity(lane.pitch, absolute);
                    }}
                    onKeyDown={(event) => {
                      if (event.ctrlKey || event.metaKey || event.altKey) return;
                      if (
                        event.key.toLowerCase() === "v" ||
                        event.key === "Delete" ||
                        event.key === "Backspace"
                      ) {
                        event.preventDefault();
                        if (event.repeat) return;
                        if (event.key.toLowerCase() === "v")
                          void cycleVelocity(lane.pitch, absolute);
                        else if (note) void toggleStep(lane.pitch, absolute);
                        return;
                      }
                      let nextLane = laneIndex,
                        nextStep = step;
                      if (event.key === "ArrowLeft") nextStep--;
                      else if (event.key === "ArrowRight") nextStep++;
                      else if (event.key === "ArrowUp") nextLane--;
                      else if (event.key === "ArrowDown") nextLane++;
                      else if (event.key === "Home") nextStep = 0;
                      else if (event.key === "End") nextStep = totalSteps - 1;
                      else return;
                      event.preventDefault();
                      root.current
                        ?.querySelector<HTMLButtonElement>(
                          `[data-lane="${Math.max(0, Math.min(lanes.length - 1, nextLane))}"][data-step="${Math.max(0, Math.min(totalSteps - 1, nextStep))}"]`
                        )
                        ?.focus();
                    }}
                  >
                    {note ? (note.velocity >= 115 ? "A" : "●") : ""}
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </Panel>
  );
}

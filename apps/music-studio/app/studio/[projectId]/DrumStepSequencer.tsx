"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { EditorCommand } from "@synaptix/command-system/editor";
import {
  ClearDrumPatternCommand,
  DuplicateMidiNotesCommand,
  SetMidiVelocityCommand,
  ToggleDrumStepCommand
} from "@synaptix/command-system/midi";
import type { MusicProject } from "@synaptix/project-model";

import {
  nextStepVelocity,
  noteAtStep,
  notesInBar,
  playbackStep,
  resolveDrumLanes,
  ticksPerBar,
  ticksPerStep
} from "../../../lib/editor/drum-step-sequencer-model";

type Track = MusicProject["tracks"][number];
type MidiClip = Extract<Track["clips"][number], { kind: "midi" }>;

export interface DrumStepSequencerProps {
  project: MusicProject;
  track: Track;
  clip: MidiClip;
  onExecute(command: EditorCommand): Promise<void>;
  onClose(): void;
}

export function DrumStepSequencer({
  project,
  track,
  clip,
  onExecute,
  onClose
}: DrumStepSequencerProps) {
  const [patternBars, setPatternBars] = useState(1);
  const [defaultVelocity, setDefaultVelocity] = useState(100);
  const [previewing, setPreviewing] = useState(false);
  const [currentStep, setCurrentStep] = useState(0);
  const startedAtRef = useRef(0);
  const lanes = useMemo(() => resolveDrumLanes(track), [track]);
  const barTicks = ticksPerBar(project);
  const stepTicks = ticksPerStep(project);
  const totalSteps = patternBars * 16;
  const bpm = project.tempoMap[0]?.bpm ?? 120;

  useEffect(() => {
    if (!previewing) return;
    startedAtRef.current = performance.now();
    const timer = window.setInterval(() => {
      setCurrentStep(playbackStep(performance.now() - startedAtRef.current, bpm, patternBars));
    }, 30);
    return () => window.clearInterval(timer);
  }, [bpm, patternBars, previewing]);

  async function toggleStep(pitch: number, absoluteStep: number): Promise<void> {
    await onExecute(new ToggleDrumStepCommand(
      track.id,
      clip.id,
      pitch,
      absoluteStep * stepTicks,
      Math.max(1, Math.floor(stepTicks * 0.8)),
      defaultVelocity
    ));
  }

  async function cycleVelocity(pitch: number, absoluteStep: number): Promise<void> {
    const note = noteAtStep(clip.notes, pitch, absoluteStep, stepTicks);
    if (!note) return;
    await onExecute(new SetMidiVelocityCommand(track.id, clip.id, [note.id], nextStepVelocity(note.velocity)));
  }

  async function duplicateBar(sourceBar: number): Promise<void> {
    if (sourceBar + 1 >= patternBars) return;
    const source = notesInBar(clip.notes, sourceBar, barTicks).filter((note) =>
      lanes.some((lane) => lane.pitch === note.pitch)
    );
    if (source.length === 0) return;
    await onExecute(new DuplicateMidiNotesCommand(
      track.id,
      clip.id,
      source.map((note) => note.id),
      barTicks,
      (note) => `${note.id}-bar-${sourceBar + 2}-${crypto.randomUUID()}`
    ));
  }

  async function clearPattern(): Promise<void> {
    await onExecute(new ClearDrumPatternCommand(track.id, clip.id, lanes.map((lane) => lane.pitch)));
  }

  return (
    <section aria-label="Drum step sequencer" style={{ marginTop: 18, border: "1px solid #343943", borderRadius: 8, background: "#14171d" }}>
      <header style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", padding: 12, borderBottom: "1px solid #343943" }}>
        <strong>{clip.name} · Step Sequencer</strong>
        <button onClick={onClose}>Arrangement</button>
        <label>Pattern <select value={patternBars} onChange={(event) => setPatternBars(Number(event.target.value))}>
          <option value={1}>1 bar</option>
          <option value={2}>2 bars</option>
          <option value={4}>4 bars</option>
        </select></label>
        <label>New-step velocity <input type="range" min={1} max={127} value={defaultVelocity}
          onChange={(event) => setDefaultVelocity(Number(event.target.value))} /> {defaultVelocity}</label>
        <button onClick={() => { setPreviewing((value) => !value); setCurrentStep(0); }}>
          {previewing ? "Stop cursor" : "Preview cursor"}
        </button>
        <button disabled={patternBars < 2} onClick={() => void duplicateBar(patternBars - 2)}>Duplicate previous bar</button>
        <button onClick={() => void clearPattern()}>Clear pattern</button>
        <small>Click toggles · right-click cycles soft/normal/accent velocity</small>
      </header>

      <div style={{ overflow: "auto", padding: 12 }}>
        <div style={{ minWidth: Math.max(900, totalSteps * 38 + 160) }}>
          <div style={{ display: "grid", gridTemplateColumns: `150px repeat(${totalSteps}, 34px)`, gap: 4, marginBottom: 6 }}>
            <strong>Lane</strong>
            {Array.from({ length: totalSteps }, (_, step) => (
              <div key={step} style={{ textAlign: "center", fontSize: 11, opacity: step % 4 === 0 ? 1 : 0.65 }}>
                {step + 1}
              </div>
            ))}
          </div>

          {lanes.map((lane) => (
            <div key={lane.id} style={{ display: "grid", gridTemplateColumns: `150px repeat(${totalSteps}, 34px)`, gap: 4, marginBottom: 4, alignItems: "center" }}>
              <div>
                <strong>{lane.label}</strong>
                <small style={{ display: "block", opacity: 0.65 }}>MIDI {lane.pitch}</small>
              </div>
              {Array.from({ length: totalSteps }, (_, step) => {
                const note = noteAtStep(clip.notes, lane.pitch, step, stepTicks);
                const active = Boolean(note);
                const accent = (note?.velocity ?? 0) >= 115;
                const soft = active && (note?.velocity ?? 0) < 80;
                const cursor = previewing && currentStep === step;
                return <button
                  key={step}
                  aria-label={`${lane.label} step ${step + 1}${active ? " active" : ""}`}
                  title={active ? `Velocity ${note?.velocity}` : "Empty step"}
                  onClick={() => void toggleStep(lane.pitch, step)}
                  onContextMenu={(event) => { event.preventDefault(); void cycleVelocity(lane.pitch, step); }}
                  style={{
                    width: 34,
                    height: 34,
                    borderRadius: 5,
                    border: cursor ? "2px solid #fff" : step % 4 === 0 ? "1px solid #6d7cff" : "1px solid #343943",
                    background: accent ? "#ff9f43" : active ? (soft ? "#40506b" : "#6877ff") : "#1c2028",
                    color: accent ? "#111" : "#fff",
                    fontWeight: 700
                  }}
                >{accent ? "A" : active ? "●" : ""}</button>;
              })}
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}

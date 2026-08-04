"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ProjectRevision } from "@synaptix/command-system";
import {
  EditorCommandHistory,
  SetLoopEnabledEditorCommand,
  SetTempoEditorCommand,
  SetTrackMutedEditorCommand,
  SetTrackPanEditorCommand,
  SetTrackSoloEditorCommand,
  SetTrackVolumeEditorCommand,
  type EditorCommand
} from "@synaptix/command-system/editor";
import { BrowserAudioEngine } from "@synaptix/daw-engine";
import { createEmptyProject, type Clip, type MusicProject, type Track } from "@synaptix/project-model";
import { IndexedDbProjectStorage, LocalProjectRepository } from "@synaptix/project-storage";
import {
  HybridProjectRepository,
  IndexedDbProjectSyncQueue,
  type PlatformRevisionEnvelope,
  type RevisionUploadResult
} from "@synaptix/project-storage/platform-sync";

import { HttpPlatformProjectRepository } from "../../../lib/platform/platform-project-repository";
import { ProjectSyncCoordinator, type ProjectSyncSnapshot } from "../../../lib/platform/project-sync-coordinator";

const TRACK_NAMES = ["Drums", "Bass", "Harmony", "Lead Melody"] as const;
const TOTAL_BARS = 16;
const PPQ = 960;
const TICKS_PER_BAR = PPQ * 4;

function midiClip(id: string, name: string, pitches: readonly number[]): Clip {
  return {
    id,
    kind: "midi",
    name,
    range: { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: TOTAL_BARS * TICKS_PER_BAR },
    loop: true,
    notes: Array.from({ length: TOTAL_BARS }, (_, bar) =>
      pitches.map((pitch, step) => ({
        id: `${id}-note-${bar}-${step}`,
        pitch,
        velocity: step === 0 ? 108 : 88,
        startTick: bar * TICKS_PER_BAR + step * PPQ,
        durationTicks: Math.max(PPQ / 2, PPQ - 80)
      }))
    ).flat()
  };
}

function createStarterProject(projectId: string): MusicProject {
  const project = createEmptyProject(projectId, { name: "Synaptix Generated Arrangement" });
  const patterns = [[36, 42, 38, 42], [38, 38, 41, 43], [50, 53, 57, 53], [62, 65, 69, 67]] as const;
  project.transport.loopRange = { start: { bar: 0, beat: 0, tick: 0 }, durationTicks: TOTAL_BARS * TICKS_PER_BAR };
  project.tracks = TRACK_NAMES.map<Track>((name, index) => ({
    id: `track-${index + 1}`,
    name,
    kind: "instrument",
    muted: false,
    solo: false,
    volumeDb: index === 0 ? -5 : -8,
    pan: index === 1 ? -0.15 : index === 3 ? 0.15 : 0,
    devices: [{
      id: `device-${index + 1}`,
      deviceType: index === 0 ? "synaptix-drum-synth" : "synaptix-poly-synth",
      deviceVersion: "1.0.0",
      enabled: true,
      parameters: []
    }],
    clips: [midiClip(`clip-${index + 1}`, `${name} Generated Loop`, patterns[index])]
  }));
  return project;
}

function clipStyle(clip: Clip, project: MusicProject): React.CSSProperties {
  const beatsPerBar = project.timeSignatureMap[0]?.numerator ?? 4;
  const ticksPerBar = project.transport.ticksPerQuarterNote * beatsPerBar;
  const startBar = clip.range.start.bar + clip.range.start.beat / beatsPerBar;
  const bars = clip.range.durationTicks / ticksPerBar;
  return {
    position: "absolute",
    left: `${(startBar / TOTAL_BARS) * 100}%`,
    width: `${Math.min(100, (bars / TOTAL_BARS) * 100)}%`,
    top: 10,
    bottom: 10,
    border: "1px solid #6d7cff",
    borderRadius: 6,
    background: "linear-gradient(135deg, #303a78, #242b55)",
    padding: "8px 10px",
    overflow: "hidden"
  };
}

const INITIAL_SYNC: ProjectSyncSnapshot = { state: "idle", lastSyncedAt: null, conflicts: [], error: null };

type Gesture = { trackId: string; field: "volume" | "pan"; initial: number };

export default function StudioClient({ projectId }: { projectId: string }) {
  const [project, setProject] = useState(() => createStarterProject(projectId));
  const [playing, setPlaying] = useState(false);
  const [storageStatus, setStorageStatus] = useState("Loading project…");
  const [hydrated, setHydrated] = useState(false);
  const [sync, setSync] = useState(INITIAL_SYNC);
  const [historyVersion, setHistoryVersion] = useState(0);
  const engine = useMemo(() => new BrowserAudioEngine(), []);
  const localRef = useRef<LocalProjectRepository | null>(null);
  const hybridRef = useRef<HybridProjectRepository | null>(null);
  const coordinatorRef = useRef<ProjectSyncCoordinator | null>(null);
  const latestEnvelopeRef = useRef<PlatformRevisionEnvelope | null>(null);
  const historyRef = useRef(new EditorCommandHistory());
  const gestureRef = useRef<Gesture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const local = new LocalProjectRepository(new IndexedDbProjectStorage());
    const hybrid = new HybridProjectRepository(local, new HttpPlatformProjectRepository(), new IndexedDbProjectSyncQueue());
    const coordinator = new ProjectSyncCoordinator(hybrid, setSync);
    localRef.current = local;
    hybridRef.current = hybrid;
    coordinatorRef.current = coordinator;

    void hybrid.load(projectId).then((stored) => {
      if (cancelled) return;
      if (stored) {
        setProject(stored);
        setStorageStatus("Loaded local/cloud project");
      } else {
        setStorageStatus("New local project");
      }
      historyRef.current.clear();
      setHistoryVersion((value) => value + 1);
      setHydrated(true);
    }).catch((error: unknown) => {
      if (!cancelled) {
        setStorageStatus(error instanceof Error ? error.message : "Project storage unavailable");
        setHydrated(true);
      }
    });

    const stopCoordinator = coordinator.start();
    return () => { cancelled = true; stopCoordinator(); };
  }, [projectId]);

  useEffect(() => engine.loadProject(project), [engine, project]);
  useEffect(() => () => engine.dispose(), [engine]);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      const modifier = event.ctrlKey || event.metaKey;
      if (!modifier) return;
      if (event.key.toLowerCase() === "z") {
        event.preventDefault();
        void (event.shiftKey ? redo() : undo());
      } else if (event.key.toLowerCase() === "y") {
        event.preventDefault();
        void redo();
      }
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  });

  async function queueRevision(nextProject: MusicProject, revision: ProjectRevision, expected: string): Promise<void> {
    const envelope: PlatformRevisionEnvelope = { projectId: nextProject.projectId, project: nextProject, revision };
    latestEnvelopeRef.current = envelope;
    await hybridRef.current?.saveAndQueue(
      envelope,
      expected,
      `project-revision:${nextProject.projectId}:${revision.revisionId}`,
      crypto.randomUUID()
    );
    setStorageStatus("Revision saved and queued");
    await coordinatorRef.current?.drain();
  }

  async function execute(command: EditorCommand): Promise<void> {
    const expected = project.revisionId;
    const result = await historyRef.current.execute(project, command);
    setProject(result.project);
    setHistoryVersion((value) => value + 1);
    await queueRevision(result.project, result.revision, expected);
  }

  async function undo(): Promise<void> {
    const expected = project.revisionId;
    const result = await historyRef.current.undo(project);
    if (!result) return;
    setProject(result.project);
    setHistoryVersion((value) => value + 1);
    await queueRevision(result.project, result.revision, expected);
  }

  async function redo(): Promise<void> {
    const expected = project.revisionId;
    const result = await historyRef.current.redo(project);
    if (!result) return;
    setProject(result.project);
    setHistoryVersion((value) => value + 1);
    await queueRevision(result.project, result.revision, expected);
  }

  async function useCloud(conflict: RevisionUploadResult): Promise<void> {
    if (conflict.outcome !== "conflict") return;
    await localRef.current?.save(conflict.remote.project, conflict.remote.revision);
    setProject(conflict.remote.project);
    historyRef.current.clear();
    setHistoryVersion((value) => value + 1);
    setSync(INITIAL_SYNC);
    setStorageStatus("Cloud revision selected");
  }

  async function keepMine(conflict: RevisionUploadResult): Promise<void> {
    if (conflict.outcome !== "conflict" || !latestEnvelopeRef.current) return;
    const envelope = latestEnvelopeRef.current;
    await hybridRef.current?.saveAndQueue(
      envelope,
      conflict.currentRevisionId,
      `conflict-retry:${envelope.projectId}:${envelope.revision.revisionId}:${conflict.currentRevisionId}`
    );
    await coordinatorRef.current?.drain();
  }

  function previewTrack(trackId: string, field: "volumeDb" | "pan", value: number): void {
    setProject((current) => ({
      ...current,
      tracks: current.tracks.map((candidate) => candidate.id === trackId ? { ...candidate, [field]: value } : candidate)
    }));
  }

  function beginGesture(trackId: string, field: "volume" | "pan", initial: number): void {
    gestureRef.current = { trackId, field, initial };
  }

  async function endGesture(trackId: string, field: "volume" | "pan", next: number): Promise<void> {
    const gesture = gestureRef.current;
    gestureRef.current = null;
    if (!gesture || gesture.trackId !== trackId || gesture.field !== field || gesture.initial === next) return;
    const command = field === "volume"
      ? new SetTrackVolumeEditorCommand(trackId, gesture.initial, next)
      : new SetTrackPanEditorCommand(trackId, gesture.initial, next);
    await execute(command);
  }

  async function play(): Promise<void> { await engine.play(); setPlaying(true); }
  function pause(): void { engine.pause(); setPlaying(false); }
  function stop(): void { engine.stop(); setPlaying(false); }

  const syncLabel = sync.state === "syncing" ? "Syncing…"
    : sync.state === "offline" ? "Offline"
      : sync.state === "conflict" ? "Conflict"
        : sync.error ?? (sync.lastSyncedAt ? `Synced ${new Date(sync.lastSyncedAt).toLocaleTimeString()}` : "Local only");
  const history = historyRef.current;
  void historyVersion;

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", background: "#111318", color: "#f4f5f7", minHeight: "100vh" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 16, marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0 }}>{project.metadata.name}</h1>
          <small>Project {project.projectId} · {project.tempoMap[0]?.bpm ?? 120} BPM · {storageStatus} · {syncLabel}</small>
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <button onClick={playing ? pause : play}>{playing ? "Pause" : "Play"}</button>
          <button onClick={stop}>Stop</button>
          <button disabled={!history.canUndo} onClick={() => void undo()}>Undo</button>
          <button disabled={!history.canRedo} onClick={() => void redo()}>Redo</button>
          <button onClick={() => void execute(new SetLoopEnabledEditorCommand(project.transport.loopEnabled, !project.transport.loopEnabled))}>
            Loop: {project.transport.loopEnabled ? "On" : "Off"}
          </button>
          <label>Tempo <input type="number" min={20} max={300} value={project.tempoMap[0]?.bpm ?? 120}
            onChange={(event) => {
              const next = Number(event.target.value);
              const current = project.tempoMap[0]?.bpm ?? 120;
              if (Number.isFinite(next) && next !== current) void execute(new SetTempoEditorCommand(current, next));
            }} style={{ width: 64 }} /></label>
          <button onClick={() => void coordinatorRef.current?.drain()}>Sync now</button>
        </div>
      </header>

      {sync.conflicts.map((conflict) => conflict.outcome === "conflict" && (
        <section key={conflict.currentRevisionId} style={{ padding: 12, marginBottom: 16, border: "1px solid #b7791f", borderRadius: 8 }}>
          <strong>Cloud revision conflict</strong>
          <p style={{ margin: "6px 0" }}>Remote head: {conflict.currentRevisionId}. Choose which version should remain active.</p>
          <button onClick={() => void useCloud(conflict)}>Use cloud</button>{" "}
          <button onClick={() => void keepMine(conflict)}>Keep mine</button>
        </section>
      ))}

      <section aria-label="Arrangement timeline" style={{ border: "1px solid #343943", borderRadius: 8, overflow: "auto" }}>
        <div style={{ minWidth: 1120 }}>
          <div style={{ display: "grid", gridTemplateColumns: "260px repeat(16, minmax(48px, 1fr))", background: "#1a1e26", borderBottom: "1px solid #343943" }}>
            <div style={{ padding: 10 }}>Tracks and mixer</div>
            {Array.from({ length: TOTAL_BARS }, (_, index) => <div key={index} style={{ padding: 10, borderLeft: "1px solid #2a2f38", textAlign: "center" }}>{index + 1}</div>)}
          </div>
          {project.tracks.map((value) => (
            <div key={value.id} style={{ display: "grid", gridTemplateColumns: "260px 1fr", minHeight: 96, borderBottom: "1px solid #2a2f38" }}>
              <div style={{ padding: 12, background: "#1a1e26", display: "grid", gap: 8 }}>
                <strong>{value.name}</strong>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => void execute(new SetTrackMutedEditorCommand(value.id, value.muted, !value.muted))}>M {value.muted ? "On" : "Off"}</button>
                  <button onClick={() => void execute(new SetTrackSoloEditorCommand(value.id, value.solo, !value.solo))}>S {value.solo ? "On" : "Off"}</button>
                </div>
                <label style={{ display: "grid", gridTemplateColumns: "54px 1fr 42px", gap: 6, fontSize: 12 }}>
                  Volume
                  <input type="range" min={-36} max={6} step={1} value={value.volumeDb}
                    onPointerDown={() => beginGesture(value.id, "volume", value.volumeDb)}
                    onChange={(event) => previewTrack(value.id, "volumeDb", Number(event.target.value))}
                    onPointerUp={(event) => void endGesture(value.id, "volume", Number(event.currentTarget.value))} />
                  <span>{value.volumeDb} dB</span>
                </label>
                <label style={{ display: "grid", gridTemplateColumns: "54px 1fr 42px", gap: 6, fontSize: 12 }}>
                  Pan
                  <input type="range" min={-1} max={1} step={0.1} value={value.pan}
                    onPointerDown={() => beginGesture(value.id, "pan", value.pan)}
                    onChange={(event) => previewTrack(value.id, "pan", Number(event.target.value))}
                    onPointerUp={(event) => void endGesture(value.id, "pan", Number(event.currentTarget.value))} />
                  <span>{value.pan.toFixed(1)}</span>
                </label>
              </div>
              <div style={{ position: "relative", minHeight: 96, backgroundImage: "repeating-linear-gradient(to right, transparent 0, transparent calc(6.25% - 1px), #252a33 calc(6.25% - 1px), #252a33 6.25%)" }}>
                {value.clips.map((clip) => <div key={clip.id} style={clipStyle(clip, project)}>
                  <strong>{clip.name}</strong>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>{clip.kind === "midi" ? `${clip.notes.length} MIDI notes` : "Audio clip"}</div>
                </div>)}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

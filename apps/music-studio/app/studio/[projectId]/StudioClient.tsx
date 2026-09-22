"use client";

import { Badge, Button, DisclosureMenu, ViewTabs } from "../../../components/ui/StudioControls";
import { ResizeHandle } from "../../../components/ui/ResizeHandle";
import { useStudioLayout } from "../../../lib/editor/use-studio-layout";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ProjectRevision } from "@synaptix/command-system";
import { SetDeviceEnabledEditorCommand, SetDeviceParameterEditorCommand } from "@synaptix/command-system/device";
import { AddTrackEditorCommand } from "@synaptix/command-system/track";
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
import {
  BrowserAudioEngine,
  createFrequencyDroneTrack,
  DEVICE_PARAMETER_DEFINITIONS,
  FREQUENCY_DRONE_DEVICE_TYPE,
  resolveFrequencyDroneDevice,
  ENVELOPE_ATTACK_PARAMETER,
  ENVELOPE_DECAY_PARAMETER,
  ENVELOPE_RELEASE_PARAMETER,
  ENVELOPE_SUSTAIN_PARAMETER,
  FILTER_FREQUENCY_PARAMETER,
  primaryDevice,
  resolveEffectiveInstrumentSettings,
  REVERB_SEND_PARAMETER
} from "@synaptix/daw-engine";
import type { GenerationProposal } from "@synaptix/generator-contracts";
import {
  createEmptyProject,
  type Clip,
  type CreateEmptyProjectOptions,
  type MusicProject,
  type Track
} from "@synaptix/project-model";
import { IndexedDbProjectStorage, LocalProjectRepository } from "@synaptix/project-storage";
import {
  HybridProjectRepository,
  IndexedDbProjectSyncQueue,
  type PlatformRevisionEnvelope,
  type RevisionUploadResult
} from "@synaptix/project-storage/platform-sync";

import { ApplyGeneratedArrangementEditorCommand } from "../../../lib/editor/apply-generated-arrangement-command";
import { HttpPlatformProjectRepository } from "../../../lib/platform/platform-project-repository";
import { ProjectSyncCoordinator, type ProjectSyncSnapshot } from "../../../lib/platform/project-sync-coordinator";
import { GenerationWorkspace } from "./GenerationWorkspace";
import { AdaptiveStatesWorkspace } from "./AdaptiveStatesWorkspace";
import { MasterMeter } from "./MasterMeter";
import { MixerDrawer } from "./MixerDrawer";
import { PianoRoll } from "./PianoRoll";

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

// The starter project renders during SSR, so the first one has to be byte-identical on the
// server and the client; the mount effect replaces it with a freshly stamped project when
// storage has nothing for this id.
const SEED_TIMESTAMP = "2026-01-01T00:00:00.000Z";

function seedOptions(projectId: string): CreateEmptyProjectOptions {
  return { revisionId: `${projectId}-seed-revision`, now: SEED_TIMESTAMP };
}

function createStarterProject(projectId: string, options: CreateEmptyProjectOptions = {}): MusicProject {
  const project = createEmptyProject(projectId, { name: "Synaptix Generated Arrangement", ...options });
  const patterns = [[36, 46, 38, 42], [45, 45, 48, 50], [57, 60, 64, 67], [72, 76, 79, 77]] as const;
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
    border: "1px solid var(--sx-primary)",
    borderRadius: 6,
    background: "linear-gradient(135deg, rgb(109 124 255 / 48%), rgb(155 92 255 / 30%))",
    padding: "8px 10px",
    overflow: "hidden"
  };
}

type NumericSettingsKey = "filterFrequency" | "attack" | "decay" | "sustain" | "release" | "reverbSend";

const PARAMETER_SETTINGS_KEY: Record<string, NumericSettingsKey> = {
  [FILTER_FREQUENCY_PARAMETER]: "filterFrequency",
  [ENVELOPE_ATTACK_PARAMETER]: "attack",
  [ENVELOPE_DECAY_PARAMETER]: "decay",
  [ENVELOPE_SUSTAIN_PARAMETER]: "sustain",
  [ENVELOPE_RELEASE_PARAMETER]: "release",
  [REVERB_SEND_PARAMETER]: "reverbSend"
};

const INITIAL_SYNC: ProjectSyncSnapshot = { state: "idle", lastSyncedAt: null, conflicts: [], error: null };
type Gesture = { trackId: string; field: "volume" | "pan"; initial: number };
type DeviceGesture = { trackId: string; deviceId: string; parameterId: string; initial: number };
type ActiveClip = { trackId: string; clipId: string };
type Workspace = "arrangement" | "generation" | "adaptive";

export default function StudioClient({ projectId }: { projectId: string }) {
  const [project, setProject] = useState(() => createStarterProject(projectId, seedOptions(projectId)));
  const [playing, setPlaying] = useState(false);
  const [storageStatus, setStorageStatus] = useState("Loading project…");
  const [hydrated, setHydrated] = useState(false);
  const [sync, setSync] = useState(INITIAL_SYNC);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [activeClip, setActiveClip] = useState<ActiveClip | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>("arrangement");
  const [mixerOpen, setMixerOpen] = useState(false);
  const mixerToggleRef = useRef<HTMLButtonElement>(null);
  const panelLayout = useStudioLayout();

  useEffect(() => {
    try { setMixerOpen(localStorage.getItem("synaptix-music:mixer-open:v1") === "true"); }
    catch { /* Layout preferences are optional when browser storage is unavailable. */ }
  }, []);

  function changeMixerOpen(open: boolean) {
    setMixerOpen(open);
    try { localStorage.setItem("synaptix-music:mixer-open:v1", String(open)); }
    catch { /* The mixer remains usable without persisted preferences. */ }
    if (!open) mixerToggleRef.current?.focus();
  }
  const engine = useMemo(() => new BrowserAudioEngine(), []);
  const localRef = useRef<LocalProjectRepository | null>(null);
  const hybridRef = useRef<HybridProjectRepository | null>(null);
  const coordinatorRef = useRef<ProjectSyncCoordinator | null>(null);
  const latestEnvelopeRef = useRef<PlatformRevisionEnvelope | null>(null);
  const historyRef = useRef(new EditorCommandHistory());
  const gestureRef = useRef<Gesture | null>(null);
  const deviceGestureRef = useRef<DeviceGesture | null>(null);

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
        setProject(createStarterProject(projectId));
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
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']")) return;
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

  async function addFrequencyDrone(frequencyHz: number): Promise<void> {
    await execute(new AddTrackEditorCommand(createFrequencyDroneTrack({ frequencyHz })));
    setWorkspace("arrangement");
  }

  async function applyGeneratedVariation(proposal: GenerationProposal, jobId: string): Promise<void> {
    await execute(new ApplyGeneratedArrangementEditorCommand(proposal, jobId));
    setActiveClip(null);
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

  function previewDeviceParameter(trackId: string, deviceId: string, parameterId: string, value: number): void {
    setProject((current) => ({
      ...current,
      tracks: current.tracks.map((candidate) => candidate.id !== trackId ? candidate : {
        ...candidate,
        devices: candidate.devices.map((candidateDevice) => candidateDevice.id !== deviceId ? candidateDevice : {
          ...candidateDevice,
          parameters: candidateDevice.parameters.some((parameter) => parameter.id === parameterId)
            ? candidateDevice.parameters.map((parameter) => parameter.id === parameterId ? { ...parameter, value } : parameter)
            : [...candidateDevice.parameters, { id: parameterId, value }]
        })
      })
    }));
  }

  function beginDeviceGesture(trackId: string, deviceId: string, parameterId: string, initial: number): void {
    deviceGestureRef.current = { trackId, deviceId, parameterId, initial };
  }

  async function endDeviceGesture(trackId: string, deviceId: string, parameterId: string, next: number): Promise<void> {
    const gesture = deviceGestureRef.current;
    deviceGestureRef.current = null;
    if (!gesture || gesture.trackId !== trackId || gesture.deviceId !== deviceId
      || gesture.parameterId !== parameterId || gesture.initial === next) return;
    await execute(new SetDeviceParameterEditorCommand(trackId, deviceId, parameterId, gesture.initial, next));
  }

  function formatParameterValue(unit: "hz" | "seconds" | "ratio" | "count", value: number): string {
    if (unit === "count") return String(Math.round(value));
    if (unit === "hz") return `${Math.round(value)} Hz`;
    if (unit === "seconds") return `${value.toFixed(3)} s`;
    return value.toFixed(2);
  }

  function renderDeviceControls(track: Track): React.ReactNode {
    const device = primaryDevice(track);
    if (!device) return null;
    const isDrone = device.deviceType === FREQUENCY_DRONE_DEVICE_TYPE;
    const settings = isDrone ? resolveFrequencyDroneDevice(device) : resolveEffectiveInstrumentSettings(track);

    return (
      <div style={{ display: "grid", gap: 6, borderTop: "1px solid #2a2f38", paddingTop: 8, marginTop: 4 }}>
        <Button onClick={() => void execute(new SetDeviceEnabledEditorCommand(track.id, device.id, device.enabled, !device.enabled))}>
          Device {device.enabled ? "On" : "Off"}
        </Button>
        {DEVICE_PARAMETER_DEFINITIONS.filter((definition) => isDrone ? definition.id.startsWith("drone") : !definition.id.startsWith("drone")).map((definition) => {
          const droneKeys: Record<string, keyof ReturnType<typeof resolveFrequencyDroneDevice>> = { droneFrequencyHz:"frequencyHz", droneGain:"gain", droneHarmonics:"harmonics", droneModulationRateHz:"modulationRateHz", droneModulationDepth:"modulationDepth", droneFilterHz:"filterHz", droneStereoOffsetHz:"stereoOffsetHz" };
          const value = isDrone ? settings[droneKeys[definition.id] as keyof typeof settings] as number : settings[PARAMETER_SETTINGS_KEY[definition.id] as keyof typeof settings] as number;
          const step = definition.unit === "count" ? 1 : definition.unit === "hz" ? (definition.id === "droneFrequencyHz" ? 0.1 : 10) : definition.unit === "ratio" ? 0.01 : 0.001;
          return (
            <label key={definition.id} style={{ display: "grid", gridTemplateColumns: "80px 1fr 60px", gap: 6, fontSize: 12 }}>
              {definition.label}
              <input type="range" min={definition.minimum} max={definition.maximum} step={step} value={value}
                onPointerDown={() => beginDeviceGesture(track.id, device.id, definition.id, value)}
                onChange={(event) => previewDeviceParameter(track.id, device.id, definition.id, Number(event.target.value))}
                onPointerUp={(event) => void endDeviceGesture(track.id, device.id, definition.id, Number(event.currentTarget.value))} />
              <span>{formatParameterValue(definition.unit, value)}</span>
            </label>
          );
        })}
      </div>
    );
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
  void hydrated;

  const syncTone = sync.state === "conflict" || sync.error ? "danger" : sync.state === "offline" ? "warning" : "";

  return (
    <main className={`studio-shell${mixerOpen ? " studio-shell-mixer-open" : ""}`}
      style={{ "--studio-mixer-height": `${panelLayout.mixerHeight}px` } as React.CSSProperties}>
      <header className="studio-topbar">
        <div className="studio-brand">
          <a className="studio-home" href="/" aria-label="Back to projects"><span className="studio-mark" aria-hidden="true">S</span><span>Projects</span></a>
          <div className="studio-title">
            <h1>{project.metadata.name}</h1>
            <small>{project.tempoMap[0]?.bpm ?? 120} BPM · {storageStatus}</small>
          </div>
        </div>
        <div className="transport" aria-label="Transport controls">
          <Button className="transport-primary" onClick={playing ? pause : play}>{playing ? "Pause" : "Play"}</Button>
          <Button onClick={stop}>Stop</Button>
          <Button disabled={!history.canUndo} onClick={() => void undo()}>Undo</Button>
          <Button disabled={!history.canRedo} onClick={() => void redo()}>Redo</Button>
          <Button onClick={() => void execute(new SetLoopEnabledEditorCommand(project.transport.loopEnabled, !project.transport.loopEnabled))}>
            Loop: {project.transport.loopEnabled ? "On" : "Off"}
          </Button>
          <label>Tempo <input type="number" min={20} max={300} value={project.tempoMap[0]?.bpm ?? 120}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              const next = event.currentTarget.valueAsNumber;
              const current = project.tempoMap[0]?.bpm ?? 120;
              if (raw === "" || !Number.isFinite(next) || next < 20 || next > 300 || next === current) return;
              void execute(new SetTempoEditorCommand(current, next));
            }} style={{ width: 64 }} /></label>
          <Button onClick={() => void coordinatorRef.current?.drain()}>Sync now</Button>
        </div>
        <div className="studio-status">
          <span className="status-pill"><span className={`status-dot ${syncTone}`} />{syncLabel}</span>
          <MasterMeter engine={engine} />
        </div>
      </header>

      <div className="studio-viewbar" aria-label="Workspace and panels">
        <label>Workspace <select value={workspace} onChange={(event) => setWorkspace(event.target.value as Workspace)}>
          <option value="arrangement">Arrangement</option>
          <option value="generation">Generate</option>
          <option value="adaptive">Adaptive states</option>
        </select></label>
        <div className="studio-view-actions">
        <DisclosureMenu label="Layout">
          <Button aria-pressed={panelLayout.navigationVisible} disabled={panelLayout.mobile}
            onClick={() => panelLayout.update({ navigationOpen: !panelLayout.layout.navigationOpen })}>Navigation panel</Button>
          <Button aria-pressed={panelLayout.inspectorVisible} disabled={panelLayout.narrow}
            onClick={() => panelLayout.update({ inspectorOpen: !panelLayout.layout.inspectorOpen })}>Inspector panel</Button>
          {panelLayout.narrow && <p>Side panels hide on smaller screens to keep the editor usable. Your desktop layout is remembered.</p>}
          <Button onClick={() => { panelLayout.reset(); changeMixerOpen(false); }}>Reset layout</Button>
          <p>Drag a panel edge to resize, or focus it and use the arrow keys.</p>
        </DisclosureMenu>
        <Button ref={mixerToggleRef} aria-expanded={mixerOpen} aria-controls="studio-mixer"
          onClick={() => changeMixerOpen(!mixerOpen)}>Mixer</Button>
        </div>
      </div>

      <div className="studio-grid" style={{
        "--studio-nav-width": panelLayout.navigationVisible ? `${panelLayout.navigationWidth}px` : "0px",
        "--studio-inspector-width": panelLayout.inspectorVisible ? `${panelLayout.layout.inspectorWidth}px` : "0px"
      } as React.CSSProperties}>
        <aside id="studio-navigation" className="studio-sidebar" aria-label="Studio navigation" hidden={!panelLayout.navigationVisible}>
          <ResizeHandle label="Navigation panel size" controls="studio-navigation" orientation="vertical"
            value={panelLayout.navigationWidth} min={160} max={320} onChange={(navigationWidth) => panelLayout.update({ navigationWidth })} />
          <p className="panel-label">Workspace</p>
          <nav className="studio-nav">
            <Button aria-current={workspace === "arrangement" ? "page" : undefined} onClick={() => setWorkspace("arrangement")}><span><span className="nav-glyph">A</span>Arrangement</span></Button>
            <Button disabled title="Open a MIDI clip from the arrangement"><span><span className="nav-glyph">P</span>Piano roll</span></Button>
            <Button disabled title="Open a drum clip from the arrangement"><span><span className="nav-glyph">D</span>Drum sequencer</span></Button>
            <Button aria-expanded={mixerOpen} aria-controls="studio-mixer" onClick={() => changeMixerOpen(!mixerOpen)}><span><span className="nav-glyph">M</span>Mixer</span></Button>
          </nav>
          <p className="panel-label" style={{ marginTop: 22 }}>SynaptixPlay</p>
          <nav className="studio-nav">
            <Button aria-current={workspace === "generation" ? "page" : undefined} onClick={() => setWorkspace("generation")}><span><span className="nav-glyph">G</span>Generate</span><span className="nav-badge">AI</span></Button>
            <Button aria-current={workspace === "adaptive" ? "page" : undefined} onClick={() => setWorkspace("adaptive")}><span><span className="nav-glyph">S</span>Adaptive states</span><span className="nav-badge">13</span></Button>
            <Button disabled title="Publication remains gated by certification"><span><span className="nav-glyph">R</span>Render & publish</span></Button>
          </nav>
          <section className="sidebar-card" aria-label="Adaptive audio preview">
            <strong>Runtime preview</strong>
            <div className="adaptive-row"><span className="adaptive-orb" />Exploration · active</div>
            <div className="intensity-track" role="progressbar" aria-label="Adaptive intensity" aria-valuemin={0} aria-valuemax={100} aria-valuenow={64}><span /></div>
            <p>Adaptive authoring becomes interactive in the Stage 13 workspace slice.</p>
          </section>
        </aside>

        <section className="studio-workspace" aria-label="Project workspace">
          {workspace === "arrangement" && <div className="workspace-tabs">
            <ViewTabs label="Editor views" value={activeClip ? "midi" : "arrangement"}
              onChange={(view) => { if (view === "arrangement") setActiveClip(null); }}
              tabs={[{ value: "arrangement", label: "Arrangement", panelId: "arrangement-view" },
                { value: "midi", label: "MIDI editor", panelId: "midi-view", disabled: !activeClip }]} />
            <span className="workspace-spacer" />
            <Badge>Revision {project.revisionId.slice(0, 8)}</Badge>
          </div>}

      {workspace === "arrangement" && <>
      {sync.conflicts.map((conflict) => conflict.outcome === "conflict" && (
        <section key={conflict.currentRevisionId} className="conflict-banner">
          <strong>Cloud revision conflict</strong>
          <p style={{ margin: "6px 0" }}>Remote head: {conflict.currentRevisionId}. Choose which version should remain active.</p>
          <Button onClick={() => void useCloud(conflict)}>Use cloud</Button>{" "}
          <Button onClick={() => void keepMine(conflict)}>Keep mine</Button>
        </section>
      ))}

      <div id="arrangement-view" role="tabpanel" aria-labelledby="arrangement-view-tab" hidden={Boolean(activeClip)}>
      <section aria-label="Arrangement timeline" className="canvas-panel">
        <div style={{ minWidth: 1120 }}>
          <div className="timeline-ruler" style={{ display: "grid", gridTemplateColumns: "260px repeat(16, minmax(48px, 1fr))", borderBottom: "1px solid #343943" }}>
            <div style={{ padding: 10 }}>Tracks and mixer</div>
            {Array.from({ length: TOTAL_BARS }, (_, index) => <div key={index} style={{ padding: 10, borderLeft: "1px solid #2a2f38", textAlign: "center" }}>{index + 1}</div>)}
          </div>
          {project.tracks.map((value) => (
            <div key={value.id} style={{ display: "grid", gridTemplateColumns: "260px 1fr", minHeight: 96, borderBottom: "1px solid #2a2f38" }}>
              <div className="track-header" style={{ padding: 12, display: "grid", gap: 8 }}>
                <strong><span className="track-index">{project.tracks.indexOf(value) + 1}</span>{value.name}</strong>
                <div style={{ display: "flex", gap: 6 }}>
                  <Button onClick={() => void execute(new SetTrackMutedEditorCommand(value.id, value.muted, !value.muted))}>M {value.muted ? "On" : "Off"}</Button>
                  <Button onClick={() => void execute(new SetTrackSoloEditorCommand(value.id, value.solo, !value.solo))}>S {value.solo ? "On" : "Off"}</Button>
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
                {renderDeviceControls(value)}
              </div>
              <div className="track-lane" style={{ position: "relative", minHeight: 96, backgroundImage: "repeating-linear-gradient(to right, transparent 0, transparent calc(6.25% - 1px), #252a33 calc(6.25% - 1px), #252a33 6.25%)" }}>
                {value.clips.map((clip) => <div key={clip.id} style={clipStyle(clip, project)} onDoubleClick={() => clip.kind === "midi" && setActiveClip({ trackId: value.id, clipId: clip.id })}>
                  <strong>{clip.name}</strong>
                  <div style={{ fontSize: 12, opacity: 0.8 }}>{clip.kind === "midi" ? `${clip.notes.length} MIDI notes` : "Audio clip"}</div>
                  {clip.kind === "midi" && <Button style={{ marginTop: 6 }} onClick={(event) => { event.stopPropagation(); setActiveClip({ trackId: value.id, clipId: clip.id }); }}>Edit</Button>}
                </div>)}
              </div>
            </div>
          ))}
        </div>
      </section>
      </div>

      <div id="midi-view" role="tabpanel" aria-labelledby="midi-view-tab" hidden={!activeClip}>
      {activeClip && <PianoRoll
        project={project}
        trackId={activeClip.trackId}
        clipId={activeClip.clipId}
        onExecute={execute}
        onClose={() => setActiveClip(null)}
      />}
      </div>
      </>}

      {workspace === "generation" && <GenerationWorkspace
        project={project}
        onAddDrone={addFrequencyDrone}
        onApply={applyGeneratedVariation}
        onClose={() => setWorkspace("arrangement")}
      />}
      {workspace === "adaptive" && <AdaptiveStatesWorkspace project={project} onClose={() => setWorkspace("arrangement")} />}
        </section>

        <aside id="studio-inspector" className="studio-inspector" aria-label="Project inspector" hidden={!panelLayout.inspectorVisible}>
          <div className="inspector-resize-edge"><ResizeHandle label="Inspector panel size" controls="studio-inspector" orientation="vertical"
            value={panelLayout.layout.inspectorWidth} min={220} max={400} direction={-1}
            onChange={(inspectorWidth) => panelLayout.update({ inspectorWidth })} /></div>
          <div className="inspector-heading"><h2>Project inspector</h2><span className="inspector-chip">Live</span></div>
          <dl className="property-list">
            <div className="property-row"><dt>Project</dt><dd>{project.projectId}</dd></div>
            <div className="property-row"><dt>Tracks</dt><dd>{project.tracks.length}</dd></div>
            <div className="property-row"><dt>Length</dt><dd>{TOTAL_BARS} bars</dd></div>
            <div className="property-row"><dt>Tempo</dt><dd>{project.tempoMap[0]?.bpm ?? 120} BPM</dd></div>
            <div className="property-row"><dt>Sync</dt><dd>{syncLabel}</dd></div>
          </dl>
          <section className="inspector-card">
            <strong>AI generation</strong>
            <p>Create a variation from the active project while preserving its canonical revision history.</p>
            <Button className="generation-cta" onClick={() => setWorkspace("generation")}>Open generator</Button>
          </section>
          <section className="inspector-card">
            <strong>Publication readiness</strong>
            <div className="adaptive-row"><span className="adaptive-orb" />Stage 12 artifacts supported</div>
            <p>Certification evidence and immutable adaptive-package publication remain visible gates.</p>
          </section>
        </aside>
      </div>
      {mixerOpen && <MixerDrawer project={project} engine={engine} storageStatus={storageStatus}
        height={panelLayout.mixerHeight} maxHeight={panelLayout.mixerMax} onResize={(mixerHeight) => panelLayout.update({ mixerHeight })}
        syncLabel={syncLabel} onExecute={execute} onClose={() => changeMixerOpen(false)} />}
    </main>
  );
}

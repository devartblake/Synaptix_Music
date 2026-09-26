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
  SetTrackPanEditorCommand,
  SetTrackSendEditorCommand,
  SetTrackVolumeEditorCommand,
  type EditorCommand
} from "@synaptix/command-system/editor";
import { liftEditorCommandToV2, type PluginEditorCommand } from "@synaptix/command-system/plugin";
import {
  BrowserAudioEngine,
  builtinProjectView,
  createFrequencyDroneTrack,
  createInstrumentTrack,
  INSTRUMENT_CATALOG,
  instrumentDefinition,
  resolveInstrumentDefinition,
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
  REVERB_SEND_PARAMETER,
  type PluginRuntimeStatus
} from "@synaptix/daw-engine";
import type { GenerationProposal } from "@synaptix/generator-contracts";
import {
  createEmptyProject,
  type Clip,
  type CreateEmptyProjectOptions,
  type MusicProject,
  type Track
} from "@synaptix/project-model";
import { toProjectV2, type MusicProjectV2 } from "@synaptix/project-model/v2";
import {
  IndexedDbProjectStorage,
  LocalProjectRepository,
  parseVersionedMusicProject,
  type StoredMusicProject
} from "@synaptix/project-storage";
import {
  HybridProjectRepository,
  IndexedDbProjectSyncQueue,
  platformEnvelopeConverter,
  type PlatformRevisionEnvelope,
  type RevisionUploadResult
} from "@synaptix/project-storage/platform-sync";

import { ApplyGeneratedArrangementEditorCommand } from "../../../lib/editor/apply-generated-arrangement-command";
import { HttpPlatformProjectRepository } from "../../../lib/platform/platform-project-repository";
import { ProjectSyncCoordinator, type ProjectSyncSnapshot } from "../../../lib/platform/project-sync-coordinator";
import { GenerationWorkspace } from "./GenerationWorkspace";
import { AdaptiveStatesWorkspace } from "./AdaptiveStatesWorkspace";
import { InstrumentIcon, INSTRUMENT_ACCENTS } from "./InstrumentIcon";
import { MasterMeter } from "./MasterMeter";
import { MixerDrawer } from "./MixerDrawer";
import { RenderWorkspace } from "./RenderWorkspace";
import { PianoRoll } from "./PianoRoll";
import { PluginRack } from "./PluginRack";
import { ArrangementTimeline } from "./ArrangementTimeline";
import { TransportPosition } from "./TransportPosition";
import { CommitSlider } from "../../../components/ui/CommitSlider";
import { arrangementBars } from "../../../lib/editor/timeline-model";
import { describeSaveError } from "../../../lib/editor/storage-health";
import { useStorageHealth } from "../../../lib/editor/use-storage-health";
import {
  clearRecovery,
  journalRevision,
  readRecovery,
  type RecoveryEntry
} from "../../../lib/editor/recovery-journal";
import { editorKindForTrack, findEditorClip, type EditorKind } from "../../../lib/editor/editor-clip-target";
import {
  bindBeforeUnload,
  EditorSessionCoordinator,
  ProjectTabLease,
  type BroadcastChannelLike
} from "../../../lib/editor/editor-session-coordinator";

/**
 * The project schema version the platform API accepts for revision uploads. Until the platform
 * accepts v2, plug-in projects are saved locally only; plain projects are uploaded as v1.
 */
const PLATFORM_PROJECT_SCHEMA_VERSION = process.env.NEXT_PUBLIC_SYNAPTIX_PLATFORM_PROJECT_SCHEMA_VERSION === "2" ? 2 : 1;

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

function createStarterProject(projectId: string, options: CreateEmptyProjectOptions = {}): MusicProjectV2 {
  return toProjectV2(createStarterProjectV1(projectId, options));
}

function createStarterProjectV1(projectId: string, options: CreateEmptyProjectOptions = {}): MusicProject {
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
type DeviceGesture = { trackId: string; deviceId: string; parameterId: string; initial: number };
type ActiveClip = { trackId: string; clipId: string };
type Workspace = "arrangement" | "generation" | "adaptive" | "render" | "devices";

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
  const [newInstrument, setNewInstrument] = useState("synaptix-pad");
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
  const localRef = useRef<LocalProjectRepository<StoredMusicProject> | null>(null);
  const hybridRef = useRef<HybridProjectRepository | null>(null);
  const coordinatorRef = useRef<ProjectSyncCoordinator | null>(null);
  const latestEnvelopeRef = useRef<PlatformRevisionEnvelope | null>(null);
  // Save state, unload protection, and single-writer tabs for this project.
  const sessionRef = useRef(new EditorSessionCoordinator());
  const [session, setSession] = useState(() => sessionRef.current.snapshot);
  // Parent for the next queued upload: the last revision that actually saved,
  // so a failed save never leaves the cloud queue pointing at a missing parent.
  const persistedRevisionRef = useRef<string | null>(null);
  const { health: storageHealth, refresh: refreshStorage } = useStorageHealth();
  // An unsaved edit left behind by a crash or a closed tab, offered back on load.
  const [recovery, setRecovery] = useState<RecoveryEntry | null>(null);
  const historyRef = useRef(new EditorCommandHistory<MusicProjectV2>());
  const [pluginStatuses, setPluginStatuses] = useState<PluginRuntimeStatus[]>([]);
  // Built-in controls and the v1-typed workspaces read a view without plug-in devices.
  const builtinView = useMemo(() => builtinProjectView(project), [project]);
  const deviceGestureRef = useRef<DeviceGesture | null>(null);

  useEffect(() => {
    let cancelled = false;
    const local = new LocalProjectRepository<StoredMusicProject>(new IndexedDbProjectStorage(), { parse: parseVersionedMusicProject });
    const hybrid = new HybridProjectRepository(local, new HttpPlatformProjectRepository(), new IndexedDbProjectSyncQueue(), {
      toPlatformEnvelope: platformEnvelopeConverter(PLATFORM_PROJECT_SCHEMA_VERSION)
    });
    const coordinator = new ProjectSyncCoordinator(hybrid, setSync);
    localRef.current = local;
    hybridRef.current = hybrid;
    coordinatorRef.current = coordinator;

    void hybrid.load(projectId).then((stored) => {
      if (cancelled) return;
      if (stored) {
        setProject(toProjectV2(stored));
        persistedRevisionRef.current = stored.revisionId;
        setStorageStatus("Loaded local/cloud project");
      } else {
        setProject(createStarterProject(projectId));
        persistedRevisionRef.current = null;
        setStorageStatus("New local project");
      }
      setRecovery(readRecovery(projectId, stored?.revisionId ?? null));
      historyRef.current.clear();
      setHistoryVersion((value) => value + 1);
      setHydrated(true);
    }).catch((error: unknown) => {
      if (!cancelled) {
        setStorageStatus(error instanceof Error ? error.message : "Project storage unavailable");
        // Nothing loaded (e.g. offline with no saved copy): an unsaved edit may still be recoverable.
        setRecovery(readRecovery(projectId, null));
        setHydrated(true);
      }
    });

    const stopCoordinator = coordinator.start();
    return () => { cancelled = true; stopCoordinator(); };
  }, [projectId]);

  useEffect(() => {
    const unsubscribe = sessionRef.current.subscribe(setSession);
    const unbind = bindBeforeUnload(sessionRef.current, window);
    return () => { unsubscribe(); unbind(); };
  }, []);

  useEffect(() => {
    if (typeof BroadcastChannel === "undefined") return;
    const lease = new ProjectTabLease(
      projectId,
      new BroadcastChannel("synaptix-music:project-tabs") as unknown as BroadcastChannelLike,
      (tabId) => sessionRef.current.setCompetingTab(tabId)
    );
    return lease.start();
  }, [projectId]);

  useEffect(() => engine.loadProject(project), [engine, project]);
  useEffect(() => engine.subscribePluginStatus(setPluginStatuses), [engine]);

  useEffect(() => {
    // Close the piano roll if its track was deleted (or undone/redone away).
    if (activeClip && !project.tracks.some((track) => track.id === activeClip.trackId)) setActiveClip(null);
  }, [project, activeClip]);
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

  async function persistRevision(envelope: PlatformRevisionEnvelope, expected: string) {
    const hybrid = hybridRef.current;
    if (!hybrid) throw new Error("Project storage is not ready.");
    try {
      const outcome = await hybrid.saveAndQueue(
        envelope,
        persistedRevisionRef.current || expected,
        `project-revision:${envelope.projectId}:${envelope.revision.revisionId}`,
        crypto.randomUUID()
      );
      persistedRevisionRef.current = envelope.revision.revisionId;
      return outcome;
    } catch (error) {
      throw new Error(describeSaveError(error));
    } finally {
      refreshStorage();
    }
  }

  async function drainSync(): Promise<void> {
    try {
      await coordinatorRef.current?.drain();
    } catch {
      // Cloud sync reports its own state; it never marks the local save failed.
    }
  }

  async function queueRevision(nextProject: MusicProjectV2, revision: ProjectRevision, expected: string): Promise<void> {
    const envelope: PlatformRevisionEnvelope = { projectId: nextProject.projectId, project: nextProject, revision };
    latestEnvelopeRef.current = envelope;
    sessionRef.current.markSaving(envelope);
    // Write-ahead: if the tab dies before the save lands, the edit survives.
    journalRevision(envelope);
    let outcome;
    try {
      outcome = await persistRevision(envelope, expected);
    } catch (error) {
      sessionRef.current.markFailed(error);
      setStorageStatus("Changes not saved");
      return;
    }
    clearRecovery(envelope.projectId);
    sessionRef.current.markSaved(revision.revisionId);
    if (outcome && !outcome.queued) {
      setStorageStatus("Revision saved locally; cloud sync needs platform support for plug-in projects");
      return;
    }
    setStorageStatus("Revision saved and queued");
    await drainSync();
  }

  async function restoreRecovery(entry: RecoveryEntry): Promise<void> {
    setRecovery(null);
    setProject(entry.envelope.project);
    historyRef.current.clear();
    setHistoryVersion((value) => value + 1);
    latestEnvelopeRef.current = entry.envelope;
    sessionRef.current.markSaving(entry.envelope);
    try {
      await persistRevision(entry.envelope);
    } catch (error) {
      sessionRef.current.markFailed(error);
      setStorageStatus("Changes not saved");
      return;
    }
    clearRecovery(projectId);
    sessionRef.current.markSaved(entry.envelope.revision.revisionId);
    setStorageStatus("Recovered changes saved");
    await drainSync();
  }

  function discardRecovery(): void {
    clearRecovery(projectId);
    setRecovery(null);
  }

  async function retrySave(): Promise<void> {
    if (await sessionRef.current.retry(persistRevision)) {
      clearRecovery(projectId);
      setStorageStatus("Revision saved and queued");
      await drainSync();
    }
  }

  /** v1 editor commands (tracks, clips, timing) run through an adapter that keeps plug-in data. */
  function executeV1(command: EditorCommand): Promise<void> {
    return execute(liftEditorCommandToV2(command));
  }

  async function execute(command: PluginEditorCommand): Promise<void> {
    if (session.readOnly) return;
    const expected = project.revisionId;
    const result = await historyRef.current.execute(project, command);
    setProject(result.project);
    setHistoryVersion((value) => value + 1);
    await queueRevision(result.project, result.revision);
  }

  async function addFrequencyDrone(frequencyHz: number): Promise<void> {
    await executeV1(new AddTrackEditorCommand(createFrequencyDroneTrack({ frequencyHz })));
    setWorkspace("arrangement");
  }

  async function addInstrument(deviceType: string): Promise<void> {
    await execute(new AddTrackEditorCommand(createInstrumentTrack(deviceType, {
      bars: TOTAL_BARS,
      beatsPerBar: project.timeSignatureMap[0]?.numerator ?? 4,
      ticksPerQuarterNote: project.transport.ticksPerQuarterNote
    })));
    setWorkspace("arrangement");
  }

  async function applyGeneratedVariation(proposal: GenerationProposal, jobId: string): Promise<void> {
    await executeV1(new ApplyGeneratedArrangementEditorCommand(proposal, jobId));
    setActiveClip(null);
  }

  async function undo(): Promise<void> {
    if (session.readOnly) return;
    const result = await historyRef.current.undo(project);
    if (!result) return;
    setProject(result.project);
    setHistoryVersion((value) => value + 1);
    await queueRevision(result.project, result.revision);
  }

  async function redo(): Promise<void> {
    if (session.readOnly) return;
    const result = await historyRef.current.redo(project);
    if (!result) return;
    setProject(result.project);
    setHistoryVersion((value) => value + 1);
    await queueRevision(result.project, result.revision);
  }

  async function useCloud(conflict: RevisionUploadResult): Promise<void> {
    if (conflict.outcome !== "conflict") return;
    await localRef.current?.save(conflict.remote.project, conflict.remote.revision);
    persistedRevisionRef.current = conflict.remote.project.revisionId;
    setProject(toProjectV2(conflict.remote.project));
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
    const active = deviceGestureRef.current;
    // Repeated keydown events continue the same gesture so it stays one undo step.
    if (active && active.trackId === trackId && active.deviceId === deviceId && active.parameterId === parameterId) return;
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
    const device = primaryDevice(track) ?? track.devices[0];
    if (!device) return null;
    const isDrone = device.deviceType === FREQUENCY_DRONE_DEVICE_TYPE;
    const settings = isDrone ? resolveFrequencyDroneDevice(device) : resolveEffectiveInstrumentSettings({ ...track, devices: [{ ...device, enabled: true }] });

    return (
      <div style={{ display: "grid", gap: 6, borderTop: "1px solid #2a2f38", paddingTop: 8, marginTop: 4 }}>
        <Button aria-label={`${track.name} device enabled`} aria-pressed={device.enabled} onClick={() => void execute(new SetDeviceEnabledEditorCommand(track.id, device.id, device.enabled, !device.enabled))}>
          Device {device.enabled ? "On" : "Off"}
        </Button>
        {DEVICE_PARAMETER_DEFINITIONS.filter((definition) => isDrone ? definition.id.startsWith("drone") : !definition.id.startsWith("drone")).map((definition) => {
          const droneKeys: Record<string, keyof ReturnType<typeof resolveFrequencyDroneDevice>> = { droneFrequencyHz:"frequencyHz", droneGain:"gain", droneHarmonics:"harmonics", droneModulationRateHz:"modulationRateHz", droneModulationDepth:"modulationDepth", droneFilterHz:"filterHz", droneStereoOffsetHz:"stereoOffsetHz" };
          const value = isDrone ? settings[droneKeys[definition.id] as keyof typeof settings] as number : settings[PARAMETER_SETTINGS_KEY[definition.id] as keyof typeof settings] as number;
          const step = definition.unit === "count" ? 1 : definition.unit === "hz" ? (definition.id === "droneFrequencyHz" ? 0.1 : 10) : definition.unit === "ratio" ? 0.01 : 0.001;
          return (
            <CommitSlider key={definition.id} label={definition.label} value={value}
              min={definition.minimum} max={definition.maximum} step={step} disabled={!hydrated}
              format={(next) => formatParameterValue(definition.unit, next)}
              onCommit={(next) => execute(definition.id === REVERB_SEND_PARAMETER
                ? new SetTrackSendEditorCommand(track.id, track.reverbSend, next)
                : new SetDeviceParameterEditorCommand(track.id, device.id, definition.id, value, next))} />
          );
        })}
      </div>
    );
  }

  async function play(): Promise<void> { await engine.play(); setPlaying(true); }
  function pause(): void { engine.pause(); setPlaying(false); }
  function stop(): void { engine.stop(); setPlaying(false); }

  useEffect(() => {
    if (workspace === "arrangement") return;
    const heading = document.querySelector<HTMLElement>(".studio-workspace h2");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    if (workspace === "adaptive") { engine.stop(); setPlaying(false); }
  }, [workspace, engine]);

  useEffect(() => {
    const media = window.matchMedia("(max-width: 319px), (max-height: 479px)");
    const enforce = () => { if (media.matches) { engine.stop(); setPlaying(false); window.dispatchEvent(new Event("synaptix-stop-audio")); } };
    media.addEventListener("change", enforce); enforce();
    return () => media.removeEventListener("change", enforce);
  }, [engine]);

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
          <Button onClick={() => void executeV1(new SetLoopEnabledEditorCommand(project.transport.loopEnabled, !project.transport.loopEnabled))}>
            Loop: {project.transport.loopEnabled ? "On" : "Off"}
          </Button>
          <label>Tempo <input type="number" min={20} max={300} value={project.tempoMap[0]?.bpm ?? 120}
            onChange={(event) => {
              const raw = event.currentTarget.value;
              const next = event.currentTarget.valueAsNumber;
              const current = project.tempoMap[0]?.bpm ?? 120;
              if (raw === "" || !Number.isFinite(next) || next < 20 || next > 300 || next === current) return;
              void executeV1(new SetTempoEditorCommand(current, next));
            }} style={{ width: 64 }} /></label>
          <Button onClick={() => void coordinatorRef.current?.drain()}>Sync now</Button>
        </div>
        <div className="studio-status">
          <span className="status-pill" role="status" aria-label="Save state">
            <span className={`status-dot ${session.state === "failed" ? "danger" : session.state === "saving" ? "warning" : ""}`} />
            {session.readOnly ? "Read-only" : session.state === "saving" ? "Saving…" : session.state === "failed" ? "Not saved" : session.state === "unsaved" ? "Unsaved" : "Saved"}
          </span>
          <span className="status-pill"><span className={`status-dot ${syncTone}`} />{syncLabel}</span>
          <MasterMeter engine={engine} />
        </div>
      </header>

      {recovery && !session.readOnly && (
        <section className="conflict-banner" role="status">
          <strong>Unsaved changes were recovered</strong>
          <p style={{ margin: "6px 0" }}>
            Edits from {new Date(recovery.journaledAt).toLocaleString()} didn’t finish saving before
            the studio closed. Restore them to continue from there, or discard them to keep the
            project as it was last saved.
          </p>
          <Button onClick={() => void restoreRecovery(recovery)}>Restore changes</Button>{" "}
          <Button onClick={discardRecovery}>Discard</Button>
        </section>
      )}
      {session.state === "failed" && (
        <section className="conflict-banner" role="alert">
          <strong>Your latest changes aren’t saved</strong>
          <p style={{ margin: "6px 0" }}>
            {session.error ?? "Browser storage refused the save."} Keep this tab open, then retry.
            Your edits are still here.
          </p>
          <Button onClick={() => void retrySave()}>Retry save</Button>
        </section>
      )}
      {(storageHealth.level === "warning" || storageHealth.level === "critical") && session.state !== "failed" && (
        <section className="conflict-banner" role="status">
          <strong>{storageHealth.level === "critical" ? "Browser storage is almost full" : "Browser storage is getting full"}</strong>
          <p style={{ margin: "6px 0" }}>
            New edits may stop saving. From the project list, export projects you want to keep and
            delete ones you no longer need.
          </p>
        </section>
      )}
      {session.readOnly && (
        <section className="conflict-banner" role="status">
          <strong>This project is open in another tab</strong>
          <p style={{ margin: "6px 0" }}>
            Editing is paused here so the two tabs can’t overwrite each other. Close the other
            tab to keep editing in this one.
          </p>
        </section>
      )}

      <div className="studio-viewbar" aria-label="Workspace and panels">
        <label>Workspace <select value={workspace} onChange={(event) => setWorkspace(event.target.value as Workspace)}>
          <option value="arrangement">Arrangement</option>
          <option value="generation">Generate</option>
          <option value="adaptive">Adaptive states</option>
          <option value="render">Render / export</option>
          <option value="devices">Devices & effects</option>
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
          <div className="studio-sidebar-scroll">
          <p className="panel-label">Workspace</p>
          <nav className="studio-nav">
            <Button aria-current={workspace === "arrangement" && !activeClip ? "page" : undefined} onClick={() => { setWorkspace("arrangement"); setActiveClip(null); }}><span><span className="nav-glyph">A</span>Arrangement</span></Button>
            {([
              ["piano-roll", "P", "Piano roll", "Add a melodic instrument track with a clip to use the piano roll"],
              ["drum-sequencer", "D", "Drum sequencer", "Add a drum track with a clip to use the drum sequencer"]
            ] as const).map(([kind, glyph, label, unavailable]) => {
              const target = findEditorClip(project, kind as EditorKind, activeClip);
              const open = workspace === "arrangement" && activeClip !== null
                && editorKindForTrack(project, activeClip.trackId) === kind;
              return (
                <Button key={kind} disabled={!target} title={target ? undefined : unavailable}
                  aria-current={open ? "page" : undefined}
                  onClick={() => { if (target) { setWorkspace("arrangement"); setActiveClip(target); } }}>
                  <span><span className="nav-glyph">{glyph}</span>{label}</span>
                </Button>
              );
            })}
            <Button aria-expanded={mixerOpen} aria-controls="studio-mixer" onClick={() => changeMixerOpen(!mixerOpen)}><span><span className="nav-glyph">M</span>Mixer</span></Button>
          </nav>
          <p className="panel-label" style={{ marginTop: 22 }}>SynaptixPlay</p>
          <nav className="studio-nav">
            <Button aria-current={workspace === "generation" ? "page" : undefined} onClick={() => setWorkspace("generation")}><span><span className="nav-glyph">G</span>Generate</span><span className="nav-badge">AI</span></Button>
            <Button aria-current={workspace === "adaptive" ? "page" : undefined} onClick={() => setWorkspace("adaptive")}><span><span className="nav-glyph">S</span>Adaptive states</span><span className="nav-badge">13</span></Button>
            <Button aria-current={workspace === "render" ? "page" : undefined} onClick={() => setWorkspace("render")}><span><span className="nav-glyph" aria-hidden="true">R</span>Render / export</span></Button>
            <Button aria-current={workspace === "devices" ? "page" : undefined} onClick={() => setWorkspace("devices")}>Devices & effects</Button>
          </nav>
          <section className="sidebar-card" aria-label="Add instrument">
            <strong>Instruments</strong>
            <fieldset className="instrument-picker" aria-label="Choose an instrument">
              {INSTRUMENT_CATALOG.map((entry) => (
                <label key={entry.deviceType} className="instrument-tile" title={entry.description}
                  style={{ "--instrument-accent": INSTRUMENT_ACCENTS[entry.profile.kind] } as React.CSSProperties}>
                  <input type="radio" name="new-instrument" value={entry.deviceType}
                    checked={newInstrument === entry.deviceType} onChange={() => setNewInstrument(entry.deviceType)} />
                  <InstrumentIcon kind={entry.profile.kind} size={32} />
                  <span>{entry.label}</span>
                </label>
              ))}
            </fieldset>
            <p>{instrumentDefinition(newInstrument)?.description}</p>
            <Button disabled={!hydrated} onClick={() => void addInstrument(newInstrument)}>Add instrument track</Button>
          </section>
          <section className="sidebar-card" aria-label="Adaptive audio preview">
            <strong>Runtime preview</strong>
            <p>Audition rendered states, loops, and transitions with runtime events.</p>
            <Button onClick={() => { stop(); setWorkspace("adaptive"); }}>Open package preview</Button>
          </section>
          </div>
        </aside>

        <section className="studio-workspace" aria-label="Project workspace">
          {workspace === "arrangement" && <div className="workspace-tabs">
            <ViewTabs label="Editor views" value={activeClip ? "midi" : "arrangement"}
              onChange={(view) => { if (view === "arrangement") setActiveClip(null); }}
              tabs={[{ value: "arrangement", label: "Arrangement", panelId: "arrangement-view" },
                { value: "midi", label: "MIDI editor", panelId: "midi-view", disabled: !activeClip }]} />
            <span className="workspace-spacer" />
            <TransportPosition engine={engine} project={builtinView} />
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
      <ArrangementTimeline project={builtinView} engine={engine} onExecute={executeV1} onEdit={setActiveClip}
        renderControls={(track) => {
          const pluginTrack = project.tracks.find((candidate) => candidate.id === track.id);
          return <>
            <CommitSlider label="Volume" value={track.volumeDb} min={-36} max={6} step={1} disabled={!hydrated}
              format={(value) => `${value} dB`} onCommit={(value) => executeV1(new SetTrackVolumeEditorCommand(track.id, track.volumeDb, value))} />
            <CommitSlider label="Pan" value={track.pan} min={-1} max={1} step={0.1} disabled={!hydrated}
              format={(value) => value.toFixed(1)} onCommit={(value) => executeV1(new SetTrackPanEditorCommand(track.id, track.pan, value))} />
            {renderDeviceControls(track)}
            {pluginTrack && <PluginRack track={pluginTrack}
              statuses={pluginStatuses.filter((status) => status.trackId === track.id)}
              onExecute={(command) => void execute(command)}
              gestures={{
                begin: beginDeviceGesture,
                preview: previewDeviceParameter,
                end: (trackId, deviceId, parameterId, next) => void endDeviceGesture(trackId, deviceId, parameterId, next)
              }} />}
          </>;
        }} />
      </div>

      <div id="midi-view" role="tabpanel" aria-labelledby="midi-view-tab" hidden={!activeClip}>
      {activeClip && <PianoRoll key={`${activeClip.trackId}:${activeClip.clipId}`} engine={engine}
        project={builtinView}
        trackId={activeClip.trackId}
        clipId={activeClip.clipId}
        onExecute={executeV1}
        onClose={() => setActiveClip(null)}
      />}
      </div>
      </>}

      {workspace === "generation" && <GenerationWorkspace
        project={builtinView}
        onAddDrone={addFrequencyDrone}
        onApply={applyGeneratedVariation}
        onClose={() => setWorkspace("arrangement")}
      />}
      {workspace === "render" && <RenderWorkspace key={project.projectId} project={project} onClose={() => setWorkspace("arrangement")} onSync={async () => coordinatorRef.current?.drain()} />}
      {workspace === "devices" && <section aria-label="Devices and effects" className="device-workspace"><h2>Devices & effects</h2><p>Instrument → filter and envelope → track fader → output bus. Reverb sends feed the shared return in Mixer.</p><p>Use Tab to move between controls; arrow keys adjust values. Undo and redo use the project history.</p>{project.tracks.filter(track => track.devices.length > 0).map(track => <fieldset key={track.id}><legend>{track.name}</legend>{(() => { const type = (primaryDevice(track) ?? track.devices[0])?.deviceType ?? ""; if (type === FREQUENCY_DRONE_DEVICE_TYPE) return <p>Frequency Drone</p>; const definition = resolveInstrumentDefinition(type, track.name); return <p className="device-instrument"><InstrumentIcon kind={definition.profile.kind} size={28} />{definition.label}</p>; })()}{renderDeviceControls(track)}</fieldset>)}<Button onClick={() => setWorkspace("arrangement")}>Back to arrangement</Button></section>}
      {workspace === "adaptive" && <AdaptiveStatesWorkspace key={project.projectId} project={builtinView} onClose={() => setWorkspace("arrangement")} />}
        </section>

        <aside id="studio-inspector" className="studio-inspector" aria-label="Project inspector" hidden={!panelLayout.inspectorVisible}>
          <div className="inspector-resize-edge"><ResizeHandle label="Inspector panel size" controls="studio-inspector" orientation="vertical"
            value={panelLayout.layout.inspectorWidth} min={220} max={400} direction={-1}
            onChange={(inspectorWidth) => panelLayout.update({ inspectorWidth })} /></div>
          <div className="inspector-heading"><h2>Project inspector</h2><span className="inspector-chip">Live</span></div>
          <dl className="property-list">
            <div className="property-row"><dt>Project</dt><dd>{project.projectId}</dd></div>
            <div className="property-row"><dt>Tracks</dt><dd>{project.tracks.length}</dd></div>
            <div className="property-row"><dt>Length</dt><dd>{arrangementBars(builtinView)} bars</dd></div>
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
      {mixerOpen && <MixerDrawer project={builtinView} engine={engine} storageStatus={storageStatus}
        height={panelLayout.mixerHeight} maxHeight={panelLayout.mixerMax} onResize={(mixerHeight) => panelLayout.update({ mixerHeight })}
        syncLabel={syncLabel} onExecute={executeV1} onExport={() => { changeMixerOpen(false); setWorkspace("render"); }} onClose={() => changeMixerOpen(false)} />
    </main>
  );
}

"use client";

import { Badge, Button, ViewTabs } from "../../../components/ui/StudioControls";
import { useStudioLayout, type DockTab } from "../../../lib/editor/use-studio-layout";
import { ResizeHandle } from "../../../components/ui/ResizeHandle";
import { PLATFORM_SESSION_EVENT } from "../../../components/PlatformAccount";

import { useEffect, useMemo, useRef, useState } from "react";

import type { ProjectRevision } from "@synaptix/command-system";
import { SetDeviceParameterEditorCommand } from "@synaptix/command-system/device";
import { AddClipEditorCommand, AddTrackEditorCommand, SwapInstrumentEditorCommand } from "@synaptix/command-system/track";
import {
  EditorCommandHistory,
  RenameProjectEditorCommand,
  SetLoopEnabledEditorCommand,
  SetTempoEditorCommand,
  SetTrackPanEditorCommand,
  SetTrackVolumeEditorCommand,
  type EditorCommand
} from "@synaptix/command-system/editor";
import { liftEditorCommandToV2, SetFrozenPluginArtifactEditorCommand, type PluginEditorCommand } from "@synaptix/command-system/plugin";
import { evaluateFrozenPluginEvidence, type FrozenPluginEvidenceStatus } from "@synaptix/project-model/plugin";
import { RenderJobSchema } from "@synaptix/render-contracts";
import {
  BrowserAudioEngine,
  builtinProjectView,
  createFrequencyDroneTrack,
  createInstrumentTrack,
  instrumentDefinition,
  primaryDevice,
  resolveInstrumentDefinition,
  resolveTrackOutput,
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
  isPlatformProjectId,
  platformEnvelopeConverter,
  type PlatformRevisionEnvelope,
  type RevisionUploadResult
} from "@synaptix/project-storage/platform-sync";

import { ApplyGeneratedArrangementEditorCommand } from "../../../lib/editor/apply-generated-arrangement-command";
import { HttpPlatformProjectRepository } from "../../../lib/platform/platform-project-repository";
import { ProjectSyncCoordinator, type ProjectSyncSnapshot } from "../../../lib/platform/project-sync-coordinator";
import { GenerationWorkspace } from "./GenerationWorkspace";
import { AdaptiveStatesWorkspace } from "./AdaptiveStatesWorkspace";
import { MixerDrawer } from "./MixerDrawer";
import { DockMixer } from "./DockMixer";
import { StudioBrowser } from "./StudioBrowser";
import { DeviceControls, DevicesWorkspace } from "./DeviceControls";
import { DeviceChain } from "./DeviceChain";
import { StudioBanners } from "./StudioBanners";
import { StudioInspector } from "./StudioInspector";
import { LayoutMenu, StudioSidebar, StudioViewbar, type ActiveClip, type Workspace } from "./StudioSidebar";
import { hintFor, SaveSyncStatus, StatusAccount, StudioDialog, StudioDock, StudioDrawer, StudioStatusBar, StudioTransportBar } from "./StudioV2";
import { StudioTopbar } from "./StudioTopbar";
import { RenderWorkspace } from "./RenderWorkspace";
import { PianoRoll } from "./PianoRoll";
import { PluginRack, pluginInsertNames } from "./PluginRack";
import { createFreezeManifest, FreezeError, freezeReference, storedRevision } from "../../../lib/platform/plugin-freeze-model";
import { createPlatformFrozenAudioSource } from "../../../lib/platform/frozen-audio-source";
import { studioStartTick } from "../../../lib/player/playback-model";
import { usePlayer } from "../../../lib/player/player-store";
import { ArrangementTimeline } from "./ArrangementTimeline";
import { TransportCounters, TransportPosition } from "./TransportPosition";
import { INSTRUMENT_ACCENTS } from "./InstrumentIcon";
import { CommitSlider } from "../../../components/ui/CommitSlider";
import { arrangementBars, barTicks } from "../../../lib/editor/timeline-model";
import { describeSaveError } from "../../../lib/editor/storage-health";
import { useStorageHealth } from "../../../lib/editor/use-storage-health";
import {
  clearRecovery,
  journalRevision,
  readRecovery,
  type RecoveryEntry
} from "../../../lib/editor/recovery-journal";
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

const INITIAL_SYNC: ProjectSyncSnapshot = { state: "idle", lastSyncedAt: null, conflicts: [], error: null };
type DeviceGesture = { trackId: string; deviceId: string; parameterId: string; initial: number };

export default function StudioClient({ projectId }: { projectId: string }) {
  // Browser-only projects (such as the local demo) are saved locally and never uploaded.
  const cloudEligible = isPlatformProjectId(projectId);
  const [project, setProject] = useState(() => createStarterProject(projectId, seedOptions(projectId)));
  const [playing, setPlaying] = useState(false);
  const [storageStatus, setStorageStatus] = useState("Loading project…");
  const [hydrated, setHydrated] = useState(false);
  const [sync, setSync] = useState(INITIAL_SYNC);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [activeClip, setActiveClip] = useState<ActiveClip | null>(null);
  // The DAW layout's timeline selection; the inspector and Browser follow it.
  const [selectedClip, setSelectedClip] = useState<ActiveClip | null>(null);
  const [workspace, setWorkspace] = useState<Workspace>("arrangement");
  // Per track, whether its device's Modulation section is open (unset: open when it is in use).
  const [modulationOpen, setModulationOpen] = useState<Record<string, boolean>>({});
  // v2 dock Devices tab: the track shown; it follows the clip being edited.
  const [deviceTrackId, setDeviceTrackId] = useState<string | null>(null);
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
  const engine = useMemo(() => new BrowserAudioEngine({ frozenAudio: createPlatformFrozenAudioSource() }), []);
  // Tone.js has one global transport: the listening player hands the audio to the studio.
  useEffect(() => { usePlayer.getState().release(); }, []);
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
  // Edits, undo and redo run one at a time, each from the latest project: the history refuses
  // overlapping operations, and a fast second edit must build on the first, not on stale state.
  const projectRef = useRef(project);
  const editQueueRef = useRef<Promise<void>>(Promise.resolve());
  const pendingEditsRef = useRef(0);
  useEffect(() => {
    if (pendingEditsRef.current === 0) projectRef.current = project;
  }, [project]);
  const [pluginStatuses, setPluginStatuses] = useState<PluginRuntimeStatus[]>([]);
  // Built-in controls and the v1-typed workspaces read a view without plug-in devices.
  const builtinView = useMemo(() => builtinProjectView(project), [project]);
  const deviceGestureRef = useRef<DeviceGesture | null>(null);
  // Plug-in freezes: progress per device, and whether each attached freeze is still current.
  const [freezeProgress, setFreezeProgress] = useState<Record<string, { busy: boolean; message: string }>>({});
  const [freezeEvidence, setFreezeEvidence] = useState<ReadonlyMap<string, FrozenPluginEvidenceStatus>>(new Map());
  useEffect(() => {
    let cancelled = false;
    const frozen = project.tracks.flatMap((track) =>
      track.devices.filter((device) => device.frozen).map((device) => ({ trackId: track.id, deviceId: device.id })));
    void Promise.all(frozen.map(async ({ trackId, deviceId }) =>
      [deviceId, await evaluateFrozenPluginEvidence(project, deviceId, trackId)] as const
    )).then((entries) => { if (!cancelled) setFreezeEvidence(new Map(entries)); });
    return () => { cancelled = true; };
  }, [project]);

  useEffect(() => {
    let cancelled = false;
    const local = new LocalProjectRepository<StoredMusicProject>(new IndexedDbProjectStorage(), { parse: parseVersionedMusicProject });
    const toPlatform = platformEnvelopeConverter(PLATFORM_PROJECT_SCHEMA_VERSION);
    const hybrid = new HybridProjectRepository(local, new HttpPlatformProjectRepository(), new IndexedDbProjectSyncQueue(), {
      toPlatformEnvelope: (envelope) => isPlatformProjectId(envelope.projectId) ? toPlatform(envelope) : Promise.resolve(null)
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
      // Revisions that could not upload earlier (e.g. before plug-in sync) go up now.
      void syncNow();
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

  useEffect(() => {
    // Edits saved while signed out upload as soon as a session starts.
    function onSession(event: Event) {
      if ((event as CustomEvent<{ signedIn: boolean }>).detail?.signedIn) void syncNow();
    }
    window.addEventListener(PLATFORM_SESSION_EVENT, onSession);
    return () => window.removeEventListener(PLATFORM_SESSION_EVENT, onSession);
  });

  useEffect(() => engine.loadProject(project), [engine, project]);
  // Arriving from the listening player with `?t=<seconds>`: start the playhead there (once).
  useEffect(() => {
    if (!hydrated) return;
    const url = new URL(window.location.href);
    if (!url.searchParams.has("t")) return;
    const tick = studioStartTick(project, url.searchParams.get("t"));
    url.searchParams.delete("t");
    window.history.replaceState(null, "", url);
    if (tick !== null) engine.seek({ bar: 0, beat: 0, tick });
    // Only when the project first loads; later edits must not move the playhead.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hydrated]);
  useEffect(() => engine.subscribePluginStatus(setPluginStatuses), [engine]);

  useEffect(() => {
    // Close the piano roll if its track was deleted (or undone/redone away).
    if (activeClip && !project.tracks.some((track) => track.id === activeClip.trackId)) setActiveClip(null);
    if (selectedClip && !project.tracks.some((track) => track.clips.some((clip) => clip.id === selectedClip.clipId))) setSelectedClip(null);
  }, [project, activeClip, selectedClip]);
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

  async function persistRevision(envelope: PlatformRevisionEnvelope) {
    const hybrid = hybridRef.current;
    if (!hybrid) throw new Error("Project storage is not ready.");
    try {
      const outcome = await hybrid.saveAndQueue(
        envelope,
        persistedRevisionRef.current,
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

  /** Uploads the latest local revision if the platform never received it, then syncs. */
  async function syncNow(): Promise<void> {
    if (cloudEligible && !sessionRef.current.snapshot.readOnly) {
      try {
        if (await hybridRef.current?.queueUnsyncedHead(projectId) === "blocked") {
          setStorageStatus("Saved on this device; cloud sync needs platform support for plug-in projects");
        }
      } catch {
        // Offline or platform unavailable: the sync status reports it.
      }
    }
    await drainSync();
  }

  async function queueRevision(nextProject: MusicProjectV2, revision: ProjectRevision): Promise<void> {
    const envelope: PlatformRevisionEnvelope = { projectId: nextProject.projectId, project: nextProject, revision };
    latestEnvelopeRef.current = envelope;
    sessionRef.current.markSaving(envelope);
    // Write-ahead: if the tab dies before the save lands, the edit survives.
    journalRevision(envelope);
    let outcome;
    try {
      outcome = await persistRevision(envelope);
    } catch (error) {
      sessionRef.current.markFailed(error);
      setStorageStatus("Changes not saved");
      return;
    }
    clearRecovery(envelope.projectId);
    sessionRef.current.markSaved(revision.revisionId);
    if (outcome && !outcome.queued) {
      setStorageStatus(cloudEligible
        ? "Revision saved locally; cloud sync needs platform support for plug-in projects"
        : "Revision saved locally; demo projects stay in this browser");
      return;
    }
    setStorageStatus("Revision saved and queued");
    // Cloud upload runs in the background so queued edits never wait on the network.
    void drainSync();
  }

  async function restoreRecovery(entry: RecoveryEntry): Promise<void> {
    setRecovery(null);
    setProject(toProjectV2(entry.envelope.project));
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
    if (await sessionRef.current.retry(async (envelope) => { await persistRevision(envelope); })) {
      clearRecovery(projectId);
      setStorageStatus("Revision saved and queued");
      await drainSync();
    }
  }

  /** v1 editor commands (tracks, clips, timing) run through an adapter that keeps plug-in data. */
  function executeV1(command: EditorCommand): Promise<void> {
    return execute(liftEditorCommandToV2(command));
  }

  /** Runs a history operation after any queued ones, then saves its revision. */
  function enqueueEdit(
    operation: (current: MusicProjectV2) => Promise<{ project: MusicProjectV2; revision: ProjectRevision } | null>
  ): Promise<void> {
    if (session.readOnly) return Promise.resolve();
    pendingEditsRef.current += 1;
    const run = editQueueRef.current.then(async () => {
      try {
        const result = await operation(projectRef.current);
        if (!result) return;
        projectRef.current = result.project;
        setProject(result.project);
        setHistoryVersion((value) => value + 1);
        await queueRevision(result.project, result.revision);
      } finally {
        pendingEditsRef.current -= 1;
      }
    });
    // A failed edit must not block the ones queued after it.
    editQueueRef.current = run.catch(() => undefined);
    return run;
  }

  function execute(command: PluginEditorCommand): Promise<void> {
    return enqueueEdit((current) => historyRef.current.execute(current, command));
  }

  async function addFrequencyDrone(frequencyHz: number): Promise<void> {
    await executeV1(new AddTrackEditorCommand(createFrequencyDroneTrack({ frequencyHz })));
    setWorkspace("arrangement");
  }

  async function addInstrument(deviceType: string): Promise<void> {
    await executeV1(new AddTrackEditorCommand(createInstrumentTrack(deviceType, {
      bars: TOTAL_BARS,
      beatsPerBar: project.timeSignatureMap[0]?.numerator ?? 4,
      ticksPerQuarterNote: project.transport.ticksPerQuarterNote
    })));
    setWorkspace("arrangement");
  }

  /** Swaps a track's instrument (DAW Browser); a track still named after its instrument takes the new name. */
  async function swapInstrument(trackId: string, deviceType: string): Promise<void> {
    const track = builtinView.tracks.find((candidate) => candidate.id === trackId);
    const next = instrumentDefinition(deviceType);
    if (!track || !next) return;
    const current = (primaryDevice(track) ?? track.devices[0])?.deviceType;
    const named = current !== undefined && instrumentDefinition(current)?.label === track.name;
    await executeV1(new SwapInstrumentEditorCommand(trackId, deviceType, named ? { name: next.label } : {}));
  }

  /** Renders a first-party plug-in's output on the render worker and attaches it as a freeze. */
  async function freezePlugin(trackId: string, deviceId: string): Promise<void> {
    const report = (message: string, busy = true) =>
      setFreezeProgress((current) => ({ ...current, [deviceId]: { busy, message } }));
    const platform = async (path: string, init?: RequestInit) => {
      const response = await fetch(`/api/platform/${path}`, { cache: "no-store", ...init });
      if (response.status === 401) throw new FreezeError("Sign in to SynaptixPlay to freeze plug-ins.");
      const body = await response.json().catch(() => null) as unknown;
      if (!response.ok) throw new FreezeError((body as { message?: string } | null)?.message ?? `Freezing failed (${response.status}).`);
      return body;
    };
    try {
      if (!cloudEligible) throw new FreezeError("Freezing needs a cloud project. Demo projects stay in this browser.");
      report("Syncing this revision…");
      await syncNow();
      const local = projectRef.current;
      const stored = await storedRevision(await platform(`projects/${encodeURIComponent(local.projectId)}`), local);
      const manifest = await createFreezeManifest(stored, trackId, deviceId);
      report("Rendering the frozen audio…");
      let job = RenderJobSchema.parse(await platform("render-jobs", {
        method: "POST",
        headers: { "content-type": "application/json", "idempotency-key": `plugin-freeze:${manifest.renderId}` },
        body: JSON.stringify({ manifest })
      }));
      const deadline = Date.now() + 180_000;
      while (!["completed", "failed", "cancelled", "dead_letter"].includes(job.status)) {
        if (Date.now() > deadline) throw new FreezeError("The freeze render is taking too long. Check Render / export for its status.");
        await new Promise((resolve) => setTimeout(resolve, 2000));
        job = RenderJobSchema.parse(await platform(`render-jobs/${encodeURIComponent(job.jobId)}`));
      }
      const reference = await freezeReference(stored, manifest, job);
      const current = projectRef.current.tracks.find((track) => track.id === trackId)?.devices.find((device) => device.id === deviceId);
      if (!current) throw new FreezeError("The plug-in was removed while it was freezing.");
      await execute(new SetFrozenPluginArtifactEditorCommand(trackId, deviceId, current.frozen ?? null, reference));
      report("", false);
    } catch (error) {
      report(error instanceof FreezeError ? error.message : "Freezing failed. Try again.", false);
    }
  }

  async function applyGeneratedVariation(proposal: GenerationProposal, jobId: string): Promise<void> {
    await executeV1(new ApplyGeneratedArrangementEditorCommand(proposal, jobId));
    setActiveClip(null);
  }

  function undo(): Promise<void> {
    return enqueueEdit((current) => historyRef.current.undo(current));
  }

  function redo(): Promise<void> {
    return enqueueEdit((current) => historyRef.current.redo(current));
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

  const toggleModulation = (trackId: string, open: boolean) =>
    setModulationOpen((current) => current[trackId] === open ? current : { ...current, [trackId]: open });
  const deviceControls = { hydrated, onExecute: execute, modulationOpen, onModulationToggle: toggleModulation };

  async function play(): Promise<void> { await engine.play(); setPlaying(true); }
  function pause(): void { engine.pause(); setPlaying(false); }
  function stop(): void { engine.stop(); setPlaying(false); }

  const v2 = panelLayout.v2;
  useEffect(() => {
    if (workspace === "arrangement" || (v2 && workspace === "devices")) return;
    // DAW layout: Generate is a drawer and Export a dialog; each takes focus to its heading.
    const heading = document.querySelector<HTMLElement>(!v2 ? ".studio-workspace h2"
      : workspace === "generation" ? ".studio-drawer h2" : workspace === "render" ? ".studio-dialog h2" : ".studio-v2-main h2");
    heading?.setAttribute("tabindex", "-1");
    heading?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
    if (workspace === "adaptive") { engine.stop(); setPlaying(false); }
  }, [workspace, engine, v2]);

  // v2 dock: choosing the open tab collapses it; any other tab opens the dock on that tab.
  function chooseDockTab(tab: DockTab): void {
    const { dockTab, dockOpen } = panelLayout.layout;
    panelLayout.update(dockOpen && dockTab === tab ? { dockOpen: false } : { dockTab: tab, dockOpen: true });
  }
  function openInDock(clip: ActiveClip): void {
    setActiveClip(clip);
    setDeviceTrackId(null);
    panelLayout.update({ dockTab: "editor", dockOpen: true });
  }
  const [hint, setHint] = useState("Alt+1, Alt+2 and Alt+3 switch the dock · Alt+S switches Arrange and Adaptive states");
  /** DAW layout: closes the Generate drawer or Export dialog and returns focus to the button that opened it. */
  function closeOverlay(opener: "generate" | "export"): void {
    setWorkspace("arrangement");
    requestAnimationFrame(() => document.querySelector<HTMLElement>(`.studio-transportbar [data-opens="${opener}"]`)?.focus());
  }
  // DAW layout on narrow screens: the Browser or inspector opened over the timeline.
  const [panelOverlay, setPanelOverlay] = useState<"browser" | "inspector" | null>(null);
  function togglePanelOverlay(panel: "browser" | "inspector"): void {
    const opening = panelOverlay !== panel;
    setPanelOverlay(opening ? panel : null);
    requestAnimationFrame(() => {
      if (opening) document.querySelector<HTMLElement>(`#studio-${panel} h2`)?.focus();
      else document.querySelector<HTMLElement>(`.studio-transportbar [data-opens="${panel}"]`)?.focus();
    });
  }
  function closePanelOverlay(): void {
    const panel = panelOverlay;
    setPanelOverlay(null);
    // The opener may be inside the More menu, which has closed; then focus the menu's button.
    requestAnimationFrame(() => (document.querySelector<HTMLElement>(`.studio-transportbar [data-opens="${panel}"]`)
      ?? document.querySelector<HTMLElement>(".studio-transportbar [aria-controls][aria-expanded]"))?.focus());
  }
  useEffect(() => {
    if (!v2) return;
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.altKey && !event.shiftKey && event.code === "KeyE") {
        event.preventDefault();
        setWorkspace("render");
        return;
      }
      if (!event.altKey || event.ctrlKey || event.metaKey) return;
      const tab = ({ Digit1: "editor", Digit2: "devices", Digit3: "mixer" } as const)[event.code as "Digit1"];
      if (tab) { event.preventDefault(); chooseDockTab(tab); }
      else if (event.code === "KeyS") { event.preventDefault(); setWorkspace((current) => current === "adaptive" ? "arrangement" : "adaptive"); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  useEffect(() => {
    const media = window.matchMedia("(max-width: 319px), (max-height: 479px)");
    const enforce = () => { if (media.matches) { engine.stop(); setPlaying(false); window.dispatchEvent(new Event("synaptix-stop-audio")); } };
    media.addEventListener("change", enforce); enforce();
    return () => media.removeEventListener("change", enforce);
  }, [engine]);

  const syncLabel = !cloudEligible ? "Local only"
    : sync.state === "syncing" ? "Syncing…"
      : sync.state === "offline" ? "Offline"
        : sync.state === "signed-out" ? "Sign in to sync"
          : sync.state === "conflict" ? "Conflict"
            : sync.error ?? (sync.lastSyncedAt ? `Synced ${new Date(sync.lastSyncedAt).toLocaleTimeString()}` : "Local only");
  const history = historyRef.current;
  void historyVersion;
  void hydrated;

  const syncTone = !cloudEligible ? ""
    : sync.state === "conflict" || sync.error ? "danger"
      : sync.state === "offline" || sync.state === "signed-out" ? "warning" : "";

  const bpm = project.tempoMap[0]?.bpm ?? 120;
  const topbarProps = {
    engine, name: project.metadata.name, bpm, storageStatus, renameDisabled: !hydrated || session.readOnly,
    onRename: (next: string) => execute(new RenameProjectEditorCommand(project.metadata.name, next)),
    playing, onPlay: () => void play(), onPause: pause, onStop: stop,
    canUndo: history.canUndo, canRedo: history.canRedo, onUndo: () => void undo(), onRedo: () => void redo(),
    loopEnabled: project.transport.loopEnabled,
    onToggleLoop: () => void executeV1(new SetLoopEnabledEditorCommand(project.transport.loopEnabled, !project.transport.loopEnabled)),
    onTempo: (next: number) => void executeV1(new SetTempoEditorCommand(bpm, next)),
    onSyncNow: () => void syncNow(), saveState: session, syncLabel, syncTone
  };
  const banners = <StudioBanners recovery={recovery} readOnly={session.readOnly} saveFailed={session.state === "failed"}
    saveError={session.error} storageLevel={storageHealth.level}
    onRestore={(entry) => void restoreRecovery(entry)} onDiscard={discardRecovery} onRetrySave={() => void retrySave()} />;
  const conflictBanners = sync.conflicts.map((conflict) => conflict.outcome === "conflict" && (
    <section key={conflict.currentRevisionId} className="conflict-banner">
      <strong>Cloud revision conflict</strong>
      <p style={{ margin: "6px 0" }}>Remote head: {conflict.currentRevisionId}. Choose which version should remain active.</p>
      <Button onClick={() => void useCloud(conflict)}>Use cloud</Button>{" "}
      <Button onClick={() => void keepMine(conflict)}>Keep mine</Button>
    </section>
  ));
  const timeline = (onEdit: (clip: ActiveClip) => void, daw?: Pick<Parameters<typeof ArrangementTimeline>[0], "trackColor" | "emptyState" | "onSelect" | "onDropInstrument">) => (
    <ArrangementTimeline project={builtinView} engine={engine} onExecute={executeV1} onEdit={onEdit} {...daw}
      renderControls={(track) => {
        const pluginTrack = project.tracks.find((candidate) => candidate.id === track.id);
        return <>
          <CommitSlider label="Volume" value={track.volumeDb} min={-36} max={6} step={1} disabled={!hydrated}
            format={(value) => `${value} dB`} onCommit={(value) => executeV1(new SetTrackVolumeEditorCommand(track.id, track.volumeDb, value))} />
          <CommitSlider label="Pan" value={track.pan} min={-1} max={1} step={0.1} disabled={!hydrated}
            format={(value) => value.toFixed(1)} onCommit={(value) => executeV1(new SetTrackPanEditorCommand(track.id, track.pan, value))} />
          <DeviceControls track={track} {...deviceControls} />
          {pluginTrack && <PluginRack track={pluginTrack}
            statuses={pluginStatuses.filter((status) => status.trackId === track.id)}
            onExecute={(command) => void execute(command)}
            freeze={{ evidence: freezeEvidence, progress: freezeProgress, onFreeze: (trackId, deviceId) => void freezePlugin(trackId, deviceId) }}
            gestures={{
              begin: beginDeviceGesture,
              preview: previewDeviceParameter,
              end: (trackId, deviceId, parameterId, next) => void endDeviceGesture(trackId, deviceId, parameterId, next)
            }} />}
        </>;
      }} />
  );
  const pianoRoll = (variant?: "daw") => activeClip && <PianoRoll key={`${activeClip.trackId}:${activeClip.clipId}`} engine={engine} variant={variant}
    project={builtinView}
    trackId={activeClip.trackId}
    clipId={activeClip.clipId}
    onExecute={executeV1}
    onClose={() => setActiveClip(null)}
  />;
  const toArrangement = () => setWorkspace("arrangement");
  const workspaces = <>
    {workspace === "generation" && <GenerationWorkspace
      project={builtinView}
      onAddDrone={addFrequencyDrone}
      onApply={applyGeneratedVariation}
      onClose={toArrangement}
    />}
    {workspace === "render" && <RenderWorkspace key={project.projectId} project={builtinView} editorProject={project} onClose={toArrangement} onSync={async () => coordinatorRef.current?.drain()} />}
    {workspace === "adaptive" && <AdaptiveStatesWorkspace key={project.projectId} project={builtinView} onClose={toArrangement} />}
  </>;
  // DAW layout: the inspector and Browser follow the timeline selection, else the clip being edited.
  const inspectedClip = selectedClip ?? activeClip;
  const inspectedTrack = (inspectedClip && builtinView.tracks.find((track) => track.id === inspectedClip.trackId)) ?? null;
  const inspectedClipData = inspectedTrack?.clips.find((clip) => clip.id === inspectedClip?.clipId);
  const selection = panelLayout.v2 && inspectedTrack && inspectedClipData ? {
    clip: inspectedClipData,
    track: inspectedTrack,
    instrument: resolveInstrumentDefinition((primaryDevice(inspectedTrack) ?? inspectedTrack.devices[0])?.deviceType ?? "", inspectedTrack.name).label,
    output: { music: "Music bus", drums: "Drums bus", master: "Master" }[resolveTrackOutput(inspectedTrack)],
    bars: Math.round(inspectedClipData.range.durationTicks / barTicks(builtinView)),
    startBar: inspectedClipData.range.start.bar + 1
  } : null;
  const inspector = <StudioInspector panelLayout={panelLayout} projectId={project.projectId} trackCount={project.tracks.length}
    bars={arrangementBars(builtinView)} bpm={bpm} syncLabel={syncLabel} selection={selection}
    onOpenGenerator={() => setWorkspace("generation")}
    overlay={panelLayout.v2 ? { open: panelOverlay === "inspector", onClose: closePanelOverlay } : undefined} />;

  // DAW layout: a track takes its own colour, else its instrument family's (as the engine resolves it).
  const dawTrackColor = (track: Track) => track.color ?? INSTRUMENT_ACCENTS[resolveInstrumentDefinition((primaryDevice(track) ?? track.devices[0])?.deviceType ?? "", track.name).profile.kind];

  if (panelLayout.v2) {
    const { dockTab, dockOpen } = panelLayout.layout;
    const dockClip = activeClip && builtinView.tracks.find((track) => track.id === activeClip.trackId);
    const browserOverlay = panelOverlay === "browser" && !panelLayout.navigationVisible;
    return (
      <main className={`studio-v2${panelLayout.mobile ? " studio-v2-phone" : ""}`}
        onFocus={(event) => { const next = hintFor(event.target); if (next) setHint(next); }}
        onPointerOver={(event) => { const next = hintFor(event.target); if (next) setHint(next); }}
        style={{
          "--studio-nav-width": panelLayout.navigationVisible ? `${panelLayout.navigationWidth}px` : "0px",
          "--studio-inspector-width": panelLayout.inspectorVisible ? `${panelLayout.layout.inspectorWidth}px` : "0px"
        } as React.CSSProperties}>
        <StudioTransportBar {...topbarProps}
          position={<TransportCounters engine={engine} project={builtinView} />}
          view={workspace === "adaptive" ? "adaptive" : "arrange"}
          onView={(view) => setWorkspace(view === "adaptive" ? "adaptive" : "arrangement")}
          onGenerate={() => setWorkspace("generation")} onExport={() => setWorkspace("render")}
          layoutMenu={<LayoutMenu panelLayout={panelLayout} onReset={() => undefined} />}
          compact={panelLayout.mobile}
          panels={[
            ...(!panelLayout.navigationVisible && panelLayout.mobile ? [{ id: "browser" as const, label: "Browser", open: panelOverlay === "browser", onToggle: () => togglePanelOverlay("browser") }] : []),
            ...(!panelLayout.inspectorVisible && panelLayout.narrow ? [{ id: "inspector" as const, label: "Inspector", open: panelOverlay === "inspector", onToggle: () => togglePanelOverlay("inspector") }] : [])
          ]} />
        <div className="studio-v2-banners">{banners}</div>
        <div className="studio-v2-body">
          <aside id="studio-browser" aria-label="Browser"
            className={`studio-browser${browserOverlay ? " studio-overlay studio-overlay-left" : ""}`}
            hidden={!panelLayout.navigationVisible && !browserOverlay}
            onKeyDown={browserOverlay ? (event) => { if (event.key === "Escape") { event.preventDefault(); closePanelOverlay(); } } : undefined}>
            {!browserOverlay && <ResizeHandle label="Browser panel size" controls="studio-browser" orientation="vertical"
              value={panelLayout.navigationWidth} min={160} max={320} onChange={(navigationWidth) => panelLayout.update({ navigationWidth })} />}
            <div className="studio-sidebar-scroll">
              <div className="studio-overlay-heading"><h2 className="panel-label" tabIndex={-1}>Browser</h2>
                {browserOverlay && <Button className="studio-overlay-close" onClick={closePanelOverlay}>Close</Button>}</div>
              <StudioBrowser project={builtinView} value={newInstrument} onChange={setNewInstrument}
                selectedTrack={inspectedTrack} disabled={!hydrated}
                onAdd={(deviceType) => void addInstrument(deviceType)}
                onSwap={(trackId, deviceType) => void swapInstrument(trackId, deviceType)}
                onAddClip={(trackId, clip) => void executeV1(new AddClipEditorCommand(trackId, clip)).then(() => openInDock({ trackId, clipId: clip.id }))}
                onOpenClip={openInDock} onOpenGenerator={() => setWorkspace("generation")} onExport={() => setWorkspace("render")} />
            </div>
          </aside>
          <div className="studio-v2-centre">
            <section className="studio-v2-main" aria-label="Project workspace">
              {workspace === "adaptive"
                ? <AdaptiveStatesWorkspace key={project.projectId} project={builtinView} onClose={toArrangement} variant="daw" />
                : <>{conflictBanners}{timeline(openInDock, {
                  trackColor: dawTrackColor,
                  onSelect: setSelectedClip,
                  onDropInstrument: (deviceType, trackId) => void (trackId ? swapInstrument(trackId, deviceType) : addInstrument(deviceType)),
                  emptyState: <div className="timeline-empty">
                    <strong>Start with an instrument</strong>
                    <p>Choose one in the Browser, then add it as a track. Its starter phrase gives you something to edit straight away.</p>
                    <Button disabled={!hydrated} onClick={() => void addInstrument(newInstrument)}>Add {instrumentDefinition(newInstrument)?.label ?? "instrument"} track</Button>
                  </div>
                })}</>}
            </section>
            <StudioDock tab={dockTab} open={dockOpen} onTab={chooseDockTab}
              height={panelLayout.dockHeight} maxHeight={panelLayout.dockMax}
              onResize={(dockHeight) => panelLayout.update({ dockHeight })}
              context={dockTab === "mixer" ? "All tracks" : dockTab === "devices" ? "Device chain" : dockClip ? `${dockClip.name} · ${dockClip.clips.find((clip) => clip.id === activeClip?.clipId)?.name ?? ""}` : "No clip selected"}
              panels={{
                editor: pianoRoll("daw") || <p className="studio-dock-empty">Select a clip in the arrangement, then press Enter or double-click it to edit it here.</p>,
                devices: <DeviceChain tracks={project.tracks} trackId={deviceTrackId ?? activeClip?.trackId ?? null}
                  onTrack={setDeviceTrackId} {...deviceControls}
                  inserts={(chainTrack) => { const track = project.tracks.find((candidate) => candidate.id === chainTrack.id); return track && <PluginRack track={track}
                    statuses={pluginStatuses.filter((status) => status.trackId === track.id)}
                    onExecute={(command) => void execute(command)}
                    freeze={{ evidence: freezeEvidence, progress: freezeProgress, onFreeze: (trackId, deviceId) => void freezePlugin(trackId, deviceId) }}
                    gestures={{
                      begin: beginDeviceGesture,
                      preview: previewDeviceParameter,
                      end: (trackId, deviceId, parameterId, next) => void endDeviceGesture(trackId, deviceId, parameterId, next)
                    }} />; }} />,
                mixer: <DockMixer project={builtinView} engine={engine} trackColor={dawTrackColor}
                  pluginNames={(id) => { const track = project.tracks.find((candidate) => candidate.id === id); return track ? pluginInsertNames(track) : []; }}
                  selectedTrackId={activeClip?.trackId ?? null} onExecute={executeV1}
                  onOpenDevices={(id) => { setDeviceTrackId(id); chooseDockTab("devices"); }} />
              }} />
          </div>
          {inspector}
          {workspace === "generation" && <StudioDrawer label="Generate" onClose={() => closeOverlay("generate")}>
            <GenerationWorkspace project={builtinView} onAddDrone={addFrequencyDrone} onApply={applyGeneratedVariation}
              onClose={() => closeOverlay("generate")} variant="drawer" />
          </StudioDrawer>}
        </div>
        {workspace === "render" && <StudioDialog label="Export" onClose={() => closeOverlay("export")}>
          <RenderWorkspace key={project.projectId} project={builtinView} editorProject={project} variant="dialog"
            onClose={() => closeOverlay("export")} onSync={async () => coordinatorRef.current?.drain()} />
        </StudioDialog>}
        <StudioStatusBar hint={hint}
          facts={<><SaveSyncStatus {...topbarProps} /><span>Revision {project.revisionId.slice(0, 8)}</span><span>{project.tracks.length} tracks</span><span>{arrangementBars(builtinView)} bars</span><StatusAccount /></>} />
      </main>
    );
  }

  return (
    <main className={`studio-shell${mixerOpen ? " studio-shell-mixer-open" : ""}`}
      style={{ "--studio-mixer-height": `${panelLayout.mixerHeight}px` } as React.CSSProperties}>
      <StudioTopbar {...topbarProps} />

      {banners}

      <StudioViewbar ref={mixerToggleRef} workspace={workspace} onWorkspace={setWorkspace} panelLayout={panelLayout}
        mixerOpen={mixerOpen} onMixerOpen={changeMixerOpen} />

      <div className="studio-grid" style={{
        "--studio-nav-width": panelLayout.navigationVisible ? `${panelLayout.navigationWidth}px` : "0px",
        "--studio-inspector-width": panelLayout.inspectorVisible ? `${panelLayout.layout.inspectorWidth}px` : "0px"
      } as React.CSSProperties}>
        <StudioSidebar project={builtinView} panelLayout={panelLayout} workspace={workspace} onWorkspace={setWorkspace}
          activeClip={activeClip} onActiveClip={setActiveClip} mixerOpen={mixerOpen} onMixerOpen={changeMixerOpen}
          newInstrument={newInstrument} onNewInstrument={setNewInstrument}
          onAddInstrument={(deviceType) => void addInstrument(deviceType)} addDisabled={!hydrated}
          onOpenPreview={() => { stop(); setWorkspace("adaptive"); }} />

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
      {conflictBanners}

      <div id="arrangement-view" role="tabpanel" aria-labelledby="arrangement-view-tab" hidden={Boolean(activeClip)}>
      {timeline(setActiveClip)}
      </div>

      <div id="midi-view" role="tabpanel" aria-labelledby="midi-view-tab" hidden={!activeClip}>
      {pianoRoll()}
      </div>
      </>}

      {workspaces}
      {workspace === "devices" && <DevicesWorkspace tracks={project.tracks} {...deviceControls} onClose={toArrangement} />}
        </section>

        {inspector}
      </div>
      {mixerOpen && <MixerDrawer project={builtinView} engine={engine} storageStatus={storageStatus}
        height={panelLayout.mixerHeight} maxHeight={panelLayout.mixerMax} onResize={(mixerHeight) => panelLayout.update({ mixerHeight })}
        syncLabel={syncLabel} onExecute={executeV1} onExport={() => { changeMixerOpen(false); setWorkspace("render"); }} onClose={() => changeMixerOpen(false)} />}
    </main>
  );
}

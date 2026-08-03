"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import {
  CommandTransaction,
  SetTrackPanCommand,
  SetTrackVolumeCommand,
  commitTransaction,
  type StudioCommand
} from "@synaptix/command-system";
import { BrowserAudioEngine } from "@synaptix/daw-engine";
import {
  createEmptyProject,
  type Clip,
  type MusicProject,
  type Track
} from "@synaptix/project-model";
import {
  IndexedDbProjectStorage,
  LocalProjectRepository
} from "@synaptix/project-storage";

const TRACK_NAMES = ["Drums", "Bass", "Harmony", "Lead Melody"] as const;
const TOTAL_BARS = 16;
const PPQ = 960;
const TICKS_PER_BAR = PPQ * 4;

function midiClip(id: string, name: string, pitches: readonly number[]): Clip {
  const notes = Array.from({ length: TOTAL_BARS }, (_, bar) =>
    pitches.map((pitch, step) => ({
      id: `${id}-note-${bar}-${step}`,
      pitch,
      velocity: step === 0 ? 108 : 88,
      startTick: bar * TICKS_PER_BAR + step * PPQ,
      durationTicks: Math.max(PPQ / 2, PPQ - 80)
    }))
  ).flat();

  return {
    id,
    kind: "midi",
    name,
    range: {
      start: { bar: 0, beat: 0, tick: 0 },
      durationTicks: TOTAL_BARS * TICKS_PER_BAR
    },
    loop: true,
    notes
  };
}

function createStarterProject(projectId: string): MusicProject {
  const project = createEmptyProject(projectId, { name: "Synaptix Generated Arrangement" });
  const patterns = [
    [36, 42, 38, 42],
    [38, 38, 41, 43],
    [50, 53, 57, 53],
    [62, 65, 69, 67]
  ] as const;

  project.transport.loopRange = {
    start: { bar: 0, beat: 0, tick: 0 },
    durationTicks: TOTAL_BARS * TICKS_PER_BAR
  };
  project.tracks = TRACK_NAMES.map<Track>((name, index) => ({
    id: `track-${index + 1}`,
    name,
    kind: "instrument",
    muted: false,
    solo: false,
    volumeDb: index === 0 ? -5 : -8,
    pan: index === 1 ? -0.15 : index === 3 ? 0.15 : 0,
    devices: [
      {
        id: `device-${index + 1}`,
        deviceType: index === 0 ? "synaptix-drum-synth" : "synaptix-poly-synth",
        deviceVersion: "1.0.0",
        enabled: true,
        parameters: []
      }
    ],
    clips: [midiClip(`clip-${index + 1}`, `${name} Generated Loop`, patterns[index])]
  }));
  project.markers = [
    { id: "section-intro", name: "Intro", position: { bar: 0, beat: 0, tick: 0 }, kind: "section" },
    { id: "section-main", name: "Main", position: { bar: 4, beat: 0, tick: 0 }, kind: "section" },
    { id: "section-tension", name: "Tension", position: { bar: 12, beat: 0, tick: 0 }, kind: "section" }
  ];
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

export default function StudioClient({ projectId }: { projectId: string }) {
  const [project, setProject] = useState(() => createStarterProject(projectId));
  const [playing, setPlaying] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [storageStatus, setStorageStatus] = useState("Loading local project…");
  const [hydrated, setHydrated] = useState(false);
  const engine = useMemo(() => new BrowserAudioEngine(), []);
  const repositoryRef = useRef<LocalProjectRepository | null>(null);

  useEffect(() => {
    let cancelled = false;
    const repository = new LocalProjectRepository(new IndexedDbProjectStorage());
    repositoryRef.current = repository;

    void repository
      .load(projectId)
      .then((stored) => {
        if (cancelled) return;
        if (stored) {
          setProject(stored);
          setLoopEnabled(stored.transport.loopEnabled);
          setStorageStatus("Recovered from IndexedDB");
        } else {
          setStorageStatus("New local project");
        }
        setHydrated(true);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setStorageStatus(error instanceof Error ? error.message : "Local storage unavailable");
        setHydrated(true);
      });

    return () => {
      cancelled = true;
    };
  }, [projectId]);

  useEffect(() => {
    engine.loadProject(project);
  }, [engine, project]);

  useEffect(() => {
    if (!hydrated || !repositoryRef.current) return;
    setStorageStatus("Saving…");
    const timeout = window.setTimeout(() => {
      void repositoryRef.current
        ?.save(project)
        .then(() => setStorageStatus("Saved locally"))
        .catch((error: unknown) =>
          setStorageStatus(error instanceof Error ? error.message : "Autosave failed")
        );
    }, 500);
    return () => window.clearTimeout(timeout);
  }, [hydrated, project]);

  useEffect(() => () => engine.dispose(), [engine]);

  async function play(): Promise<void> {
    await engine.play();
    setPlaying(true);
  }

  function pause(): void {
    engine.pause();
    setPlaying(false);
  }

  function stop(): void {
    engine.stop();
    setPlaying(false);
  }

  function toggleTrack(trackId: string, field: "muted" | "solo"): void {
    setProject((current) => ({
      ...current,
      tracks: current.tracks.map((track) =>
        track.id === trackId ? { ...track, [field]: !track[field] } : track
      )
    }));
  }

  async function commitMixerCommand(command: StudioCommand): Promise<void> {
    const transaction = new CommandTransaction([command]);
    const result = await commitTransaction(project, transaction);
    setProject(result.project);
    await repositoryRef.current?.save(result.project, result.revision);
    setStorageStatus("Revision saved locally");
  }

  function toggleLoop(): void {
    const next = !loopEnabled;
    engine.setLoop(next);
    setLoopEnabled(next);
    setProject((current) => ({
      ...current,
      transport: { ...current.transport, loopEnabled: next }
    }));
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", background: "#111318", color: "#f4f5f7", minHeight: "100vh" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0 }}>{project.metadata.name}</h1>
          <small>
            Project {project.projectId} · {project.tempoMap[0]?.bpm ?? 120} BPM · {storageStatus}
          </small>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={playing ? pause : play}>{playing ? "Pause" : "Play"}</button>
          <button onClick={stop}>Stop</button>
          <button onClick={toggleLoop}>Loop: {loopEnabled ? "On" : "Off"}</button>
        </div>
      </header>

      <section aria-label="Arrangement timeline" style={{ border: "1px solid #343943", borderRadius: 8, overflow: "auto" }}>
        <div style={{ minWidth: 1120 }}>
          <div style={{ display: "grid", gridTemplateColumns: "260px repeat(16, minmax(48px, 1fr))", background: "#1a1e26", borderBottom: "1px solid #343943" }}>
            <div style={{ padding: 10 }}>Tracks and mixer</div>
            {Array.from({ length: TOTAL_BARS }, (_, index) => (
              <div key={index} style={{ padding: 10, borderLeft: "1px solid #2a2f38", textAlign: "center" }}>{index + 1}</div>
            ))}
          </div>

          {project.tracks.map((track) => (
            <div key={track.id} style={{ display: "grid", gridTemplateColumns: "260px 1fr", minHeight: 96, borderBottom: "1px solid #2a2f38" }}>
              <div style={{ padding: 12, background: "#1a1e26", display: "grid", gap: 8 }}>
                <strong>{track.name}</strong>
                <div style={{ display: "flex", gap: 6 }}>
                  <button onClick={() => toggleTrack(track.id, "muted")}>M {track.muted ? "On" : "Off"}</button>
                  <button onClick={() => toggleTrack(track.id, "solo")}>S {track.solo ? "On" : "Off"}</button>
                </div>
                <label style={{ display: "grid", gridTemplateColumns: "54px 1fr 42px", gap: 6, fontSize: 12 }}>
                  Volume
                  <input
                    type="range"
                    min={-36}
                    max={6}
                    step={1}
                    value={track.volumeDb}
                    onChange={(event) =>
                      void commitMixerCommand(
                        new SetTrackVolumeCommand(track.id, Number(event.target.value))
                      )
                    }
                  />
                  <span>{track.volumeDb} dB</span>
                </label>
                <label style={{ display: "grid", gridTemplateColumns: "54px 1fr 42px", gap: 6, fontSize: 12 }}>
                  Pan
                  <input
                    type="range"
                    min={-1}
                    max={1}
                    step={0.1}
                    value={track.pan}
                    onChange={(event) =>
                      void commitMixerCommand(new SetTrackPanCommand(track.id, Number(event.target.value)))
                    }
                  />
                  <span>{track.pan.toFixed(1)}</span>
                </label>
              </div>
              <div style={{ position: "relative", minHeight: 96, backgroundImage: "repeating-linear-gradient(to right, transparent 0, transparent calc(6.25% - 1px), #252a33 calc(6.25% - 1px), #252a33 6.25%)" }}>
                {track.clips.map((clip) => (
                  <div key={clip.id} style={clipStyle(clip, project)}>
                    <strong>{clip.name}</strong>
                    <div style={{ fontSize: 12, opacity: 0.8 }}>
                      {clip.kind === "midi" ? `${clip.notes.length} MIDI notes` : "Audio clip"}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </section>
    </main>
  );
}

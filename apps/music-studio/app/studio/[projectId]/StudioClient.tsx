"use client";

import { useEffect, useMemo, useState } from "react";

import { BrowserAudioEngine } from "@synaptix/daw-engine";
import { createEmptyProject, type MusicProject, type Track } from "@synaptix/project-model";

const TRACK_NAMES = ["Drums", "Bass", "Harmony", "Lead Melody"] as const;

function createStarterProject(projectId: string): MusicProject {
  const project = createEmptyProject(projectId, { name: "Synaptix Arrangement" });
  project.tracks = TRACK_NAMES.map<Track>((name, index) => ({
    id: `track-${index + 1}`,
    name,
    kind: "instrument",
    muted: false,
    solo: false,
    volumeDb: 0,
    pan: 0,
    devices: [],
    clips: []
  }));
  return project;
}

export default function StudioClient({ projectId }: { projectId: string }) {
  const [project, setProject] = useState(() => createStarterProject(projectId));
  const [playing, setPlaying] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const engine = useMemo(() => new BrowserAudioEngine(), []);

  useEffect(() => {
    engine.loadProject(project);
  }, [engine, project]);

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

  function toggleLoop(): void {
    const next = !loopEnabled;
    engine.setLoop(next);
    setLoopEnabled(next);
  }

  return (
    <main style={{ padding: 24, fontFamily: "system-ui", background: "#111318", color: "#f4f5f7", minHeight: "100vh" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 20 }}>
        <div>
          <h1 style={{ margin: 0 }}>{project.metadata.name}</h1>
          <small>Project {project.projectId} · {project.tempoMap[0]?.bpm ?? 120} BPM</small>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button onClick={playing ? pause : play}>{playing ? "Pause" : "Play"}</button>
          <button onClick={stop}>Stop</button>
          <button onClick={toggleLoop}>Loop: {loopEnabled ? "On" : "Off"}</button>
        </div>
      </header>

      <section aria-label="Arrangement timeline" style={{ border: "1px solid #343943", borderRadius: 8, overflow: "hidden" }}>
        <div style={{ display: "grid", gridTemplateColumns: "180px repeat(16, minmax(48px, 1fr))", background: "#1a1e26", borderBottom: "1px solid #343943" }}>
          <div style={{ padding: 10 }}>Tracks</div>
          {Array.from({ length: 16 }, (_, index) => (
            <div key={index} style={{ padding: 10, borderLeft: "1px solid #2a2f38", textAlign: "center" }}>{index + 1}</div>
          ))}
        </div>

        {project.tracks.map((track) => (
          <div key={track.id} style={{ display: "grid", gridTemplateColumns: "180px 1fr", minHeight: 72, borderBottom: "1px solid #2a2f38" }}>
            <div style={{ padding: 12, background: "#1a1e26", display: "grid", gap: 8 }}>
              <strong>{track.name}</strong>
              <div style={{ display: "flex", gap: 6 }}>
                <button onClick={() => toggleTrack(track.id, "muted")}>M {track.muted ? "On" : "Off"}</button>
                <button onClick={() => toggleTrack(track.id, "solo")}>S {track.solo ? "On" : "Off"}</button>
              </div>
            </div>
            <div style={{ position: "relative", backgroundImage: "repeating-linear-gradient(to right, transparent 0, transparent calc(6.25% - 1px), #252a33 calc(6.25% - 1px), #252a33 6.25%)" }}>
              <div style={{ margin: 12, height: 48, border: "1px dashed #555d6b", borderRadius: 6, display: "grid", placeItems: "center", color: "#8f98a8" }}>
                Empty lane — generated MIDI clips will appear here
              </div>
            </div>
          </div>
        ))}
      </section>
    </main>
  );
}

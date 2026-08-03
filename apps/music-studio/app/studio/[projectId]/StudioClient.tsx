"use client";
import { useMemo } from "react";
import { createEmptyProject } from "@synaptix/project-model";
import { BrowserAudioEngine } from "@synaptix/daw-engine";
export default function StudioClient({ projectId }: { projectId: string }) {
  const project = useMemo(() => createEmptyProject(projectId), [projectId]);
  const engine = useMemo(() => new BrowserAudioEngine(), []);
  return <main><h1>{project.metadata.name}</h1><button onClick={() => engine.play()}>Play</button><button onClick={() => engine.pause()}>Pause</button></main>;
}

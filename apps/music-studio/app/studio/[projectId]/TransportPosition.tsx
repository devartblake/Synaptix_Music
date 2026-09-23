"use client";

import type { AudioTransport } from "@synaptix/daw-engine";
import type { Clip, MusicProject } from "@synaptix/project-model";
import { useTransport } from "../../../lib/editor/use-transport";
import { clipPlaybackTick, transportLabel } from "../../../lib/editor/timeline-model";
import styles from "./editing.module.css";

export function TransportPosition({
  engine,
  project
}: {
  engine: AudioTransport;
  project: MusicProject;
}) {
  const snapshot = useTransport(engine);
  return (
    <span
      className={styles.position}
      aria-label="Playback position"
      data-tick={Math.floor(snapshot.positionTicks)}
    >
      {transportLabel(project, snapshot.positionTicks)}
    </span>
  );
}

export function Playhead({
  engine,
  project,
  duration,
  clip
}: {
  engine: AudioTransport;
  project: MusicProject;
  duration: number;
  clip?: Clip;
}) {
  const snapshot = useTransport(engine);
  const tick = clip
    ? clipPlaybackTick(project, clip, snapshot.positionTicks)
    : snapshot.positionTicks;
  if (tick === null || tick < 0 || tick >= duration) return null;
  return (
    <div
      className={styles.playhead}
      aria-hidden="true"
      data-playhead-tick={Math.floor(tick)}
      style={{ left: `${(tick / duration) * 100}%` }}
    />
  );
}

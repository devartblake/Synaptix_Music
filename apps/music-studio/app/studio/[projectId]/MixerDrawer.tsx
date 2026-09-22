"use client";

import { Button } from "../../../components/ui/StudioControls";

import { useEffect, useRef, useState } from "react";
import {
  SetTrackMutedEditorCommand,
  SetTrackPanEditorCommand,
  SetTrackSoloEditorCommand,
  SetTrackVolumeEditorCommand,
  type EditorCommand
} from "@synaptix/command-system/editor";
import type { AudioTransport } from "@synaptix/daw-engine";
import type { MusicProject } from "@synaptix/project-model";
import { CommitSlider } from "../../../components/ui/CommitSlider";
import { ResizeHandle } from "../../../components/ui/ResizeHandle";
import { MasterMeter } from "./MasterMeter";
import styles from "./mixer.module.css";

export function MixerDrawer({
  project,
  engine,
  storageStatus,
  syncLabel,
  height,
  maxHeight,
  onResize,
  onExecute,
  onClose
}: {
  project: MusicProject;
  engine: AudioTransport;
  storageStatus: string;
  syncLabel: string;
  height: number;
  maxHeight: number;
  onResize: (height: number) => void;
  onExecute: (command: EditorCommand) => Promise<void>;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);

  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
  }, []);

  async function execute(command: EditorCommand) {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError(null);
    try {
      await onExecute(command);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "The mixer change could not be saved.");
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <section
      id="studio-mixer"
      className={styles.drawer}
      aria-labelledby="mixer-heading"
      style={{ height }}
    >
      <ResizeHandle
        label="Mixer height"
        controls="studio-mixer"
        orientation="horizontal"
        value={height}
        min={180}
        max={maxHeight}
        direction={-1}
        onChange={onResize}
      />
      <header className={styles.header}>
        <div>
          <h2 id="mixer-heading" ref={heading} tabIndex={-1}>
            Mixer
          </h2>
          <p>Track controls · Master output</p>
        </div>
        <p className={styles.saveStatus} role="status">
          {pending ? "Saving mixer change…" : storageStatus}
        </p>
        <Button onClick={onClose} aria-label="Close mixer">
          Close
        </Button>
      </header>
      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}
      <div className={styles.channels} tabIndex={0} aria-label="Mixer channels">
        {project.tracks.map((track, index) => (
          <section key={track.id} className={styles.channel} aria-label={`${track.name} channel`}>
            <h3>
              <span>{String(index + 1).padStart(2, "0")}</span>
              {track.name}
            </h3>
            <div className={styles.switches}>
              <Button
                disabled={pending}
                aria-label={`Mute ${track.name}`}
                aria-pressed={track.muted}
                onClick={() =>
                  void execute(new SetTrackMutedEditorCommand(track.id, track.muted, !track.muted))
                }
              >
                Mute
              </Button>
              <Button
                disabled={pending}
                aria-label={`Solo ${track.name}`}
                aria-pressed={track.solo}
                onClick={() =>
                  void execute(new SetTrackSoloEditorCommand(track.id, track.solo, !track.solo))
                }
              >
                Solo
              </Button>
            </div>
            <CommitSlider
              label={`${track.name} volume`}
              value={track.volumeDb}
              min={-36}
              max={6}
              step={1}
              format={(value) => `${value} dB`}
              disabled={pending}
              onCommit={(value) =>
                execute(new SetTrackVolumeEditorCommand(track.id, track.volumeDb, value))
              }
            />
            <CommitSlider
              label={`${track.name} pan`}
              value={track.pan}
              min={-1}
              max={1}
              step={0.1}
              format={(value) =>
                value === 0
                  ? "Center"
                  : `${Math.round(Math.abs(value) * 100)}% ${value < 0 ? "L" : "R"}`
              }
              disabled={pending}
              onCommit={(value) =>
                execute(new SetTrackPanEditorCommand(track.id, track.pan, value))
              }
            />
          </section>
        ))}
        <section className={styles.master} aria-label="Master channel">
          <MasterMeter engine={engine} />
          <p>Live peak, RMS, and clipping</p>
          <dl>
            <div>
              <dt>Tracks</dt>
              <dd>{project.tracks.length}</dd>
            </div>
            <div>
              <dt>Sync</dt>
              <dd>{syncLabel}</dd>
            </div>
          </dl>
        </section>
      </div>
    </section>
  );
}

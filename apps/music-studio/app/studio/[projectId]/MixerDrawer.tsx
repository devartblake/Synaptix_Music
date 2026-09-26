"use client";

import { Button } from "../../../components/ui/StudioControls";

import { useEffect, useRef, useState } from "react";
import {
  SetTrackMutedEditorCommand,
  SetTrackPanEditorCommand,
  SetTrackSoloEditorCommand,
  SetTrackVolumeEditorCommand,
  SetTrackOutputEditorCommand,
  SetTrackSendEditorCommand,
  SetMixerChannelEditorCommand,
  type EditorCommand
} from "@synaptix/command-system/editor";
import { resolveTrackOutput, resolveTrackSend, type AudioTransport } from "@synaptix/daw-engine";
import { defaultMixer, type MusicProject } from "@synaptix/project-model";
import { ChannelMeter, ChannelMeters } from "./ChannelMeters";
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
  onExport,
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
  onExport: () => void;
  onClose: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busy = useRef(false);
  const heading = useRef<HTMLHeadingElement>(null);
  const mixer = project.mixer ?? defaultMixer();

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
      <ChannelMeters engine={engine}>
        <div className={styles.channels} tabIndex={0} aria-label="Mixer channels">
          {project.tracks
            .filter((track) => track.kind === "instrument")
            .map((track, index) => (
              <section
                key={track.id}
                className={styles.channel}
                aria-label={`${track.name} channel`}
              >
                <h3>
                  <span>{String(index + 1).padStart(2, "0")}</span>
                  {track.name}
                </h3>
                <ChannelMeter id={`track:${track.id}`} name={track.name} />
                <div className={styles.switches}>
                  <Button
                    disabled={pending}
                    aria-label={`Mute ${track.name}`}
                    aria-pressed={track.muted}
                    onClick={() =>
                      void execute(
                        new SetTrackMutedEditorCommand(track.id, track.muted, !track.muted)
                      )
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
                <label className={styles.routing}>
                  {track.name} output
                  <select
                    disabled={pending}
                    value={track.outputBusId ?? "auto"}
                    onChange={(event) =>
                      void execute(
                        new SetTrackOutputEditorCommand(
                          track.id,
                          track.outputBusId,
                          event.target.value === "auto" ? undefined : event.target.value
                        )
                      )
                    }
                  >
                    <option value="auto">
                      Auto ({resolveTrackOutput({ ...track, outputBusId: undefined })})
                    </option>
                    <option value="music">Music bus</option>
                    <option value="drums">Drums bus</option>
                    <option value="master">Master direct</option>
                  </select>
                </label>
                <CommitSlider
                  label={`${track.name} reverb send`}
                  value={resolveTrackSend(track)}
                  min={0}
                  max={1}
                  step={0.01}
                  format={(value) => `${Math.round(value * 100)}%`}
                  disabled={pending}
                  onCommit={(value) =>
                    execute(new SetTrackSendEditorCommand(track.id, track.reverbSend, value))
                  }
                />
                <p className={styles.routePath}>
                  {track.name} → {resolveTrackOutput(track)} → Output
                  <br />
                  Post-fader send → Reverb → Output
                </p>
              </section>
            ))}
          {(["music", "drums", "reverb"] as const).map((id) => {
            const name =
              id === "reverb" ? "Reverb return" : `${id === "music" ? "Music" : "Drums"} bus`;
            return (
              <section key={id} className={styles.channel} aria-label={`${name} channel`}>
                <h3>{name}</h3>
                <ChannelMeter id={`bus:${id}`} name={name} />
                <Button
                  disabled={pending}
                  aria-label={`Mute ${name}`}
                  aria-pressed={mixer[id].muted}
                  onClick={() =>
                    void execute(
                      new SetMixerChannelEditorCommand(id, {
                        ...mixer[id],
                        muted: !mixer[id].muted
                      })
                    )
                  }
                >
                  Mute
                </Button>
                <CommitSlider
                  label={`${name} volume`}
                  value={mixer[id].volumeDb}
                  min={-60}
                  max={12}
                  step={1}
                  format={(value) => `${value} dB`}
                  disabled={pending}
                  onCommit={(value) =>
                    execute(new SetMixerChannelEditorCommand(id, { ...mixer[id], volumeDb: value }))
                  }
                />
                <p className={styles.routePath}>{name} → Compressor → Master</p>
              </section>
            );
          })}
          <section className={styles.master} aria-label="Master channel">
            <MasterMeter engine={engine} />
            <p>Live peak, RMS, and clipping</p>
            <Button
              disabled={pending}
              aria-label="Mute Master"
              aria-pressed={mixer.master.muted}
              onClick={() =>
                void execute(
                  new SetMixerChannelEditorCommand("master", {
                    ...mixer.master,
                    muted: !mixer.master.muted
                  })
                )
              }
            >
              Mute
            </Button>
            <CommitSlider
              label="Master volume"
              value={mixer.master.volumeDb}
              min={-60}
              max={12}
              step={1}
              format={(value) => `${value} dB`}
              disabled={pending}
              onCommit={(value) =>
                execute(
                  new SetMixerChannelEditorCommand("master", { ...mixer.master, volumeDb: value })
                )
              }
            />
            <Button onClick={onExport}>Render / export</Button>
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
      </ChannelMeters>
    </section>
  );
}

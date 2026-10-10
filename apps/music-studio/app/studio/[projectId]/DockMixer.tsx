"use client";

import { useState } from "react";
import {
  SetMixerChannelEditorCommand,
  SetTrackMutedEditorCommand,
  SetTrackOutputEditorCommand,
  SetTrackPanEditorCommand,
  SetTrackSendEditorCommand,
  SetTrackSoloEditorCommand,
  SetTrackVolumeEditorCommand,
  type EditorCommand
} from "@synaptix/command-system/editor";
import { primaryDevice, resolveInstrumentDefinition, resolveTrackOutput, resolveTrackSend, type AudioTransport } from "@synaptix/daw-engine";
import { defaultMixer, type MusicProject, type Track } from "@synaptix/project-model";

import { Button } from "../../../components/ui/StudioControls";
import { CommitSlider } from "../../../components/ui/CommitSlider";
import { Knob } from "../../../components/ui/Knob";
import { ChannelMeters, TrackLevel } from "./ChannelMeters";
import { MasterMeter } from "./MasterMeter";

// The DAW dock's Mixer tab (Studio UI v2, step 6): FL Studio / Live style channel strips with
// vertical faders and meters. The edits are the same commands the classic mixer drawer sends.

const BUSES = [
  { id: "music", name: "Music bus" },
  { id: "drums", name: "Drums bus" },
  { id: "reverb", name: "Reverb return" }
] as const;
const panText = (value: number) => value === 0 ? "C" : `${Math.round(Math.abs(value) * 100)}${value < 0 ? "L" : "R"}`;

export function DockMixer({ project, engine, trackColor, pluginNames, selectedTrackId, onExecute, onOpenDevices }: {
  project: MusicProject;
  engine: AudioTransport;
  trackColor: (track: Track) => string;
  /** Plug-in insert names per track (built-in devices come from the project). */
  pluginNames: (trackId: string) => string[];
  selectedTrackId: string | null;
  onExecute: (command: EditorCommand) => Promise<void>;
  /** Opens the Devices tab on a track (an insert slot was chosen). */
  onOpenDevices: (trackId: string) => void;
}) {
  const mixer = project.mixer ?? defaultMixer();
  const [error, setError] = useState<string | null>(null);
  const execute = async (command: EditorCommand) => {
    setError(null);
    try { await onExecute(command); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "The mixer change could not be saved."); }
  };
  const tracks = project.tracks.filter((track) => track.kind === "instrument");

  return (
    <ChannelMeters engine={engine}>
      {error && <p role="alert" className="mixer-error">{error}</p>}
      <div className="dock-mixer" role="group" aria-label="Mixer channels">
        {tracks.map((track) => {
          const device = primaryDevice(track) ?? track.devices[0];
          const instrument = device ? resolveInstrumentDefinition(device.deviceType, track.name).label : null;
          const inserts = [...(instrument ? [instrument] : []), ...pluginNames(track.id)];
          return (
            <section key={track.id} className="strip" aria-label={`${track.name} channel`}
              data-selected={track.id === selectedTrackId || undefined} style={{ "--strip-color": trackColor(track) } as React.CSSProperties}>
              <h3 className="strip-name" title={track.name}>{track.name}</h3>
              <ul className="strip-inserts" aria-label={`${track.name} insert slots`}>
                {inserts.map((name, index) => (
                  <li key={`${name}-${index}`}><button type="button" onClick={() => onOpenDevices(track.id)} title="Open in the Devices tab">{name}</button></li>
                ))}
                <li><button type="button" className="strip-insert-add" onClick={() => onOpenDevices(track.id)} aria-label={`Add an insert to ${track.name}`}>+ insert</button></li>
              </ul>
              <div className="strip-knobs">
                <Knob label="Pan" value={track.pan} min={-1} max={1} step={0.05} defaultValue={0} disabled={false}
                  format={panText} onCommit={(value) => execute(new SetTrackPanEditorCommand(track.id, track.pan, value))} />
                <Knob label="Send" value={resolveTrackSend(track)} min={0} max={1} step={0.01} defaultValue={resolveTrackSend({ ...track, reverbSend: undefined })}
                  disabled={false} format={(value) => `${Math.round(value * 100)}%`}
                  onCommit={(value) => execute(new SetTrackSendEditorCommand(track.id, track.reverbSend, value))} />
              </div>
              <div className="strip-fader">
                <CommitSlider disabled={false} label={`${track.name} volume`} value={track.volumeDb} min={-36} max={6} step={1}
                  format={(value) => `${value} dB`}
                  onCommit={(value) => execute(new SetTrackVolumeEditorCommand(track.id, track.volumeDb, value))} />
                <TrackLevel id={`track:${track.id}`} name={track.name} className="strip-meter" rms />
              </div>
              <div className="strip-switches">
                <Button aria-label={`Mute ${track.name}`} aria-pressed={track.muted}
                  onClick={() => void execute(new SetTrackMutedEditorCommand(track.id, track.muted, !track.muted))}>M</Button>
                <Button aria-label={`Solo ${track.name}`} aria-pressed={track.solo}
                  onClick={() => void execute(new SetTrackSoloEditorCommand(track.id, track.solo, !track.solo))}>S</Button>
              </div>
              <select className="strip-route" aria-label={`${track.name} output`} value={track.outputBusId ?? "auto"}
                onChange={(event) => void execute(new SetTrackOutputEditorCommand(track.id, track.outputBusId, event.target.value === "auto" ? undefined : event.target.value))}>
                <option value="auto">→ {resolveTrackOutput({ ...track, outputBusId: undefined })} (auto)</option>
                <option value="music">→ Music bus</option>
                <option value="drums">→ Drums bus</option>
                <option value="master">→ Master</option>
              </select>
            </section>
          );
        })}
        {BUSES.map(({ id, name }) => (
          <section key={id} className="strip strip-bus" aria-label={`${name} channel`}>
            <h3 className="strip-name">{name}</h3>
            <p className="strip-note">{id === "reverb" ? "Shared reverb" : "Compressor"}</p>
            <div className="strip-fader">
              <CommitSlider disabled={false} label={`${name} volume`} value={mixer[id].volumeDb} min={-60} max={12} step={1}
                format={(value) => `${value} dB`}
                onCommit={(value) => execute(new SetMixerChannelEditorCommand(id, { ...mixer[id], volumeDb: value }))} />
              <TrackLevel id={`bus:${id}`} name={name} className="strip-meter" rms />
            </div>
            <div className="strip-switches">
              <Button aria-label={`Mute ${name}`} aria-pressed={mixer[id].muted}
                onClick={() => void execute(new SetMixerChannelEditorCommand(id, { ...mixer[id], muted: !mixer[id].muted }))}>M</Button>
            </div>
            <p className="strip-note">→ Master</p>
          </section>
        ))}
        <section className="strip strip-master" aria-label="Master channel">
          <h3 className="strip-name">Master</h3>
          <MasterMeter engine={engine} />
          <div className="strip-fader">
            <CommitSlider disabled={false} label="Master volume" value={mixer.master.volumeDb} min={-60} max={12} step={1}
              format={(value) => `${value} dB`}
              onCommit={(value) => execute(new SetMixerChannelEditorCommand("master", { ...mixer.master, volumeDb: value }))} />
          </div>
          <div className="strip-switches">
            <Button aria-label="Mute Master" aria-pressed={mixer.master.muted}
              onClick={() => void execute(new SetMixerChannelEditorCommand("master", { ...mixer.master, muted: !mixer.master.muted }))}>M</Button>
          </div>
        </section>
      </div>
    </ChannelMeters>
  );
}

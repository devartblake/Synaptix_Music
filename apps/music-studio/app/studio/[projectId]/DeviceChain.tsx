"use client";

import type { ReactNode } from "react";
import { SetDeviceEnabledEditorCommand, SetDeviceParameterEditorCommand } from "@synaptix/command-system/device";
import { SetTrackSendEditorCommand } from "@synaptix/command-system/editor";
import { liftEditorCommandToV2, type PluginEditorCommand } from "@synaptix/command-system/plugin";
import {
  DEVICE_PARAMETER_DEFINITIONS,
  FREQUENCY_DRONE_DEVICE_TYPE,
  primaryDevice,
  resolveEffectiveInstrumentSettings,
  resolveFrequencyDroneDevice,
  resolveInstrumentDefinition,
  REVERB_SEND_PARAMETER,
  type DeviceParameterDefinition
} from "@synaptix/daw-engine";
import type { Track } from "@synaptix/project-model";

import { Button } from "../../../components/ui/StudioControls";
import { Knob } from "../../../components/ui/Knob";
import {
  DRONE_SETTINGS_KEY,
  formatParameterValue,
  modulationInUse,
  PARAMETER_SETTINGS_KEY,
  parameterStep
} from "./DeviceControls";
import { InstrumentIcon } from "./InstrumentIcon";

// The DAW dock's Devices tab (Studio UI v2, step 5): one track's chain, left to right, as in
// Ableton Live's Device View. Every edit is the same command the classic sliders send.

const SECTIONS: { title: string; ids: string[]; foldable?: boolean }[] = [
  { title: "Filter", ids: ["filterFrequency", "filterResonance"] },
  { title: "Envelope", ids: ["envelopeAttack", "envelopeDecay", "envelopeSustain", "envelopeRelease"] },
  { title: "Modulation", ids: ["lfoRate", "vibratoCents", "lfoCutoffOctaves", "tremolo", "filterEnvOctaves", "filterEnvDecay"], foldable: true },
  { title: "Reverb send", ids: [REVERB_SEND_PARAMETER] }
];
const SHORT: Record<string, string> = {
  "Filter Frequency": "Cutoff", Resonance: "Reso", "Filter Envelope": "Env amt", "Filter Env Decay": "Env decay",
  "LFO Rate": "LFO rate", "LFO to Cutoff": "LFO→cut", "Reverb Send": "Send"
};

export function DeviceChain({ tracks, trackId, onTrack, hydrated, onExecute, modulationOpen, onModulationToggle, inserts }: {
  tracks: readonly Track[];
  trackId: string | null;
  onTrack: (trackId: string) => void;
  hydrated: boolean;
  onExecute: (command: PluginEditorCommand) => Promise<void>;
  /** Shared with the classic panel: per track, whether Modulation is unfolded (unset: when in use). */
  modulationOpen: Readonly<Record<string, boolean>>;
  onModulationToggle: (trackId: string, open: boolean) => void;
  /** Plug-in inserts for the track, after the built-in devices. */
  inserts?: (track: Track) => ReactNode;
}) {
  const withDevices = tracks.filter((candidate) => candidate.devices.length > 0);
  const track = withDevices.find((candidate) => candidate.id === trackId) ?? withDevices[0];
  if (!track) return <p className="studio-dock-empty">Add an instrument track to see its devices here.</p>;
  const device = primaryDevice(track) ?? track.devices[0]!;
  const isDrone = device.deviceType === FREQUENCY_DRONE_DEVICE_TYPE;
  const definition = isDrone ? null : resolveInstrumentDefinition(device.deviceType, track.name);
  const asIs = { ...track, devices: [{ ...device, enabled: true }] };
  const factory = { ...track, reverbSend: undefined, devices: [{ ...device, enabled: true, parameters: [] }] };
  const settings = isDrone ? resolveFrequencyDroneDevice(device) : resolveEffectiveInstrumentSettings(asIs);
  const defaults = isDrone ? resolveFrequencyDroneDevice({ ...device, parameters: [] }) : resolveEffectiveInstrumentSettings(factory);
  const read = (from: object, id: string) => (from as Record<string, number>)[(isDrone ? DRONE_SETTINGS_KEY[id] : PARAMETER_SETTINGS_KEY[id]) as string]!;

  const knob = (parameter: DeviceParameterDefinition) => (
    <Knob key={parameter.id} label={SHORT[parameter.label] ?? parameter.label} value={read(settings, parameter.id)}
      min={parameter.minimum} max={parameter.maximum} step={parameterStep(parameter)} defaultValue={read(defaults, parameter.id)}
      disabled={!hydrated} format={(next) => formatParameterValue(parameter.unit, next)}
      onCommit={(next) => onExecute(parameter.id === REVERB_SEND_PARAMETER
        ? liftEditorCommandToV2(new SetTrackSendEditorCommand(track.id, track.reverbSend, next))
        : new SetDeviceParameterEditorCommand(track.id, device.id, parameter.id, read(settings, parameter.id), next))} />
  );
  const byId = (id: string) => DEVICE_PARAMETER_DEFINITIONS.find((candidate) => candidate.id === id)!;
  const modulationUsed = !isDrone && modulationInUse(settings as ReturnType<typeof resolveEffectiveInstrumentSettings>);
  const modulationUnfolded = modulationOpen[track.id] ?? modulationUsed;

  return (
    <section className="device-chain" aria-label={`${track.name} devices`}>
      <label className="device-chain-track">
        Track{" "}
        <select value={track.id} onChange={(event) => onTrack(event.target.value)}>
          {withDevices.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select>
      </label>
      <div className="device-chain-row">
        <article className="device-card" aria-label={isDrone ? "Frequency Drone" : definition!.label}>
          <header>
            <span className="device-power" data-on={device.enabled} aria-hidden="true" />
            {definition && <InstrumentIcon kind={definition.profile.kind} deviceType={definition.deviceType} size={22} />}
            <strong>{isDrone ? "Frequency Drone" : definition!.label}</strong>
          </header>
          <div className="device-card-body">
            <Button aria-label={`${track.name} device enabled`} aria-pressed={device.enabled}
              onClick={() => void onExecute(new SetDeviceEnabledEditorCommand(track.id, device.id, device.enabled, !device.enabled))}>
              {device.enabled ? "On" : "Off"}
            </Button>
            {isDrone && DEVICE_PARAMETER_DEFINITIONS.filter((candidate) => candidate.id.startsWith("drone")).map(knob)}
          </div>
        </article>
        {!isDrone && SECTIONS.map((section) => {
          const folded = section.foldable && !modulationUnfolded;
          return (
            <article key={section.title} className="device-card" data-folded={folded || undefined} aria-label={section.title}>
              <header>
                {section.foldable ? (
                  <button type="button" className="device-fold" aria-expanded={!folded}
                    onClick={() => onModulationToggle(track.id, Boolean(folded))}>
                    <span aria-hidden="true">{folded ? "▸" : "▾"} </span>{section.title}{modulationUsed ? " · in use" : ""}
                  </button>
                ) : <strong>{section.title}</strong>}
              </header>
              {!folded && (
                <div className="device-card-body">
                  {section.title === "Envelope" && <EnvelopeGraph settings={settings as ReturnType<typeof resolveEffectiveInstrumentSettings>} />}
                  {section.ids.map((id) => knob(byId(id)))}
                </div>
              )}
            </article>
          );
        })}
        {inserts && <article className="device-card device-card-inserts" aria-label="Inserts">
          <header><strong>Inserts</strong></header>
          <div className="device-card-body">{inserts(track)}</div>
        </article>}
      </div>
    </section>
  );
}

/** A small ADSR drawing: attack, decay to the sustain level, a held stretch, then release. */
function EnvelopeGraph({ settings }: { settings: { attack: number; decay: number; sustain: number; release: number } }) {
  const total = settings.attack + settings.decay + 0.5 + settings.release;
  const x = (seconds: number) => 4 + (seconds / total) * 112;
  const top = 6;
  const bottom = 50;
  const sustainY = bottom - settings.sustain * (bottom - top);
  const path = `M ${x(0)} ${bottom} L ${x(settings.attack)} ${top} L ${x(settings.attack + settings.decay)} ${sustainY}`
    + ` L ${x(settings.attack + settings.decay + 0.5)} ${sustainY} L ${x(total)} ${bottom}`;
  return (
    <svg className="envelope-graph" viewBox="0 0 120 56" width="120" height="56" aria-hidden="true">
      <path d={`${path} Z`} className="envelope-fill" />
      <path d={path} className="envelope-line" />
    </svg>
  );
}

"use client";

import { SetDeviceEnabledEditorCommand, SetDeviceParameterEditorCommand } from "@synaptix/command-system/device";
import { SetTrackSendEditorCommand } from "@synaptix/command-system/editor";
import { liftEditorCommandToV2, type PluginEditorCommand } from "@synaptix/command-system/plugin";
import {
  DEVICE_PARAMETER_DEFINITIONS,
  type DeviceParameterUnit,
  FREQUENCY_DRONE_DEVICE_TYPE,
  resolveFrequencyDroneDevice,
  ENVELOPE_ATTACK_PARAMETER,
  ENVELOPE_DECAY_PARAMETER,
  ENVELOPE_RELEASE_PARAMETER,
  ENVELOPE_SUSTAIN_PARAMETER,
  FILTER_FREQUENCY_PARAMETER,
  FILTER_RESONANCE_PARAMETER,
  FILTER_ENV_AMOUNT_PARAMETER,
  FILTER_ENV_DECAY_PARAMETER,
  LFO_CUTOFF_PARAMETER,
  LFO_RATE_PARAMETER,
  TREMOLO_PARAMETER,
  VIBRATO_PARAMETER,
  primaryDevice,
  resolveEffectiveInstrumentSettings,
  resolveInstrumentDefinition,
  REVERB_SEND_PARAMETER
} from "@synaptix/daw-engine";
import type { Track } from "@synaptix/project-model";

import { Button } from "../../../components/ui/StudioControls";
import { CommitSlider } from "../../../components/ui/CommitSlider";
import { InstrumentIcon } from "./InstrumentIcon";

type NumericSettingsKey =
  | "filterFrequency" | "resonance" | "attack" | "decay" | "sustain" | "release" | "reverbSend"
  | "lfoRate" | "vibratoCents" | "lfoCutoffOctaves" | "tremolo" | "filterEnvOctaves" | "filterEnvDecay";

const PARAMETER_SETTINGS_KEY: Record<string, NumericSettingsKey> = {
  [FILTER_FREQUENCY_PARAMETER]: "filterFrequency",
  [FILTER_RESONANCE_PARAMETER]: "resonance",
  [LFO_RATE_PARAMETER]: "lfoRate",
  [VIBRATO_PARAMETER]: "vibratoCents",
  [LFO_CUTOFF_PARAMETER]: "lfoCutoffOctaves",
  [TREMOLO_PARAMETER]: "tremolo",
  [FILTER_ENV_AMOUNT_PARAMETER]: "filterEnvOctaves",
  [FILTER_ENV_DECAY_PARAMETER]: "filterEnvDecay",
  [ENVELOPE_ATTACK_PARAMETER]: "attack",
  [ENVELOPE_DECAY_PARAMETER]: "decay",
  [ENVELOPE_SUSTAIN_PARAMETER]: "sustain",
  [ENVELOPE_RELEASE_PARAMETER]: "release",
  [REVERB_SEND_PARAMETER]: "reverbSend"
};

// Shown in the device panel's collapsible Modulation section.
const MODULATION_PARAMETERS = new Set([
  FILTER_ENV_AMOUNT_PARAMETER, FILTER_ENV_DECAY_PARAMETER, LFO_RATE_PARAMETER,
  VIBRATO_PARAMETER, LFO_CUTOFF_PARAMETER, TREMOLO_PARAMETER
]);

/** Whether any modulation is audible: rates and decay times do nothing while every depth is 0. */
function modulationInUse(settings: Pick<Record<NumericSettingsKey, number>, "vibratoCents" | "lfoCutoffOctaves" | "tremolo" | "filterEnvOctaves">): boolean {
  return settings.vibratoCents > 0 || settings.lfoCutoffOctaves > 0 || settings.tremolo > 0 || settings.filterEnvOctaves !== 0;
}

function formatParameterValue(unit: DeviceParameterUnit, value: number): string {
  if (unit === "count") return String(Math.round(value));
  // Slow rates (an LFO) need their decimals; audio frequencies don't.
  if (unit === "hz") return value < 100 ? `${value.toFixed(2)} Hz` : `${Math.round(value)} Hz`;
  if (unit === "cents") return `${Math.round(value)} ct`;
  if (unit === "octaves") return `${value.toFixed(2)} oct`;
  if (unit === "seconds") return `${value.toFixed(3)} s`;
  return value.toFixed(2);
}

export interface DeviceControlsProps {
  track: Track;
  hydrated: boolean;
  onExecute: (command: PluginEditorCommand) => Promise<void>;
  /** Per track, whether its Modulation section is open (unset: open when it is in use). */
  modulationOpen: Readonly<Record<string, boolean>>;
  onModulationToggle: (trackId: string, open: boolean) => void;
}

/** The primary device's on/off switch and parameter sliders for one track. */
export function DeviceControls({ track, hydrated, onExecute, modulationOpen, onModulationToggle }: DeviceControlsProps) {
  const device = primaryDevice(track) ?? track.devices[0];
  if (!device) return null;
  const isDrone = device.deviceType === FREQUENCY_DRONE_DEVICE_TYPE;
  const settings = isDrone ? resolveFrequencyDroneDevice(device) : resolveEffectiveInstrumentSettings({ ...track, devices: [{ ...device, enabled: true }] });

  return (
    <div style={{ display: "grid", gap: 6, borderTop: "1px solid #2a2f38", paddingTop: 8, marginTop: 4 }}>
      <Button aria-label={`${track.name} device enabled`} aria-pressed={device.enabled} onClick={() => void onExecute(new SetDeviceEnabledEditorCommand(track.id, device.id, device.enabled, !device.enabled))}>
        Device {device.enabled ? "On" : "Off"}
      </Button>
      {(() => {
        const definitions = DEVICE_PARAMETER_DEFINITIONS.filter((definition) => isDrone ? definition.id.startsWith("drone") : !definition.id.startsWith("drone"));
        const renderSlider = (definition: (typeof definitions)[number]) => {
        const droneKeys: Record<string, keyof ReturnType<typeof resolveFrequencyDroneDevice>> = { droneFrequencyHz:"frequencyHz", droneGain:"gain", droneHarmonics:"harmonics", droneModulationRateHz:"modulationRateHz", droneModulationDepth:"modulationDepth", droneFilterHz:"filterHz", droneStereoOffsetHz:"stereoOffsetHz" };
        const value = isDrone ? settings[droneKeys[definition.id] as keyof typeof settings] as number : settings[PARAMETER_SETTINGS_KEY[definition.id] as keyof typeof settings] as number;
        const step = definition.unit === "count" || definition.unit === "cents" ? 1 : definition.unit === "hz" ? (definition.id === "droneFrequencyHz" ? 0.1 : definition.maximum <= 20 ? 0.05 : 10) : definition.unit === "ratio" || definition.unit === "octaves" ? 0.01 : 0.001;
        return (
          <CommitSlider key={definition.id} label={definition.label} value={value}
            min={definition.minimum} max={definition.maximum} step={step} disabled={!hydrated}
            format={(next) => formatParameterValue(definition.unit, next)}
            onCommit={(next) => onExecute(definition.id === REVERB_SEND_PARAMETER
              ? liftEditorCommandToV2(new SetTrackSendEditorCommand(track.id, track.reverbSend, next))
              : new SetDeviceParameterEditorCommand(track.id, device.id, definition.id, value, next))} />
        );
        };
        if (isDrone) return definitions.map(renderSlider);
        const modulation = definitions.filter((definition) => MODULATION_PARAMETERS.has(definition.id));
        const inUse = modulationInUse(settings as ReturnType<typeof resolveEffectiveInstrumentSettings>);
        return <>
          {definitions.filter((definition) => !MODULATION_PARAMETERS.has(definition.id)).map(renderSlider)}
          <details className="device-modulation" open={modulationOpen[track.id] ?? inUse}
            onToggle={(event) => onModulationToggle(track.id, event.currentTarget.open)}>
            <summary>Modulation{inUse && <span className="device-modulation-state"> · in use</span>}</summary>
            <div className="device-modulation-controls">{modulation.map(renderSlider)}</div>
          </details>
        </>;
      })()}
    </div>
  );
}

/** The Devices & effects workspace: every track's device controls on one page (also the v2 dock's Devices tab). */
export function DevicesWorkspace({ tracks, onClose, ...controls }: Omit<DeviceControlsProps, "track"> & {
  tracks: readonly Track[];
  /** Omitted in the dock, which has no page to go back from (and labels the panel itself). */
  onClose?: () => void;
}) {
  return <section aria-label="Devices and effects" className="device-workspace">{onClose && <><h2>Devices & effects</h2><p>Instrument → filter and envelope → track fader → output bus. Reverb sends feed the shared return in Mixer.</p><p>Use Tab to move between controls; arrow keys adjust values. Undo and redo use the project history.</p></>}{tracks.filter(track => track.devices.length > 0).map(track => <fieldset key={track.id}><legend>{track.name}</legend>{(() => { const type = (primaryDevice(track) ?? track.devices[0])?.deviceType ?? ""; if (type === FREQUENCY_DRONE_DEVICE_TYPE) return <p>Frequency Drone</p>; const definition = resolveInstrumentDefinition(type, track.name); return <p className="device-instrument"><InstrumentIcon kind={definition.profile.kind} deviceType={definition.deviceType} size={28} />{definition.label}</p>; })()}<DeviceControls track={track} {...controls} /></fieldset>)}{onClose && <Button onClick={onClose}>Back to arrangement</Button>}</section>;
}

"use client";

import { SetDeviceEnabledEditorCommand } from "@synaptix/command-system/device";
import {
  InsertPluginDeviceEditorCommand,
  RemovePluginDeviceEditorCommand,
  type PluginEditorCommand
} from "@synaptix/command-system/plugin";
import {
  createReferenceDriveDevice,
  FIRST_PARTY_AUDIO_WORKLET_MODULES,
  PluginCatalog,
  resolvePluginParameterValues,
  type PluginRuntimeStatus
} from "@synaptix/daw-engine";
import type { PluginParameterDescriptor } from "@synaptix/project-model/plugin";
import type { TrackV2 } from "@synaptix/project-model/v2";

import { Button } from "../../../components/ui/StudioControls";

const CATALOG = new PluginCatalog(FIRST_PARTY_AUDIO_WORKLET_MODULES.map((module) => module.descriptor));

export interface PluginParameterGestures {
  begin(trackId: string, deviceId: string, parameterId: string, initial: number): void;
  preview(trackId: string, deviceId: string, parameterId: string, value: number): void;
  end(trackId: string, deviceId: string, parameterId: string, next: number): void;
}

function formatValue(parameter: PluginParameterDescriptor, value: number): string {
  if (parameter.unit === "db") return `${value.toFixed(1)} dB`;
  if (parameter.unit === "hz") return `${Math.round(value)} Hz`;
  if (parameter.unit === "seconds") return `${value.toFixed(2)} s`;
  if (parameter.unit === "ratio") return `${Math.round(value * 100)}%`;
  return value.toFixed(1);
}

function statusLabel(status: PluginRuntimeStatus | undefined, enabled: boolean): string {
  if (!enabled) return "Bypassed";
  if (!status || status.availability.status === "loading") return "Loading";
  if (status.availability.status === "available") return "Active";
  if (status.availability.status === "inactive") return "Inactive";
  return "Unavailable";
}

export function PluginRack({ track, statuses, onExecute, gestures }: {
  track: TrackV2;
  statuses: readonly PluginRuntimeStatus[];
  onExecute(command: PluginEditorCommand): void;
  gestures: PluginParameterGestures;
}) {
  const inserts = track.devices.filter((device) => device.plugin.runtimeKind !== "builtin");

  return (
    <section aria-label={`${track.name} inserts`} style={{ display: "grid", gap: 6, borderTop: "1px solid #2a2f38", paddingTop: 8 }}>
      {inserts.map((device) => {
        const descriptor = CATALOG.descriptorFor(device.plugin);
        const name = descriptor?.name ?? device.plugin.pluginId;
        const status = statuses.find((candidate) => candidate.deviceId === device.id);
        const label = statusLabel(status, device.enabled);
        const unavailable = status?.availability.status === "unavailable" ? status.availability : null;
        const inactive = status?.availability.status === "inactive" ? status.availability : null;
        const values = descriptor ? resolvePluginParameterValues(device, descriptor) : null;

        return (
          <div key={device.id} style={{ display: "grid", gap: 4, fontSize: 12 }}>
            <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
              <strong style={{ flex: 1 }}>{name}</strong>
              <span title={unavailable?.message ?? inactive?.message}>{label}</span>
            </div>
            <div style={{ display: "flex", gap: 6 }}>
              <Button aria-pressed={!device.enabled} aria-label={`Bypass ${name} on ${track.name}`}
                onClick={() => onExecute(new SetDeviceEnabledEditorCommand(track.id, device.id, device.enabled, !device.enabled))}>
                {device.enabled ? "Bypass" : "Enable"}
              </Button>
              <Button aria-label={`Remove ${name} from ${track.name}`}
                onClick={() => onExecute(new RemovePluginDeviceEditorCommand(track.id, device.id))}>Remove</Button>
            </div>
            {unavailable && <p style={{ margin: 0, opacity: 0.8 }}>{unavailable.message} Its settings are kept in the project.</p>}
            {inactive && <p style={{ margin: 0, opacity: 0.8 }}>{inactive.message} Its settings are kept in the project.</p>}
            {descriptor && values && descriptor.parameters.map((parameter) => {
              const value = values.get(parameter.id) ?? parameter.defaultValue;
              const step = parameter.kind === "continuous" ? (parameter.maximum - parameter.minimum) / 200 : 1;
              return (
                <label key={parameter.id} style={{ display: "grid", gridTemplateColumns: "54px 1fr 54px", gap: 6 }}>
                  {parameter.label}
                  <input type="range" aria-label={`${track.name} ${name} ${parameter.label}`}
                    min={parameter.minimum} max={parameter.maximum} step={step} value={value}
                    onPointerDown={() => gestures.begin(track.id, device.id, parameter.id, value)}
                    onChange={(event) => gestures.preview(track.id, device.id, parameter.id, Number(event.target.value))}
                    onPointerUp={(event) => gestures.end(track.id, device.id, parameter.id, Number(event.currentTarget.value))}
                    onKeyUp={(event) => gestures.end(track.id, device.id, parameter.id, Number(event.currentTarget.value))}
                    onKeyDown={() => gestures.begin(track.id, device.id, parameter.id, value)} />
                  <span>{formatValue(parameter, value)}</span>
                </label>
              );
            })}
          </div>
        );
      })}
      {track.kind === "instrument" && <Button onClick={() => onExecute(new InsertPluginDeviceEditorCommand(
        track.id, createReferenceDriveDevice(`device-${crypto.randomUUID()}`), track.devices.length
      ))}>Add Reference Drive</Button>}
    </section>
  );
}

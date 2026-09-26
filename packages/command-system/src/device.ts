import type { EditorCommand, VersionedMusicProject } from "./editor.ts";

interface DeviceCommandOptions {
  id?: string;
}

function clone<P extends VersionedMusicProject>(project: P): P {
  return structuredClone(project);
}

function commandId(options: DeviceCommandOptions): string {
  return options.id ?? crypto.randomUUID();
}

function device(project: VersionedMusicProject, trackId: string, deviceId: string) {
  const track = (project.tracks as VersionedMusicProject["tracks"][number][]).find((candidate) => candidate.id === trackId);
  if (!track) throw new Error(`Track '${trackId}' was not found.`);
  const value = (track.devices as Array<{ id: string; enabled: boolean; parameters: Array<{ id: string; value: number }> }>)
    .find((candidate) => candidate.id === deviceId);
  if (!value) throw new Error(`Device '${deviceId}' was not found on track '${trackId}'.`);
  return value;
}

export class SetDeviceEnabledEditorCommand implements EditorCommand {
  readonly id: string;
  readonly kind = "set-device-enabled";

  constructor(
    readonly trackId: string,
    readonly deviceId: string,
    readonly previousValue: boolean,
    readonly nextValue: boolean,
    options: DeviceCommandOptions = {}
  ) {
    this.id = commandId(options);
  }

  execute<P extends VersionedMusicProject>(project: P): P {
    const next = clone(project);
    device(next, this.trackId, this.deviceId).enabled = this.nextValue;
    return next;
  }

  undo<P extends VersionedMusicProject>(project: P): P {
    const next = clone(project);
    device(next, this.trackId, this.deviceId).enabled = this.previousValue;
    return next;
  }
}

export class SetDeviceParameterEditorCommand implements EditorCommand {
  readonly id: string;
  readonly kind = "set-device-parameter";

  constructor(
    readonly trackId: string,
    readonly deviceId: string,
    readonly parameterId: string,
    readonly previousValue: number,
    readonly nextValue: number,
    options: DeviceCommandOptions = {}
  ) {
    if (!Number.isFinite(previousValue) || !Number.isFinite(nextValue)) {
      throw new Error("Device parameter values must be finite numbers.");
    }
    this.id = commandId(options);
  }

  private write<P extends VersionedMusicProject>(project: P, value: number): P {
    const next = clone(project);
    const target = device(next, this.trackId, this.deviceId);
    const parameter = target.parameters.find((candidate) => candidate.id === this.parameterId);
    if (parameter) parameter.value = value;
    else target.parameters.push({ id: this.parameterId, value });
    return next;
  }

  execute<P extends VersionedMusicProject>(project: P): P {
    return this.write(project, this.nextValue);
  }

  undo<P extends VersionedMusicProject>(project: P): P {
    return this.write(project, this.previousValue);
  }
}

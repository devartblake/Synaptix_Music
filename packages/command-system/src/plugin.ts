import { verifyPluginStateEnvelope } from "@synaptix/project-model/plugin";
import type {
  AutomationLane,
  AutomationPoint,
  DeviceV2,
  FrozenPluginArtifactReference,
  MusicProjectV2,
  PluginStateEnvelope
} from "@synaptix/project-model/v2";

import type { ProjectEditorCommand } from "./editor.ts";

/*
 * Plug-in editor commands (Plugin Runtime Foundation v1, R5).
 *
 * Continuous parameter gestures reuse SetDeviceParameterEditorCommand and
 * SetDeviceEnabledEditorCommand (bypass), which accept v2 projects. The commands below cover
 * the atomic operations that numeric parameter writes cannot express.
 */

export type PluginEditorCommand = ProjectEditorCommand<MusicProjectV2>;

interface PluginCommandOptions {
  id?: string;
}

function commandId(options: PluginCommandOptions): string {
  return options.id ?? crypto.randomUUID();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

function findTrack(project: MusicProjectV2, trackId: string) {
  const track = project.tracks.find((candidate) => candidate.id === trackId);
  if (!track) throw new Error(`Track '${trackId}' was not found.`);
  return track;
}

function findDevice(project: MusicProjectV2, trackId: string, deviceId: string): DeviceV2 {
  const device = findTrack(project, trackId).devices.find((candidate) => candidate.id === deviceId);
  if (!device) throw new Error(`Device '${deviceId}' was not found on track '${trackId}'.`);
  return device;
}

export class InsertPluginDeviceEditorCommand implements PluginEditorCommand {
  readonly id: string;
  readonly kind = "insert-plugin-device";
  readonly device: DeviceV2;

  constructor(
    readonly trackId: string,
    device: DeviceV2,
    readonly index: number,
    options: PluginCommandOptions = {}
  ) {
    if (!Number.isInteger(index) || index < 0) throw new RangeError("Device index must be a non-negative integer.");
    this.device = clone(device);
    this.id = commandId(options);
  }

  execute(project: MusicProjectV2): MusicProjectV2 {
    const next = clone(project);
    const track = findTrack(next, this.trackId);
    if (track.devices.some((candidate) => candidate.id === this.device.id)) {
      throw new Error(`Device '${this.device.id}' already exists on track '${this.trackId}'.`);
    }
    track.devices.splice(Math.min(this.index, track.devices.length), 0, clone(this.device));
    return next;
  }

  undo(project: MusicProjectV2): MusicProjectV2 {
    const next = clone(project);
    const track = findTrack(next, this.trackId);
    track.devices = track.devices.filter((candidate) => candidate.id !== this.device.id);
    return next;
  }
}

export class RemovePluginDeviceEditorCommand implements PluginEditorCommand {
  readonly id: string;
  readonly kind = "remove-plugin-device";
  private removed: { device: DeviceV2; index: number } | null = null;

  constructor(
    readonly trackId: string,
    readonly deviceId: string,
    options: PluginCommandOptions = {}
  ) {
    this.id = commandId(options);
  }

  execute(project: MusicProjectV2): MusicProjectV2 {
    const next = clone(project);
    const track = findTrack(next, this.trackId);
    const index = track.devices.findIndex((candidate) => candidate.id === this.deviceId);
    if (index < 0) throw new Error(`Device '${this.deviceId}' was not found on track '${this.trackId}'.`);
    this.removed = { device: clone(track.devices[index]!), index };
    track.devices.splice(index, 1);
    return next;
  }

  undo(project: MusicProjectV2): MusicProjectV2 {
    if (!this.removed) throw new Error("Cannot undo a device removal that has not been executed.");
    const next = clone(project);
    findTrack(next, this.trackId).devices.splice(this.removed.index, 0, clone(this.removed.device));
    return next;
  }
}

export interface PluginStateSnapshot {
  parameters: DeviceV2["parameters"];
  pluginState: PluginStateEnvelope | null;
}

/**
 * Atomically replaces a device's numeric parameters and opaque state (preset load,
 * state import). Use {@link ReplacePluginStateEditorCommand.create} so envelope checksums
 * are verified before the command can enter history.
 */
export class ReplacePluginStateEditorCommand implements PluginEditorCommand {
  readonly id: string;
  readonly kind = "replace-plugin-state";

  private constructor(
    readonly trackId: string,
    readonly deviceId: string,
    readonly previous: PluginStateSnapshot,
    readonly next: PluginStateSnapshot,
    options: PluginCommandOptions
  ) {
    this.id = commandId(options);
  }

  static async create(
    trackId: string,
    deviceId: string,
    previous: PluginStateSnapshot,
    next: PluginStateSnapshot,
    options: PluginCommandOptions = {}
  ): Promise<ReplacePluginStateEditorCommand> {
    for (const parameter of next.parameters) {
      if (!Number.isFinite(parameter.value)) throw new Error("Plug-in parameter values must be finite numbers.");
    }
    if (next.pluginState && !(await verifyPluginStateEnvelope(next.pluginState))) {
      throw new Error("Plug-in state checksum does not match its payload.");
    }
    return new ReplacePluginStateEditorCommand(trackId, deviceId, clone(previous), clone(next), options);
  }

  private write(project: MusicProjectV2, snapshot: PluginStateSnapshot): MusicProjectV2 {
    const next = clone(project);
    const device = findDevice(next, this.trackId, this.deviceId);
    device.parameters = clone(snapshot.parameters);
    device.pluginState = clone(snapshot.pluginState);
    return next;
  }

  execute(project: MusicProjectV2): MusicProjectV2 { return this.write(project, this.next); }
  undo(project: MusicProjectV2): MusicProjectV2 { return this.write(project, this.previous); }
}

/** Sort points by tick and keep the last point written for any duplicated tick. */
export function normalizeAutomationPoints(points: readonly AutomationPoint[]): AutomationPoint[] {
  const byTick = new Map<number, AutomationPoint>();
  for (const point of points) {
    if (!Number.isInteger(point.tick) || point.tick < 0) throw new RangeError("Automation ticks must be non-negative integers.");
    if (!Number.isFinite(point.value)) throw new Error("Automation values must be finite numbers.");
    byTick.set(point.tick, { ...point });
  }
  return [...byTick.values()].sort((left, right) => left.tick - right.tick);
}

/**
 * Replaces one parameter's automation lane as a single history entry. Editing a lane
 * (drawing, moving points) is one command; playback never writes commands.
 * Passing `null` as the next lane removes it.
 */
export class SetAutomationLaneEditorCommand implements PluginEditorCommand {
  readonly id: string;
  readonly kind = "set-automation-lane";
  readonly previousPoints: AutomationPoint[] | null;
  readonly nextPoints: AutomationPoint[] | null;

  constructor(
    readonly trackId: string,
    readonly deviceId: string,
    readonly parameterId: string,
    previousPoints: readonly AutomationPoint[] | null,
    nextPoints: readonly AutomationPoint[] | null,
    options: PluginCommandOptions = {}
  ) {
    this.previousPoints = previousPoints ? clone([...previousPoints]) : null;
    this.nextPoints = nextPoints ? normalizeAutomationPoints(nextPoints) : null;
    this.id = commandId(options);
  }

  private write(project: MusicProjectV2, points: AutomationPoint[] | null): MusicProjectV2 {
    const next = clone(project);
    const device = findDevice(next, this.trackId, this.deviceId);
    const lanes: AutomationLane[] = device.automation.filter((lane) => lane.parameterId !== this.parameterId);
    if (points) {
      const index = device.automation.findIndex((lane) => lane.parameterId === this.parameterId);
      const lane = { parameterId: this.parameterId, points: clone(points) };
      lanes.splice(index < 0 ? lanes.length : index, 0, lane);
    }
    device.automation = lanes;
    return next;
  }

  execute(project: MusicProjectV2): MusicProjectV2 { return this.write(project, this.nextPoints); }
  undo(project: MusicProjectV2): MusicProjectV2 { return this.write(project, this.previousPoints); }
}

/** Attaches, replaces, or clears (`null`) a device's frozen-artifact evidence. */
export class SetFrozenPluginArtifactEditorCommand implements PluginEditorCommand {
  readonly id: string;
  readonly kind = "set-frozen-plugin-artifact";

  constructor(
    readonly trackId: string,
    readonly deviceId: string,
    readonly previousValue: FrozenPluginArtifactReference | null,
    readonly nextValue: FrozenPluginArtifactReference | null,
    options: PluginCommandOptions = {}
  ) {
    if (nextValue && nextValue.sourceDeviceId !== deviceId) {
      throw new Error("Frozen artifact evidence belongs to a different device.");
    }
    this.id = commandId(options);
  }

  private write(project: MusicProjectV2, value: FrozenPluginArtifactReference | null): MusicProjectV2 {
    const next = clone(project);
    findDevice(next, this.trackId, this.deviceId).frozen = clone(value);
    return next;
  }

  execute(project: MusicProjectV2): MusicProjectV2 { return this.write(project, this.nextValue); }
  undo(project: MusicProjectV2): MusicProjectV2 { return this.write(project, this.previousValue); }
}

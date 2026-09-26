import { z } from "zod";

import { ClipSchema, MusicProjectSchema, type MusicProject } from "./index.ts";

export const PROJECT_SCHEMA_VERSION_V2 = 2 as const;

const IdSchema = z.string().min(1);
const ChecksumSchema = z.string().regex(/^[0-9a-f]{64}$/);
const UuidSchema = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);

export const PluginRuntimeKindSchema = z.enum([
  "builtin",
  "audio-worklet",
  "audio-worklet-wasm",
  "wam",
  "native-proxy"
]);

export const PluginReferenceSchema = z.object({
  pluginId: IdSchema,
  vendorId: IdSchema.nullable(),
  version: z.string().min(1),
  runtimeKind: PluginRuntimeKindSchema,
  moduleChecksumSha256: ChecksumSchema.nullable()
});

export const PluginStateEnvelopeSchema = z.object({
  stateVersion: z.number().int().nonnegative(),
  encoding: z.enum(["json", "base64"]),
  payload: z.string(),
  checksumSha256: ChecksumSchema.nullable()
});

export const FrozenPluginArtifactReferenceSchema = z.object({
  renderId: UuidSchema,
  artifactId: UuidSchema,
  sourceProjectId: IdSchema,
  sourceRevisionId: IdSchema,
  sourceProjectChecksumSha256: ChecksumSchema,
  sourceDeviceId: IdSchema,
  sourcePluginStateChecksumSha256: ChecksumSchema,
  sourceSignalChainChecksumSha256: ChecksumSchema,
  artifactChecksumSha256: ChecksumSchema,
  engineVersion: z.string().min(1),
  frozenAt: z.string().datetime({ offset: true })
});

export const AutomationPointSchema = z.object({
  tick: z.number().int().nonnegative(),
  value: z.number(),
  curve: z.enum(["step", "linear"])
});

export const AutomationLaneSchema = z.object({
  parameterId: IdSchema,
  points: z.array(AutomationPointSchema)
});

export const DeviceParameterV2Schema = z.object({
  id: IdSchema,
  value: z.number()
});

export const DeviceV2Schema = z.object({
  id: IdSchema,
  deviceType: IdSchema,
  deviceVersion: z.string().min(1),
  enabled: z.boolean().default(true),
  parameters: z.array(DeviceParameterV2Schema).default([]),
  plugin: PluginReferenceSchema,
  pluginState: PluginStateEnvelopeSchema.nullable().default(null),
  automation: z.array(AutomationLaneSchema).default([]),
  frozen: FrozenPluginArtifactReferenceSchema.nullable().default(null)
});

export const TrackV2Schema = z.object({
  id: IdSchema,
  name: z.string().min(1),
  kind: z.enum(["instrument", "audio", "bus"]),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  muted: z.boolean().default(false),
  solo: z.boolean().default(false),
  volumeDb: z.number().min(-96).max(24).default(0),
  pan: z.number().min(-1).max(1).default(0),
  outputBusId: IdSchema.optional(),
  devices: z.array(DeviceV2Schema).default([]),
  clips: z.array(ClipSchema).default([])
});

export const MusicProjectV2Schema = MusicProjectSchema.omit({
  schemaVersion: true,
  tracks: true
}).extend({
  schemaVersion: z.literal(PROJECT_SCHEMA_VERSION_V2),
  tracks: z.array(TrackV2Schema)
});

export type PluginRuntimeKind = z.infer<typeof PluginRuntimeKindSchema>;
export type PluginReference = z.infer<typeof PluginReferenceSchema>;
export type PluginStateEnvelope = z.infer<typeof PluginStateEnvelopeSchema>;
export type FrozenPluginArtifactReference = z.infer<typeof FrozenPluginArtifactReferenceSchema>;
export type AutomationPoint = z.infer<typeof AutomationPointSchema>;
export type AutomationLane = z.infer<typeof AutomationLaneSchema>;
export type DeviceV2 = z.infer<typeof DeviceV2Schema>;
export type TrackV2 = z.infer<typeof TrackV2Schema>;
export type MusicProjectV2 = z.infer<typeof MusicProjectV2Schema>;

export function migrateProjectV1ToV2(project: MusicProject): MusicProjectV2 {
  const source = MusicProjectSchema.parse(project);
  return MusicProjectV2Schema.parse({
    ...structuredClone(source),
    schemaVersion: PROJECT_SCHEMA_VERSION_V2,
    tracks: source.tracks.map((track) => ({
      ...structuredClone(track),
      devices: track.devices.map((device) => ({
        ...structuredClone(device),
        plugin: {
          pluginId: device.deviceType,
          vendorId: "synaptix",
          version: device.deviceVersion,
          runtimeKind: "builtin" as const,
          moduleChecksumSha256: null
        },
        pluginState: null,
        automation: [],
        frozen: null
      }))
    }))
  });
}

export type AnyMusicProject = MusicProject | MusicProjectV2;

/** Open any supported project as v2. v1 projects are migrated; v2 projects are validated. */
export function toProjectV2(project: AnyMusicProject): MusicProjectV2 {
  return project.schemaVersion === PROJECT_SCHEMA_VERSION_V2
    ? MusicProjectV2Schema.parse(project)
    : migrateProjectV1ToV2(project);
}

function v1Device(device: DeviceV2): MusicProject["tracks"][number]["devices"][number] {
  const { id, deviceType, deviceVersion, enabled, parameters } = device;
  return { id, deviceType, deviceVersion, enabled, parameters: structuredClone(parameters) };
}

function v1Projection(project: MusicProjectV2, keep: (device: DeviceV2) => boolean): MusicProject {
  return {
    ...structuredClone(project),
    schemaVersion: 1,
    tracks: project.tracks.map((track) => ({
      ...structuredClone(track),
      devices: track.devices.filter(keep).map(v1Device)
    }))
  };
}

/**
 * v1-shaped view with every device (plug-ins included) reduced to its v1 fields, for code that
 * edits tracks, clips, and timing. Plug-in fields must be restored by device id afterwards.
 */
export function projectV2EditingView(project: MusicProjectV2): MusicProject {
  return v1Projection(project, () => true);
}

/** v1-shaped view containing only built-in devices, for the built-in instrument runtimes. */
export function projectV2BuiltinView(project: AnyMusicProject): MusicProject {
  if (project.schemaVersion === 1) return project;
  return v1Projection(project, (device) => device.plugin.runtimeKind === "builtin");
}

function isPlainBuiltin(device: DeviceV2): boolean {
  return (
    device.plugin.runtimeKind === "builtin" &&
    device.plugin.pluginId === device.deviceType &&
    device.plugin.vendorId === "synaptix" &&
    device.plugin.version === device.deviceVersion &&
    device.plugin.moduleChecksumSha256 === null &&
    device.pluginState === null &&
    device.automation.length === 0 &&
    device.frozen === null
  );
}

/**
 * Convert to v1 only when nothing would be lost: every device is a plain built-in exactly as
 * migrateProjectV1ToV2 would produce it. Returns null for projects that use plug-in features.
 */
export function downgradeProjectV2ToV1(project: MusicProjectV2): MusicProject | null {
  if (!project.tracks.every((track) => track.devices.every(isPlainBuiltin))) return null;
  return MusicProjectSchema.parse(v1Projection(project, () => true));
}

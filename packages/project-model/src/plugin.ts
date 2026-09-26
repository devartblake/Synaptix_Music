import { z } from "zod";

import {
  PluginReferenceSchema,
  PluginStateEnvelopeSchema,
  type DeviceV2,
  type FrozenPluginArtifactReference,
  type MusicProjectV2,
  type PluginReference,
  type PluginStateEnvelope
} from "./v2.ts";

/*
 * Format-neutral plug-in descriptor contracts (Plugin Runtime Foundation v1, R1/R7/R10).
 *
 * Descriptors describe what a plug-in *is*; they live in a trusted runtime catalog and are
 * never persisted inside project files. Projects persist only the PluginReference, numeric
 * parameters, the opaque state envelope, automation lanes, and frozen-artifact evidence.
 */

const IdSchema = z.string().min(1);

export const PluginParameterUnitSchema = z.enum(["db", "hz", "seconds", "ratio", "count", "none"]);

export const PluginParameterDescriptorSchema = z
  .object({
    id: IdSchema,
    label: z.string().min(1),
    kind: z.enum(["continuous", "discrete", "boolean"]),
    unit: PluginParameterUnitSchema,
    minimum: z.number(),
    maximum: z.number(),
    defaultValue: z.number(),
    automatable: z.boolean(),
    automationRate: z.enum(["a-rate", "k-rate"])
  })
  .strict()
  .refine((value) => value.minimum <= value.defaultValue && value.defaultValue <= value.maximum, {
    message: "Parameter defaultValue must lie within [minimum, maximum]."
  });

export const PluginBusDescriptorSchema = z
  .object({
    audioInputChannels: z.array(z.number().int().positive()),
    audioOutputChannels: z.array(z.number().int().positive()),
    midiInput: z.boolean()
  })
  .strict();

export const PluginLatencyMetadataSchema = z
  .object({
    latencySamples: z.number().int().nonnegative(),
    tailSeconds: z.number().nonnegative()
  })
  .strict();

export const PluginLicenseMetadataSchema = z
  .object({
    licenseId: IdSchema,
    licenseTextUri: z.string().min(1).nullable(),
    localUse: z.boolean(),
    commercialUse: z.boolean(),
    redistribution: z.boolean(),
    cloudRender: z.boolean(),
    multiUser: z.boolean(),
    activationRequired: z.boolean(),
    trademarkRestrictions: z.array(z.string().min(1))
  })
  .strict();

export const PluginProvenanceMetadataSchema = z
  .object({
    publisher: z.string().min(1),
    sourceUri: z.string().min(1).nullable(),
    reviewStatus: z.enum(["first-party", "approved", "pending", "revoked"]),
    reviewedAt: z.string().datetime({ offset: true }).nullable(),
    acceptanceEvidence: z.array(z.string().min(1))
  })
  .strict();

export const PluginCompatibilitySchema = z
  .object({
    requiresSecureContext: z.boolean(),
    requiresCrossOriginIsolation: z.boolean(),
    deterministicProductionRender: z.boolean()
  })
  .strict();

export const AudioPluginDescriptorSchema = z
  .object({
    reference: PluginReferenceSchema,
    name: z.string().min(1),
    category: z.enum(["instrument", "effect"]),
    buses: PluginBusDescriptorSchema,
    parameters: z.array(PluginParameterDescriptorSchema),
    state: z
      .object({
        stateVersion: PluginStateEnvelopeSchema.shape.stateVersion,
        encoding: PluginStateEnvelopeSchema.shape.encoding
      })
      .strict(),
    latency: PluginLatencyMetadataSchema,
    license: PluginLicenseMetadataSchema,
    provenance: PluginProvenanceMetadataSchema,
    compatibility: PluginCompatibilitySchema
  })
  .strict()
  .superRefine((value, context) => {
    const seen = new Set<string>();
    for (const parameter of value.parameters) {
      if (seen.has(parameter.id)) {
        context.addIssue({ code: "custom", message: `Duplicate parameter id '${parameter.id}'.` });
      }
      seen.add(parameter.id);
    }
  });

export const PluginUnavailableReasonSchema = z.enum([
  "unknown-plugin",
  "version-mismatch",
  "unsupported-runtime",
  "integrity-mismatch",
  "revoked",
  "not-approved",
  "state-incompatible",
  "load-failed",
  "processor-error"
]);

export const PluginAvailabilityStateSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("available") }).strict(),
  z
    .object({
      status: z.literal("unavailable"),
      reason: PluginUnavailableReasonSchema,
      message: z.string().min(1)
    })
    .strict()
]);

export type PluginParameterUnit = z.infer<typeof PluginParameterUnitSchema>;
export type PluginParameterDescriptor = z.infer<typeof PluginParameterDescriptorSchema>;
export type PluginBusDescriptor = z.infer<typeof PluginBusDescriptorSchema>;
export type PluginLatencyMetadata = z.infer<typeof PluginLatencyMetadataSchema>;
export type PluginLicenseMetadata = z.infer<typeof PluginLicenseMetadataSchema>;
export type PluginProvenanceMetadata = z.infer<typeof PluginProvenanceMetadataSchema>;
export type AudioPluginDescriptor = z.infer<typeof AudioPluginDescriptorSchema>;
export type PluginUnavailableReason = z.infer<typeof PluginUnavailableReasonSchema>;
export type PluginAvailabilityState = z.infer<typeof PluginAvailabilityStateSchema>;

export const PLUGIN_AVAILABLE: PluginAvailabilityState = Object.freeze({ status: "available" });

export function pluginUnavailable(reason: PluginUnavailableReason, message: string): PluginAvailabilityState {
  return { status: "unavailable", reason, message };
}

export function pluginReferenceKey(reference: Pick<PluginReference, "pluginId" | "version">): string {
  return `${reference.pluginId}@${reference.version}`;
}

/**
 * Resolve whether a persisted device can be hosted by a descriptor, without loading code.
 * The result is advisory metadata; it never mutates or rejects the project itself, so
 * unknown or unavailable plug-ins remain preserved exactly as stored.
 */
export function resolvePluginAvailability(
  device: Pick<DeviceV2, "plugin" | "pluginState">,
  descriptor: AudioPluginDescriptor | undefined
): PluginAvailabilityState {
  if (!descriptor) {
    return pluginUnavailable("unknown-plugin", `No trusted descriptor for '${pluginReferenceKey(device.plugin)}'.`);
  }
  const expected = descriptor.reference;
  if (expected.pluginId !== device.plugin.pluginId || expected.vendorId !== device.plugin.vendorId) {
    return pluginUnavailable("unknown-plugin", `Descriptor '${expected.pluginId}' does not describe '${device.plugin.pluginId}'.`);
  }
  if (expected.version !== device.plugin.version) {
    return pluginUnavailable("version-mismatch", `Project requires ${device.plugin.version}; catalog provides ${expected.version}.`);
  }
  if (expected.runtimeKind !== device.plugin.runtimeKind) {
    return pluginUnavailable("unsupported-runtime", `Project requires runtime '${device.plugin.runtimeKind}'.`);
  }
  if (
    device.plugin.moduleChecksumSha256 !== null &&
    device.plugin.moduleChecksumSha256 !== expected.moduleChecksumSha256
  ) {
    return pluginUnavailable("integrity-mismatch", "Module checksum does not match the trusted catalog entry.");
  }
  if (descriptor.provenance.reviewStatus === "revoked") {
    return pluginUnavailable("revoked", `'${pluginReferenceKey(expected)}' has been revoked.`);
  }
  if (descriptor.provenance.reviewStatus === "pending") {
    return pluginUnavailable("not-approved", `'${pluginReferenceKey(expected)}' has not been approved for use.`);
  }
  if (device.pluginState && device.pluginState.stateVersion > descriptor.state.stateVersion) {
    return pluginUnavailable(
      "state-incompatible",
      `State version ${device.pluginState.stateVersion} is newer than supported version ${descriptor.state.stateVersion}.`
    );
  }
  return PLUGIN_AVAILABLE;
}

// --- Evidence checksums -------------------------------------------------------------------

function canonicalize(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, item]) => item !== undefined)
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${canonicalize(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

/** Checksum of an opaque state payload, stored in PluginStateEnvelope.checksumSha256. */
export function computePluginStatePayloadChecksum(envelope: Pick<PluginStateEnvelope, "encoding" | "payload">): Promise<string> {
  return sha256Hex(`${envelope.encoding}:${envelope.payload}`);
}

export async function verifyPluginStateEnvelope(envelope: PluginStateEnvelope): Promise<boolean> {
  if (envelope.checksumSha256 === null) return true;
  return envelope.checksumSha256 === (await computePluginStatePayloadChecksum(envelope));
}

function deviceStateEvidence(device: DeviceV2) {
  return {
    id: device.id,
    deviceType: device.deviceType,
    deviceVersion: device.deviceVersion,
    enabled: device.enabled,
    plugin: device.plugin,
    parameters: device.parameters,
    pluginState: device.pluginState,
    automation: device.automation
  };
}

/** Checksum of everything that defines a device's processing, excluding its own freeze evidence. */
export function computePluginStateChecksum(device: DeviceV2): Promise<string> {
  return sha256Hex(canonicalize(deviceStateEvidence(device)));
}

function locateDevice(project: MusicProjectV2, deviceId: string) {
  for (const track of project.tracks) {
    const index = track.devices.findIndex((candidate) => candidate.id === deviceId);
    if (index >= 0) return { track, index };
  }
  return null;
}

/**
 * Checksum of every input that reaches a device's output: the timing context, the track's
 * clips and assets they reference, and each device up to and including the target.
 */
export async function computeSignalChainChecksum(project: MusicProjectV2, deviceId: string): Promise<string> {
  const located = locateDevice(project, deviceId);
  if (!located) throw new Error(`Device '${deviceId}' was not found.`);
  const { track, index } = located;
  const assetIds = new Set(track.clips.flatMap((clip) => (clip.kind === "audio" ? [clip.assetId] : [])));
  return sha256Hex(
    canonicalize({
      ticksPerQuarterNote: project.transport.ticksPerQuarterNote,
      tempoMap: project.tempoMap,
      timeSignatureMap: project.timeSignatureMap,
      trackId: track.id,
      clips: track.clips,
      assets: project.assets.filter((asset) => assetIds.has(asset.id)),
      devices: track.devices.slice(0, index + 1).map(deviceStateEvidence)
    })
  );
}

export type FrozenPluginEvidenceStatus =
  | { status: "absent" }
  | { status: "current"; reference: FrozenPluginArtifactReference }
  | { status: "stale"; reference: FrozenPluginArtifactReference; reasons: string[] };

/**
 * Compare a device's frozen-artifact reference with the project it is attached to.
 * Freezes are produced from an earlier immutable revision, so the rule is evidence
 * equality (device state + signal chain checksums), never revision-ID equality.
 */
export async function evaluateFrozenPluginEvidence(
  project: MusicProjectV2,
  deviceId: string
): Promise<FrozenPluginEvidenceStatus> {
  const located = locateDevice(project, deviceId);
  if (!located) throw new Error(`Device '${deviceId}' was not found.`);
  const device = located.track.devices[located.index]!;
  const reference = device.frozen;
  if (!reference) return { status: "absent" };

  const reasons: string[] = [];
  if (reference.sourceProjectId !== project.projectId) reasons.push("Frozen artifact belongs to a different project.");
  if (reference.sourceDeviceId !== device.id) reasons.push("Frozen artifact belongs to a different device.");
  if (reference.sourcePluginStateChecksumSha256 !== (await computePluginStateChecksum(device))) {
    reasons.push("Plug-in identity, parameters, state, or automation changed after freezing.");
  }
  if (reference.sourceSignalChainChecksumSha256 !== (await computeSignalChainChecksum(project, device.id))) {
    reasons.push("Clips, timing, or upstream devices changed after freezing.");
  }
  return reasons.length === 0 ? { status: "current", reference } : { status: "stale", reference, reasons };
}

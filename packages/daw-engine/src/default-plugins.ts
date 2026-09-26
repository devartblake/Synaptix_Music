import {
  AudioWorkletPluginHost,
  type AudioWorkletModuleDefinition,
  type AudioWorkletPluginHostOptions
} from "./audio-worklet-host.ts";
import { BrowserPluginHostRegistry, PluginCatalog } from "./plugin-host.ts";
import {
  REFERENCE_DRIVE_DESCRIPTOR,
  REFERENCE_DRIVE_PROCESSOR_NAME,
  REFERENCE_DRIVE_PROCESSOR_SOURCE
} from "./reference-drive.ts";

/** First-party AudioWorklet modules shipped with Synaptix Music. */
export const FIRST_PARTY_AUDIO_WORKLET_MODULES: readonly AudioWorkletModuleDefinition[] = [
  {
    descriptor: REFERENCE_DRIVE_DESCRIPTOR,
    processorName: REFERENCE_DRIVE_PROCESSOR_NAME,
    source: REFERENCE_DRIVE_PROCESSOR_SOURCE
  }
];

/**
 * The Alpha/Beta allowlist: only first-party, checksum-pinned modules. WAM and native
 * hosts register here once they exist (P2/P4).
 */
export function createDefaultPluginHostRegistry(options: AudioWorkletPluginHostOptions = {}): BrowserPluginHostRegistry {
  return new BrowserPluginHostRegistry(
    new PluginCatalog(FIRST_PARTY_AUDIO_WORKLET_MODULES.map((module) => module.descriptor)),
    [new AudioWorkletPluginHost(FIRST_PARTY_AUDIO_WORKLET_MODULES, options)]
  );
}

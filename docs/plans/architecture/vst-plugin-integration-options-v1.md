# VST and Extensible Audio Plug-in Integration — Architecture Decision v1

## Decision

Synaptix Music can support third-party audio plug-ins, but the current browser DAW cannot load native VST3 binaries directly. Adopt a two-tier architecture:

1. **Browser tier:** support Web Audio Modules (WAM) or Synaptix-owned AudioWorklet/WASM processors inside the existing browser production graph.
2. **Native tier:** defer actual `.vst3` hosting to an isolated native host service or a future desktop application. Communicate through versioned plug-in descriptors, parameter snapshots, MIDI/audio render requests, and immutable artifact results.

Do not load user-supplied VST3 binaries into the Next.js server, browser process, generation API, or existing render-worker process.

## Why native VST3 cannot run directly in this browser DAW

VST3 plug-ins are native platform bundles: DLL-based packages on Windows, Mach-O bundles on macOS, and native packages on Linux. A VST3 host supplies native audio/event blocks and loads the plug-in binary. A normal browser cannot dynamically load those operating-system binaries or expose the VST3 host ABI.

The browser's supported real-time extension boundary is Web Audio. `AudioWorklet` provides custom processing on the Web Audio rendering thread, while WebAssembly can supply portable DSP. That is a different runtime and ABI from VST3, so an existing commercial `.vst3` file cannot simply be renamed or uploaded and executed as a browser module.

## Recommended architecture

### Phase A — browser plug-in contract

Add a framework-neutral `AudioPluginDescriptor` contract containing:

- stable plug-in and vendor identifiers;
- semantic version and runtime kind (`builtin`, `wam`, `audio-worklet-wasm`, later `vst3-native`);
- audio/MIDI input and output bus declarations;
- normalized parameter definitions, automation capability, units, ranges, and defaults;
- deterministic state/preset serialization;
- latency and tail declarations;
- binary/module checksum, provenance, license, and compatibility metadata.

Implement a browser host adapter around AudioWorklet/WAM. Keep plug-in state in the canonical project revision and route parameter changes through the existing command/undo system.

### Phase B — trusted WAM/AudioWorklet catalog

- Start with first-party or explicitly reviewed modules.
- Require HTTPS, integrity checks, CSP-compatible module loading, and an allowlisted origin.
- Run DSP in `AudioWorkletProcessor`; keep UI and project mutations on the main/editor side.
- Reject arbitrary remote JavaScript and arbitrary uploaded WASM in the initial release.
- Record the exact module checksum in every render manifest.

This gives the web DAW a real plug-in ecosystem without pretending browser modules are VST3.

### Phase C — isolated native VST3 host

Create a separate native service, preferably C++ using the official VST3 SDK. It should:

- scan only administrator-approved plug-in directories;
- run each third-party plug-in in a child process or equivalent crash-isolation boundary;
- expose capability discovery, state/preset serialization, parameter automation, MIDI input, and offline render operations through a private versioned protocol;
- enforce CPU, memory, duration, filesystem, and network limits;
- quarantine failed or unstable plug-ins and capture crash/timeout telemetry;
- never receive platform credentials, database credentials, or object-storage administration keys;
- write results through the same certified render-artifact contract used by Stage 12.

Because VST3 binaries are platform-specific, production capacity must be separated by operating system and architecture. Windows-only plug-ins require Windows workers; macOS plug-ins require licensed macOS hosts; Linux can run only Linux-compatible builds. Do not assume Wine-based compatibility for a production guarantee.

### Phase D — optional desktop Synaptix Music shell

A desktop edition can host locally installed VST3 plug-ins and expose their UI more naturally than a remote service. The browser/web product should still open the project safely when a native plug-in is unavailable by preserving state, marking the device offline, and optionally using a frozen audio render.

## Canonical project behavior

Store references and state, never an unverified binary, in the music project:

```json
{
  "deviceType": "third-party-plugin",
  "deviceVersion": "1.0.0",
  "plugin": {
    "format": "vst3-native",
    "classId": "vendor-defined-stable-id",
    "vendor": "Example Vendor",
    "version": "2.4.1",
    "binaryChecksumSha256": "...",
    "stateObjectId": "...",
    "fallbackArtifactId": "..."
  }
}
```

Add this through a versioned schema evolution rather than inserting untyped fields into schema v1.

## Security and product constraints

- Treat every third-party plug-in as untrusted native code.
- No automatic plug-in download or installation from project files.
- Require administrator approval, malware scanning, provenance, and explicit license acceptance.
- Use allowlists for Alpha/Beta; a public marketplace needs signing, review, revocation, and incident-response capabilities.
- Preserve projects when a plug-in is missing; never silently substitute a different processor.
- Freeze/bounce workflows are required for collaboration, mobile playback, and deterministic server rendering.
- VST3 SDK code is MIT-licensed in the current SDK, but use of Steinberg's VST trademark/logo remains subject to its usage guidelines. Individual plug-in licenses remain separate and may prohibit server-side or multi-user deployment.

## What to implement now

1. Define the format-neutral plug-in descriptor and serialized-state contracts.
2. Add a built-in/AudioWorklet host adapter and one first-party reference processor.
3. Add missing-plug-in and frozen-render behavior to the project/runtime contract.
4. Profile AudioWorklet/WASM behavior before expanding the Rust/WASM scope.
5. Prototype VST3 only after Stage 12 object storage, signed artifact delivery, exact-revision loading, and render certification are complete.

## Explicitly deferred

- Loading `.vst3` files in the web browser.
- Arbitrary user plug-in uploads.
- Hosting third-party native plug-ins inside the existing Node.js render worker.
- Remote streaming of native plug-in graphical editors.
- VST2 support.
- A public plug-in marketplace.

## Primary references

- [Steinberg VST 3 Developer Portal](https://steinbergmedia.github.io/vst3_dev_portal/)
- [Official VST3 SDK and platform requirements](https://github.com/steinbergmedia/vst3sdk)
- [W3C Web Audio API and AudioWorklet](https://www.w3.org/TR/webaudio/#AudioWorklet)
- [Web Audio Modules API](https://github.com/WebAudioModules/api)
- [CLAP specification](https://github.com/free-audio/clap)

## Revision date

2026-09-20

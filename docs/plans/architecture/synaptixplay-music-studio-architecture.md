# SynaptixPlay Music Studio Architecture Plan

## Executive recommendation

Use a multi-runtime architecture:

- **TypeScript** for the browser DAW, project model, editor engine, and UI.
- **Next.js** for routing, authentication integration, dashboards, project management, sharing, marketplace, and the product shell.
- **Tone.js and Web Audio** for the initial browser playback implementation.
- **AudioWorklets and Web Workers** for production real-time processing and background browser tasks.
- **Python and FastAPI** for procedural composition, prompt interpretation, music analysis, and AI inference.
- **Rust compiled to WebAssembly** for measured DSP bottlenecks such as resampling, time stretching, pitch shifting, and advanced effects.
- The existing **SynaptixPlay .NET backend** for identity, billing, credits, entitlements, permissions, moderation, and gateway responsibilities.
- **PostgreSQL, Redis, and object storage** for metadata, jobs, and media.
- **Server render workers plus FFmpeg** for deterministic production exports.

## What openDAW demonstrates

openDAW shows that a serious browser DAW benefits from separating the application UI, reusable DAW-domain packages, the real-time audio engine, workers, WASM components, project serialization, rendering, and collaboration infrastructure.

The main lesson is not to place the entire DAW inside one Next.js application directory. The editor should consume framework-neutral TypeScript packages that can later be reused by a desktop wrapper, embedded editor, headless renderer, or Flutter-controlled playback client.

## Key architectural lessons

1. Keep the application separate from the DAW engine.
2. Place project-domain logic in framework-neutral TypeScript packages.
3. Build AudioWorklets, Web Workers, and WASM as separate artifacts.
4. Separate canonical project state from temporary UI state.
5. Represent meaningful edits as commands for undo, redo, autosave, collaboration, and generated-change review.
6. Use a versioned project format and schema validation at system boundaries.
7. Support browser preview rendering and server production rendering as distinct paths.
8. Keep collaboration optional until the core single-user workflow is stable.
9. Treat instruments and effects as typed device contracts.
10. Preserve clean licensing boundaries and avoid copying AGPL-licensed source into a closed-source product.

## Recommended monorepo

```text
synaptix-music/
├── apps/
│   └── music-studio/
├── packages/
│   ├── project-model/
│   ├── command-system/
│   ├── daw-engine/
│   ├── audio-runtime/
│   ├── music-theory/
│   ├── generator-contracts/
│   ├── render-contracts/
│   └── shared-types/
├── services/
│   ├── generation-api/
│   └── render-worker/
├── crates/
│   ├── dsp/
│   └── wasm-bindings/
├── schemas/
├── infrastructure/
├── plans/
└── .github/
```

## Dependency direction

```text
music-studio
  -> daw-engine
  -> project-model
  -> generator-contracts

daw-engine
  -> project-model
  -> audio-runtime
  -> music-theory

generator-contracts
  -> project-model

Rust/WASM
  -> audio-runtime adapter

Python generation service
  -> JSON contracts only
```

Lower-level packages must never depend on React or Next.js.

## Browser execution model

### Main thread

- Next.js and React UI
- Project editing
- Command dispatch
- Selection and panel state
- Timeline and mixer interaction

### AudioWorklet

- Sample-accurate scheduling
- Synthesis
- Effects
- Mixing
- Metering

### Web Workers

- Waveform analysis
- Audio decoding
- Project compression
- MIDI parsing
- Heavy serialization

### Rust/WASM

- Resampling
- Pitch shifting
- Time stretching
- Spectral processing
- Advanced DSP

### Server workers

- Production rendering
- Encoding
- Mastering
- Stem generation
- Adaptive game-music bundles

## Next.js guidance

Use Next.js for the product shell and account-connected features, but keep the studio editor client-heavy. Configure cross-origin isolation for studio routes when SharedArrayBuffer or advanced WASM processing is required. Test COOP and COEP headers against authentication, CDN-hosted samples, object storage, and embedded third-party resources.

## Tone.js guidance

Tone.js is appropriate for the MVP, but it should be hidden behind DAW-engine interfaces. Do not spread Tone.js objects through React components or make the canonical project format depend on Tone.js classes.

Recommended boundary:

```text
Project model
    -> DAW engine interfaces
    -> Tone.js runtime adapter
    -> Web Audio
```

## Project model

The canonical project should be versioned and transport-neutral. It should contain tracks, clips, notes, automation, routing, tempo maps, time signatures, markers, assets, and optional generator metadata.

Separate project state from UI state. Project state belongs in persisted revisions; zoom, scroll position, open panels, hover state, and transient drag state belong in workspace state.

## Command architecture

Represent meaningful edits as commands or transactions:

- Add or remove track
- Move or resize clip
- Add or move note
- Replace instrument
- Change automation
- Generate melody
- Replace drums
- Extend chorus
- Create tension variation

This supports undo and redo, autosave batching, audit history, collaboration, deterministic revisions, and generated-change review.

## Python service

Python should handle prompt interpretation, harmony, melody, bass, drums, arrangement, AI inference, and music analysis. It should return structured generation results rather than directly mutating browser state.

Recommended API responsibilities:

```text
POST /generation/projects
POST /generation/tracks
POST /generation/sections
POST /generation/variations
POST /analysis/audio
POST /render/jobs
GET  /jobs/{jobId}
GET  /healthz
GET  /readyz
```

## Rust and WASM

Rust should be introduced after profiling identifies bottlenecks. Suitable responsibilities include resampling, time stretching, pitch shifting, custom filters, waveform analysis, and reusable render kernels. The same Rust DSP crates can eventually support browser WASM, server rendering, Tauri desktop, and native mobile integration.

## Go decision

Go is not required for the MVP. The existing .NET platform can handle orchestration, billing, identity, permissions, job metadata, and WebSocket coordination. Introduce Go only for a clearly isolated, high-concurrency service that cannot be served cleanly by the existing platform.

## Rendering strategy

Support two render paths:

### Browser preview render

- OfflineAudioContext
- Short loops and drafts
- Fast local feedback
- Optional FFmpeg WASM encoding

### Server production render

- Immutable render manifests
- Fixed engine and plugin versions
- WAV, MP3, and OGG exports
- Stems and previews
- Waveform generation
- Commercial and adaptive game-music packages

## Collaboration

Defer real-time collaboration. Start with single-user editing, autosave, immutable revisions, optimistic concurrency, and conflict detection. Later, Yjs and WebSockets can add presence and synchronized edits. Large media files should remain in object storage and be referenced by ID.

## Product scope

Do not reproduce all of openDAW. The SynaptixPlay MVP should focus on:

- Generated multitrack music
- MIDI editing
- Loop editing
- Basic sample manipulation
- Game stingers
- Adaptive music states
- Creator-safe exports
- Basic effects
- Browser playback
- Server rendering

## Recommended phases

### Phase 1: Foundation

- Create monorepo
- Define project schema
- Define command model
- Create Next.js studio shell
- Add basic transport
- Add local autosave

### Phase 2: Editable MVP

- Tracks and clips
- Piano roll
- Step sequencer
- Mixer
- Basic devices
- Undo and redo

### Phase 3: Generation

- Python FastAPI service
- Chords
- Melody
- Bass
- Drums
- Arrangement
- Structured generated-change responses

### Phase 4: Platform integration

- SynaptixPlay authentication
- Project ownership
- PostgreSQL
- Redis jobs
- Object storage
- Usage credits

### Phase 5: Rendering

- Immutable render manifests
- Background workers
- FFmpeg encoding
- WAV, MP3, and OGG
- Waveform and preview generation

### Phase 6: Differentiation

- Game loops
- Victory and defeat stingers
- Tension layers
- Adaptive music manifests
- Flutter runtime integration

### Phase 7: Optimization

- AudioWorklet hardening
- Rust/WASM DSP
- Desktop packaging
- Collaboration after product stability

## Licensing warning

openDAW is available under AGPL terms or a commercial license. Architectural study is reasonable, but copying substantial source into a closed-source SynaptixPlay product may trigger copyleft obligations unless an appropriate commercial agreement is obtained. Build an independently authored implementation using general patterns, public standards, and compatible libraries.

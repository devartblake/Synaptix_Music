# Synaptix Music Alpha Foundation Release Notes

**Status:** Pre-release milestone summary  
**Coverage:** Merged work through PR #25; PR #26 is the active integration slice  
**Revision date:** 2026-08-05

## Overview

The Alpha Foundation milestone establishes a usable local-first browser music editor with deterministic procedural generation, durable project synchronization, detailed MIDI editing, production-oriented browser audio routing, and strict production-render contracts.

This is not yet a tagged production release. Offline rendering, export delivery, asset licensing workflows, and production runbooks remain incomplete.

## Included Capabilities

### Browser studio

- Four-track arrangement timeline
- Mixer controls for volume, pan, mute, and solo
- Piano roll with note creation, movement, resizing, selection, snapping, quantization, transpose, velocity, zoom, marquee, and duplication
- Device-aware drum step sequencer with multi-bar patterns and accents
- Undo/redo, keyboard shortcuts, bounded history, and recovery state

### Audio preview

- MIDI scheduling and polyphonic synthesis
- Device-specific instrument profiles
- Track audition and all-notes-off panic
- Authoritative transport tick snapshots
- Drum/music buses, shared reverb, master compression, and peak/RMS metering foundation

### Project and persistence

- Canonical project schema and cross-runtime validation
- Immutable checksummed revisions
- IndexedDB local storage and revision recovery
- Offline upload queue and reconnect drain
- Multi-tab project editing leases
- Before-unload protection for pending work

### Platform integration

- Authenticated Next.js BFF
- Durable generation jobs with polling, SignalR, replay, acknowledgements, and idempotent proposal application
- Durable .NET project synchronization API
- Optimistic concurrency and explicit conflict resolution
- Revision history, archive, and restore

### Procedural generation

- Deterministic Python/FastAPI composer
- Seeded trivia/game-show arrangements
- Drums, bass, harmony, and melody proposals
- Proposal conversion into one canonical transaction and revision

### Production-render foundation

- Versioned deterministic render manifests
- Exact revision, checksum, engine, seed, range, scope, and output requirements
- Structured render outcomes and artifact checksum evidence

## Known Limitations

- No production offline WAV worker yet
- No durable render-job state machine yet
- No stem, MP3, OGG, or adaptive-game export delivery yet
- Device/effect runtime parameter mapping remains in progress
- Asset ingestion, provenance, and licensing enforcement are not complete
- Browser preview is not considered production-render evidence
- Real-time collaboration and third-party plugin hosting are out of scope

## Alpha Tag Readiness Requirements

Before creating the first tagged alpha:

1. Complete PR #26 production-graph integration and studio metering.
2. Implement one deterministic offline WAV path.
3. Add durable render-job persistence and worker recovery.
4. Validate identical-manifest checksum repeatability.
5. Complete asset-resolution and missing-asset failure behavior.
6. Add operational render telemetry and recovery documentation.
7. Run local, browser, synchronization, and render integration certification.

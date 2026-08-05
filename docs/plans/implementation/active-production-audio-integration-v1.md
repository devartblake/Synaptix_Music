# Active Production Audio Integration v1

## Scope

This Stage 12 slice moves the production-audio graph from a standalone boundary into the active browser runtime.

## Runtime integration

`BrowserAudioEngine` now creates instrument runtimes through `BrowserProductionAudioGraph`, preserving transport scheduling and audition while adding:

- device-profile instrument selection;
- drum and music bus routing;
- shared reverb and master compression;
- master peak/RMS snapshots;
- clipping evidence;
- disposable meter subscriptions.

## Command boundary

The editor command system now exposes reversible commands for:

- enabling or disabling a device;
- adding or updating numeric device parameters.

These commands participate in the existing revision, undo/redo, IndexedDB, and platform synchronization pipeline.

## Studio UI

`MasterMeter` provides a browser-facing master level display with peak, RMS, and clipping indication. The remaining integration seam is mounting it in the studio header alongside command-backed device/effect controls.

## Next slice

- Mount the master meter in `StudioClient`.
- Add filter-frequency, reverb-send, and instrument-envelope controls.
- Map canonical device parameters into the production graph.
- Add durable render jobs and deterministic offline WAV rendering.

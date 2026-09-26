# Plugin Runtime Foundation v1: Closure Record

**Status:** P1 implementation complete (package level); app-wide v2 adoption is the next milestone
**Revision date:** 2026-09-26
**Roadmap:** `docs/plans/architecture/browser-daw-plugin-extensibility-roadmap-v1.md`
**Research:** `plugin-runtime-foundation-v1-research-plan.md`, `plugin-runtime-foundation-v1-r1-r2-r5-findings.md`, `plugin-runtime-foundation-v1-schema-freeze-wam-audioworklet.md`

## Implemented slices

| Slice | Scope | Where |
| --- | --- | --- |
| A: Project Schema v2 | Zod, JSON Schema, Pydantic; deterministic v1 -> v2 migration | `packages/project-model/src/v2.ts`, `schemas/project/v2.json`, `services/generation-api/app/models/project_v2.py` |
| B: Evidence contracts | Automation lanes and `FrozenPluginArtifactReference` on v2 devices; descriptor, bus, latency, license, provenance, compatibility and availability contracts; state, signal-chain and envelope checksums; Stage 12 manifest verification; production-eligibility rule | `packages/project-model/src/plugin.ts`, `packages/render-contracts/src/plugin-freeze.ts` |
| C: Browser host seam | `BrowserPluginHost` / `BrowserPluginInstance`, trusted `PluginCatalog`, deterministic `BrowserPluginHostRegistry`, insert-chain and automation planning, `BrowserAudioEngine` integration | `packages/daw-engine/src/plugin-host.ts`, `packages/daw-engine/src/index.ts` |
| D: Reference Drive | First-party AudioWorklet processor, checksum-pinned module, AudioWorklet host adapter | `packages/daw-engine/src/reference-drive.ts`, `packages/daw-engine/src/audio-worklet-host.ts` |
| R5: Commands | v2-capable history; insert/remove device, verified state replacement, automation lane, frozen attachment; bypass and parameter gestures reuse existing commands | `packages/command-system/src/plugin.ts`, `packages/command-system/src/editor.ts`, `packages/command-system/src/device.ts` |
| Persistence | Version-aware storage with v1 default parser and v2 opt-in | `packages/project-storage/src/index.ts` |

## Release-gate evidence

| P1 gate | Evidence |
| --- | --- |
| The canonical project can represent a format-neutral plug-in instance | v2 device = `PluginReference` + numeric parameters + opaque `PluginStateEnvelope` + automation + frozen evidence; `schemas/project/fixtures/plugin-v2.json` is accepted by Zod, JSON Schema and Pydantic, and invalid variants are rejected by both Python validators (`test_project_schema_v2.py`) |
| A first-party AudioWorklet device can load and process audio | `reference-drive.test.ts` runs the exact shipped module in an isolated worklet scope (dry passthrough, unity small-signal gain, bounded clipping, a-rate automation, mono up-mix, disposal). Verified manually in Chromium: module checksum matches in-browser, OfflineAudioContext render passes dry audio unchanged, clips at `1/drive`, follows a scheduled mix ramp; through `BrowserAudioEngine` the insert attenuates the master as configured and an unknown plug-in is bypassed and reported |
| Parameters are command-backed and automatable | One history entry per gesture with exact undo/redo on v2 (`command-system/src/plugin.test.ts`); automation lanes are edited by one command each and scheduled onto AudioParams (`planAutomationEvents`, engine transport scheduling) |
| State survives save/reload and immutable revisions | `project-storage/src/plugin-persistence.test.ts`: parameters, state and automation round-trip through `LocalProjectRepository<MusicProjectV2>`, per-revision snapshots reload exactly, tampering fails checksum verification |
| Missing-device behavior preserves project integrity | Unknown plug-ins round-trip byte-for-byte (`project-model/src/plugin.test.ts`); the registry never throws and returns reasons (`unknown-plugin`, `version-mismatch`, `unsupported-runtime`, `integrity-mismatch`, `revoked`, `not-approved`, `state-incompatible`, `load-failed`, `processor-error`); the engine bypasses (never substitutes) and reports via `pluginStatuses()` |
| Freeze/bounce metadata is represented | `FrozenPluginArtifactReference` links to Stage 12 render/artifact identity; validity uses evidence checksums, not revision IDs (descendant revisions stay valid); stale detection covers parameters, state, automation, clips, timing and upstream devices |
| Integrity/provenance/license metadata has a defined contract | `AudioPluginDescriptorSchema` (license: local/commercial/redistribution/cloud-render/multi-user/activation/trademark; provenance: publisher, review status, evidence); modules must pin SHA-256 and are verified before loading |
| Tests cover schema, runtime lifecycle, history, persistence, and fallback | New suites in `project-model`, `render-contracts`, `command-system`, `project-storage`, `daw-engine`, `generation-api` |
| Existing Stage 12/13 behavior remains green | Stage 12 contracts are unchanged (freeze verification only reads them); `npm run ci` passes; v1 remains the default for storage and the studio |

## Decisions made during implementation

- **Built-in runtime not moved behind the seam.** Built-in devices are parameter sets consumed by the Tone.js instrument runtime, whose semantics are shared with the deterministic offline renderer (ADR-0003). Wrapping it would risk Stage 12 parity for no functional gain, so `builtin` devices stay on the existing path and the seam hosts every other runtime kind. The engine consumes a v1 view (`builtinProjectView`) for built-ins.
- **Inserts are post-filter, pre-channel.** Plug-in effects sit between the instrument filter and the channel strip, so volume, pan, mute and sends apply after them. Freeze evidence is therefore pre-fader (track volume/pan are excluded from the signal-chain checksum).
- **Automation curve semantics.** A point's `curve` describes the segment that follows it; lanes are normalized (sorted, last write wins per tick) by the command, so the schema stays identical across Zod, JSON Schema and Pydantic.
- **Blob-URL module loading.** First-party processor source is bundled as a string, hashed, and loaded through an object URL. Deployments with a strict CSP must allow `blob:` in `worker-src`/`script-src` for AudioWorklet modules.
- **Engine loads modules via the raw context.** Tone's `addAudioWorkletModule` caches a single module promise per context, so the host calls `rawContext.audioWorklet.addModule` directly and caches per processor.

## Deferred, with owners in the roadmap

| Item | Deferred to |
| --- | --- |
| Studio/UI adoption of v2, sync gating, render-worker v2 loading | Done in Phase 1 of `docs/plans/implementation/project-schema-v2-cutover.md` |
| Platform API accepting v2 revisions | Cutover Phase 2 (separate platform service) |
| Freeze workflow, frozen playback in the render worker and the browser | Cutover Phase 2; the worker fails closed on live plug-ins until then |
| WAM adapter (Slice E) | P2 |
| Cross-origin isolation, SharedArrayBuffer, browser compatibility matrix (R8) and JS vs WASM benchmarks (R9) | P3 |
| Native VST3 bridge | P4 |
| JSON Schema `date-time` format assertion for `frozenAt` (Pydantic and Zod enforce it; the Python JSON Schema validator does not assert formats by default) | Tracked; no behavior difference for valid data |

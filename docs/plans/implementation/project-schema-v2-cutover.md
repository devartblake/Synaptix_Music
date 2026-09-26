# Project Schema v2 Cutover

**Status:** Phase 1 implemented (studio, local storage, sync gating, render worker); platform v2 acceptance and frozen playback pending
**Revision date:** 2026-09-26
**Depends on:** Plugin Runtime Foundation v1 (`docs/plans/research/plugin-runtime-foundation-v1-closure.md`)

## Principle

Read v1 and v2 everywhere, and write v2 only where the reader is known to accept it. The SynaptixPlay platform API is a separate service, so this repository cannot assume it stores or validates v2.

## Phase 1 (this change)

| Area | Behavior |
| --- | --- |
| Studio editing | Projects open as v2 (`toProjectV2`); v1 projects migrate in memory on open. History, preview audio and the plug-in rack work on v2. Existing v1 editor commands run through `liftEditorCommandToV2`, which restores plug-in fields by device id, including after undo of removals. |
| Local storage | IndexedDB stores v2 snapshots; the repository parses v1 or v2 (`parseVersionedMusicProject`), so older local projects still load. |
| Platform sync | `NEXT_PUBLIC_SYNAPTIX_PLATFORM_PROJECT_SCHEMA_VERSION` (default `1`). With `1`, revisions without plug-in data upload as lossless v1 (checksum recomputed for the uploaded snapshot); plug-in projects are saved locally and not queued, with an explicit status. With `2`, v2 uploads unchanged. Downloads and conflict resolutions accept either version. |
| Render worker | Loads v1 or v2 revisions. v2 renders through its built-in view (byte-identical to the v1 source). Enabled plug-ins on rendered tracks fail the job closed, naming the devices. |
| Generation API | No change: it produces generation proposals, not projects. Its v1 and v2 Pydantic models remain the contract. |

## Phase 2 (next)

1. **Platform accepts v2.** Platform API validates v2 revisions (use `schemas/project/v2.json`) and stores them; then set the flag to `2` in each environment. Plug-in projects queued locally before the switch need a re-save to upload (they are not queued while blocked).
2. **Freeze workflow.** Studio "Freeze" action: request a stems render at the device output, attach `FrozenPluginArtifactReference` with `SetFrozenPluginArtifactEditorCommand`, show stale freezes via `evaluateFrozenPluginEvidence`.
3. **Frozen playback in the render worker.** Load the referenced artifact, verify it with `verifyFrozenArtifactAgainstManifest`, and substitute it for the track's pre-fader signal; relax `resolveRenderableProject` to accept current freezes.
4. **Frozen playback in the browser** when a plug-in is unavailable (currently bypassed and reported).
5. **Retire v1 writes** once the platform and all clients read v2.

## Decisions to revisit

### 1. Built-in Tone.js instruments stay outside the plug-in host interface

**Today:** `builtin` devices are still realized by the existing Tone.js instrument/drone runtimes; the host seam only hosts non-builtin runtimes, which are inserted after the instrument filter.

**Why:** the deterministic offline renderer mirrors the built-in instruments' semantics (ADR-0003). Moving them behind the seam changes code the Stage 12 certification relies on, for no user-visible gain yet.

**Cost of leaving it:** two paths in `BrowserAudioEngine` (built-in runtime + insert chain); plug-ins can only be effects after the built-in instrument, not instruments themselves; a future plug-in instrument (WAM synth) needs the seam to own MIDI scheduling, which today is hard-wired to the Tone.js synth.

**Revisit when:** the first plug-in instrument lands (P2 WAM synth), or when Stage 12 is certified and a parity test harness can prove the wrapped built-ins still match the offline renderer.

### 2. Freeze validity ignores track volume and pan

**Today:** the signal-chain checksum covers timing, clips, referenced assets and every device up to the frozen one. Track volume, pan, mute, solo and sends are excluded because inserts sit before the channel strip, so a freeze is pre-fader.

**Why:** mixing a frozen track should not force a re-render; this matches how DAWs freeze.

**Risks:** anything later added *before* the insert point in the channel (pre-fader sends, input gain, sidechain inputs from other tracks) must be added to the checksum, or freezes will be wrongly reported as current. Downstream devices on the same track are also excluded by design; if a freeze is meant to capture the whole track output, the scope must change to post-chain.

**Revisit when:** adding sidechains, pre-fader routing, or a "freeze track output" (post-chain) mode.

### 3. Plug-in modules load from `blob:` URLs

**Today:** first-party processor source is bundled as a string, its SHA-256 is verified in the browser, and it is loaded with `audioWorklet.addModule(blob:…)`.

**Why:** the integrity check covers the exact bytes loaded, with no extra network request and no static-asset routing in Next.js.

**Implications:** a Content-Security-Policy must allow `blob:` for AudioWorklet modules (`script-src`/`worker-src` depending on browser). Allowing `blob:` broadly weakens CSP for all scripts on the page.

**Alternative:** serve processors as immutable, hashed static files from the app origin (e.g. `/_worklets/reference-drive.<hash>.js`) and load by URL; keep the checksum pin and verify with a fetch before `addModule`, or rely on same-origin + CSP `'self'`. This removes the `blob:` requirement and is the better fit once the studio ships a CSP. The host already isolates URL creation behind `createModuleUrl`, so the switch is local to `AudioWorkletPluginHost` options.

**Revisit when:** a CSP is introduced for the studio (none is configured today), or before third-party modules are allowed.

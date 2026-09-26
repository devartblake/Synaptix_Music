# Synaptix Music Studio UI Modernization v1

## Goal

Evolve the current functional editor into a coherent production-oriented DAW interface without coupling visual redesign to audio-runtime or synchronization correctness.

The generated concept image is a visual target, not a claim about the current implementation. The redesign will be delivered incrementally behind stable component boundaries.

## Selected visual references

The implementation uses reference patterns rather than copying any one design:

- **Audioscape** — structural baseline for the dense, timeline-first production workspace.
- **Sonuum** — web collaboration, revision, persistence, and project-status presentation.
- **SonicAI** — generation entry points and future job/variation workflow.
- **SynaptixPlay game-audio references** — restrained cyan/violet accents, adaptive-state intensity, runtime preview, and publication readiness.

Professional editing density remains authoritative. Decorative gaming treatments must not reduce timeline readability, accessible contrast, or control discoverability.

## Implementation status

### Slice UI.1 — foundation and studio shell (implemented)

- Global semantic tokens for canvas, panels, text, borders, state colors, radius, focus, and elevation.
- Responsive three-panel shell with workspace navigation, central editor, and project inspector.
- Persistent transport with revision, local persistence, and synchronization status.
- Existing arrangement, piano-roll, drum, command-history, persistence, and audio behavior retained inside the new shell.
- SynaptixPlay runtime-preview and publication-readiness surfaces added as non-deceptive status previews.
- The initial disabled generation entry point was activated in UI.2 below.

Validation: the music-studio TypeScript check and optimized Next.js production build pass.

### Slice UI.2 — generation and status workflow (implemented)

- Connected the generation entry point to the existing platform generation-job API.
- Added a creative brief interpreter that tunes only supported structured generation controls, plus gameplay-oriented presets and direct mood/key/tempo/bars/energy/complexity/seed controls.
- Added idempotent submission, durable polling, reload recovery of the latest project job, terminal/error presentation, and structural proposal preview.
- Added explicit apply-to-project behavior as one reversible editor-history command. Application replaces the active arrangement, queues a normal persisted revision, and guards duplicate application in browser storage.
- Activated the stateful Generate workspace while preserving the arrangement editor state.
- Added unit coverage for presets/request construction, brief interpretation, proposal summaries, and reversible arrangement replacement.

### Slice UI.3 — realtime and validation closure (implemented)

- Connected the configured SynaptixPlay SignalR hub to the generation workspace as a credentialed low-latency supplement. Secure session cookies remain authoritative; no access token is exposed through public environment configuration.
- Preserved durable polling as the source of truth and fallback when the hub is absent, unavailable, reconnecting, or closed. Every hub connection performs immediate and post-reconnect job reconciliation.
- Added an honest live-update indicator and an atomic screen-reader status region without making decorative state indicators audible.
- Added Playwright layout contracts for 1440px desktop and 1024px tablet viewports, horizontal-overflow checks, labeled-control/landmark assertions, and an axe WCAG 2/2.1 A/AA scan.
- Wired the UI validation into pull-request CI with a pinned Chromium installation.

Deployment requires `NEXT_PUBLIC_SYNAPTIX_SIGNALR_HUB_URL` to contain only the public hub endpoint (normally `https://api.synaptixplay.com/ws/notify`). Authentication continues through the browser's secure platform session cookie.

### Slice UI.4 — home and project navigation (implemented)

- Replaced the root placeholder with a responsive project home using the studio's existing dark, violet, and cyan tokens.
- Added a prominent demo-studio entry point, a decorative arrangement preview, and concise editing guidance.
- Added a real local-project list backed by the existing IndexedDB storage, including loading, empty, unavailable-storage, and retry states.
- Added a visible Projects link in the studio header, including on small screens.
- Navigation uses document links so entering the studio applies its cross-origin isolation headers and leaving it tears down the audio runtime.
- Added browser coverage for entering the demo, persisting a tempo edit, returning home, reopening the saved project, storage failure, responsive layout, and accessibility.
- This slice exposed existing local projects and the editable demo; creation, cloud discovery, search, and local deletion were completed in the remaining-task implementation below.

### Slice UI.5 — mixer drawer and workspace access (implemented)

- Activated the Mixer entry point as a bottom drawer, available from every workspace.
- Added track channel strips with volume, pan, mute, and solo through the existing editor commands, revision persistence, and undo/redo history.
- Fader gestures commit one command on release; keyboard and assistive input are supported. Pointer cancellation discards the uncommitted fader value.
- Reused live master peak/RMS/clipping metering and exposed save/sync status in the drawer. No synthetic per-track meters or editable bus controls are shown.
- Remembered drawer visibility in browser preferences, with a safe fallback when preference storage is unavailable.
- Added a compact workspace selector so Arrangement, Generate, and Adaptive States remain reachable when the sidebar is hidden on phones.
- Added browser coverage for pointer/keyboard edits, undo/redo, project reload, drawer preferences, focus restoration, mobile navigation, and accessibility.

## Two-task delivery increments

The first six remaining tasks are grouped into three increments. Each increment is validated before moving to the next.

| Increment | Task pair | Status |
| --- | --- | --- |
| 1 | Shared UI components and consistent control styling; resizable/collapsible panels and mixer height | Complete |
| 2 | Transport-driven playhead, compact track headers, richer clip selection; piano-roll/drum visual refresh and keyboard interactions | Complete |
| 3 | Bus/return channels, per-channel metering, routing controls; render/export workflow and artifact-download UI | Complete |

### Increment 1 implementation

- Extracted shared buttons, panels, toolbars, tabs, badges, committed sliders, disclosure controls, meters, and resize handles into `apps/music-studio/components/ui`.
- Adopted the shared controls across the studio, mixer, generation/adaptive actions, and piano-roll/drum toolbars. Specialized canvas rendering remains part of increment 2.
- Added a Layout disclosure with independent navigation/inspector visibility and a reset action.
- Added bounded pointer and keyboard resizing for navigation, inspector, and mixer height, with persisted dimensions separate from project revisions.
- Preserved desktop/tablet defaults; narrower viewports hide side panels and constrain mixer height while retaining the saved larger-screen layout.
- Added layout coverage for persistence, collapse/reset, keyboard focus, pointer sizing, responsive constraints, and malformed/unavailable preferences.

Validation: 24 desktop/tablet browser tests pass with two workers, including eight new layout cases, axe accessibility checks, and existing home/mixer regressions. TypeScript and package-boundary checks pass. The initial eight-worker run hit intermittent home-navigation timing failures; the two-worker run completed without failures.

The optimized production build also passes. The refreshed Docker stack has six healthy services; a browser smoke check at `localhost:3000` verifies panel/mixer resizing, persisted sizes, reset, and mobile disclosure focus.

### Increment 2 implementation

- Added arrangement and piano-roll playheads and a bar/beat/tick readout from the audio engine transport subscription. Bar-ruler buttons seek the same transport; pause, stop, and loop wrapping use actual ticks.
- Made track headers compact, sticky during horizontal scrolling, and independently expandable. Volume, pan, and device sliders now commit keyboard/pointer gestures through editor commands.
- Added selectable clips with MIDI note previews and keyboard editor entry. Timeline length includes clip offsets, full durations, and the loop range instead of assuming sixteen bars.
- Refreshed the piano-roll grid, keyboard, note states, ruler, and velocity controls using shared studio tokens. Added keyboard insertion, movement, group selection, resize, transpose, duplicate, delete, and velocity edits, with bounded movement and visible errors.
- Replaced the independent drum cursor with transport-driven step highlighting and optional follow playback. Added bar-window navigation, arrow/Home/End focus navigation, Space/Enter toggles, V velocity cycling, and Delete clearing. Clear visible steps preserves notes in other bars.
- Kept playback subscriptions inside display/editor components, separate from project revisions and engine graph loading.

Validation: 34 browser tests pass across desktop and tablet, including ten editing cases and axe checks for both editors. All 31 studio model tests, TypeScript, package-boundary checks, and the optimized production build pass. The refreshed Docker stack has six healthy services; a browser smoke check verifies ruler seeking, keyboard clip entry, MIDI playhead position, live drum highlighting, and phone-width containment.

Timing uses the audio engine's existing first-time-signature contract. Supporting changing time-signature maps remains a separate engine task. Automatic screenshot comparisons were added in the remaining-task implementation below.

### Increment 3 implementation

- Exposed the engine's fixed Music and Drums buses, Reverb return, and Master as mixer strips with command-backed level/mute controls. Instrument tracks can route to either bus or directly to master, with a post-fader reverb send and visible signal-path labels.
- Added measured waveform peak and RMS readings for instrument tracks, buses, return, and master. Meter subscriptions are disposed when the drawer closes; track rebuilds also dispose drone runtimes and their meters.
- Added optional canonical mixer/send fields without changing checksums for legacy projects. Undo restores absent fields. The arrangement reverb control and mixer send share the same value.
- Applied the same routing, return, and master controls to offline master rendering. Isolated stems remain pre-bus/pre-master outputs; the export UI describes this behavior.
- Added a Render / export workspace reachable from navigation, the phone workspace selector, and the master strip. It supports master or selected instrument stems, WAV/MP3/OGG, sample rate, PCM depth, tail, and optional normalization.
- Submissions verify the cloud revision and canonical checksum, persist an idempotent pending request for retry/reload, poll durable job history, show attempt/error/warning states, allow cancellation, and request renewable artifact download links.

Validation: all 40 desktop/tablet browser tests pass, including six new production cases and accessibility checks. The root unit suite, all 33 studio model tests, TypeScript, package-boundary checks, and optimized production build pass. Offline renderer tests verify routing, sends, return/master mute and level behavior, isolated stems, and unchanged output for default mixer settings. Export API lifecycle tests use mocked platform responses; an authenticated cloud render was not exercised. The refreshed Docker stack has six healthy services, and a browser smoke check at `localhost:3000` verifies fixed bus controls, live audio metering, the master export entry point, and the explicit unavailable-platform state.

Scope: these are the existing fixed production buses, not user-created bus graphs. Audio-clip rendering and custom bus/effect-chain creation remain separate work. Supported device panels and adaptive publication UI were completed in the remaining-task implementation below. Rendering still requires an authenticated platform connection, a synced canonical revision, and the worker project-loader configuration. The local stack alone cannot fetch cloud revisions; the workspace reports that limitation without bypassing authentication.

## Remaining-task implementation (2026-09-23)

- Home now creates UUID-based local projects, searches names, explicitly loads authenticated cloud projects, and confirms local deletion. Deletion removes local revisions and pending sync operations; cloud copies remain available.
- Devices & effects provides keyboard-editable controls for the instruments the engine currently supports. Bypassed devices remain visible and can be enabled again. Custom effect-chain construction remains outside this UI plan.
- Editing requires at least 320 x 480 CSS pixels. Smaller windows show recovery guidance and stop audio; 1024 x 768 or larger is recommended for full editing. Narrow viewports retain the existing workspace selector and scrolling editors.
- Adaptive drafts persist package identity, creation time, states, loops, entry/exit times, cues, transitions, and mapping annotations. Invalid graph/timing edits show validation errors. Renaming/removing states updates dependent references.
- The runtime simulator verifies downloaded audio checksums, decodes actual artifacts, schedules loops and crossfades on the AudioContext clock, and accepts state, intensity, and one-shot stinger events. Stop, workspace exit, and draft changes dispose playback.
- Evidence loading matches the certification report, exact artifact-manifest bytes, job identity, project revision/checksum, and artifact metadata. Evidence is reverified after reopening. This establishes consistency of operator-provided evidence, not an issuer signature.
- Publication requires matching platform artifact locations for all referenced audio. Requests use a content-derived idempotency key; immutable version history and snapshot inspection use the existing platform routes. A real authenticated platform and retained staging evidence are required for deployment acceptance.
- Visual tests compare checked-in Windows Chromium baselines for home, arrangement, piano roll, drums, devices, empty adaptive authoring, and a populated transition/cue editor. Dynamic development chrome is excluded. Other operating systems need separately reviewed baselines; updates should not be accepted blindly.

Validation complete (2026-09-25): the optimized production build and all 46 current studio unit tests pass. Against an isolated production build, all 46 behavior/accessibility browser cases passed; the two visual cases passed on rerun after reviewing and updating six desktop/tablet baselines for the current arrangement, device, and adaptive views. This covers all 48 browser cases. Docker smoke checks passed and all six services are healthy. Preview tests use actual browser audio; publication/version APIs use mocked responses, so live staging publication is not certified. Automated accessibility checks cover contrast, names/roles, and keyboard interaction; manual screen-reader usability review remains an ongoing release check.

## Task checklist

Checked tasks describe features present in the application. Unchecked tasks include incomplete visual refinements as well as features not yet implemented. Generation and cloud workflows still require the separate platform service; publication still requires certification evidence.

### Workstream 1 — Design system foundation

- [x] Dark application palette and semantic color tokens.
- [x] Baseline typography, radius, elevation, focus styling, and responsive breakpoints.
- [x] Shared master meter and reusable committed fader component.
- [x] Accessibility checks for home, generation, and mixer; keyboard mixer controls.
- [x] Extract a consistent shared panel, toolbar, button, tab, badge, slider, and disclosure component library.
- [x] Automated contrast, keyboard, and accessible-name/status coverage across arrangement, note editing, and adaptive authoring.
- [x] Document and enforce the 320 x 480 CSS-pixel minimum editing viewport.

### Workstream 2 — Studio application shell

- [x] Persistent top transport and project-status bar.
- [x] Left workspace navigation rail and central arrangement/editor views.
- [x] Right project inspector and existing device controls in track headers.
- [x] Home/project launcher, local project discovery, and return navigation.
- [x] Bottom track mixer and save/sync status drawer.
- [x] Open/close mixer controls with persisted visibility and focus restoration.
- [x] Workspace navigation on phones when the sidebar is hidden.
- [x] Resizable and independently collapsible navigation/inspector panels, with persisted dimensions.
- [x] Resizable mixer drawer and layout reset controls.

### Workstream 3 — Arrangement and editing surfaces

- [x] Basic bar ruler, track lanes, styled clips, and clip-editor entry points.
- [x] Track volume, pan, mute, and solo controls.
- [x] Functional piano-roll toolbar, piano keyboard display, selection, velocity, snap/grid, and zoom controls.
- [x] Drum lanes, step/velocity editing, transport highlighting, and bar-window navigation.
- [x] Bar ruler with seek controls and playhead driven by authoritative transport ticks.
- [x] Compact track headers and richer MIDI clip content/selection states.
- [x] Piano-roll and drum-sequencer visual refresh with consistent shared controls.
- [x] Keyboard note/step interactions and transport-synchronized playback feedback.

### Workstream 4 — Mixer and production audio

- [x] Track channel strips with command-backed volume/pan/mute/solo.
- [x] Master output section with live peak/RMS metering and clipping indication.
- [x] Existing instrument/device parameter controls in track headers, including reverb send.
- [x] Bus and return channel strips, and editable master controls.
- [x] Real per-track/bus/return metering from the audio engine.
- [x] Dedicated panels for supported instrument/filter/envelope/send controls, with keyboard interaction and undo/redo.
- [x] Send/return controls and routing visualization.
- [x] Master render/export entry point and render-job lifecycle/download UI.

### Workstream 5 — Stage 13 adaptive-audio panels

- [x] Completed-render candidate discovery and editable state list/intensity values.
- [x] Validated draft-manifest preview and initial drone parameter mappings.
- [x] Visible certification/missing-evidence status and disabled publication gate.
- [x] Rich state intensity visualization and transition graph/trigger configuration.
- [x] Loop, entry, exit, and cue-point editor.
- [x] Interactive package playback preview and runtime-event simulator.
- [x] Certification evidence loading/verification in the UI.
- [x] SynaptixPlay publication workflow and immutable version history.

The adaptive workspace persists its draft, validates timing and graph references, verifies uploaded report/manifest consistency, auditions downloaded audio, and exposes publication/version APIs. Real platform authorization, retained staging certification evidence, and platform storage locations remain operational prerequisites. Browser tests use mocked platform endpoints, not a live publication. Live device-parameter mappings remain draft annotations because the current published manifest contract contains rendered audio states.

### Validation and project-home follow-up

- [x] Desktop/tablet shell layout contracts and accessibility checks.
- [x] Home navigation, saved-project reopening, storage errors, and phone-width checks.
- [x] Mixer command persistence, undo/redo, pointer gestures, and keyboard checks.
- [x] Reviewed Windows Chromium screenshot baselines with automatic visual-diff assertions for desktop and tablet.
- [x] Local project creation, cloud project discovery, search, and local project deletion from home.

## Delivery order

1. UI tokens and primitive components — **shared components and initial editor adoption implemented**
2. Studio shell and panel layout — **responsive shell, mobile workspace access, persisted panel dimensions/visibility, and layout reset implemented**
3. Arrangement visual refresh - **compact controls, clip previews/selection, ruler seeking, and transport playhead implemented**
4. Piano roll and drum visual refresh - **shared styling, keyboard editing, and transport feedback implemented**
5. Mixer and production-audio controls — **instrument strips, fixed buses/return, live meters, routing, master controls, and export UI implemented**
6. Adaptive package authoring workspace — **state/timing/transition authoring, audio preview, evidence checks, and publication/version UI implemented**
7. Accessibility, responsiveness, and visual-regression closure — **automated editor/device/adaptive coverage, minimum viewport, and reviewed screenshot comparisons implemented**

## Guardrails

- No direct canonical project mutation from visual components
- Existing commands, history, persistence, and synchronization remain authoritative
- Audio nodes remain browser-only and lifecycle-managed
- New visual work requires keyboard and screen-reader behavior where applicable
- Visual regression tests accompany major shell and editor changes

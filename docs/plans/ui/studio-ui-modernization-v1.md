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
- Project creation, cloud project discovery, search, and project deletion remain future work; this slice exposes existing local projects and the editable demo.

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
| 2 | Transport-driven playhead, compact track headers, richer clip selection; piano-roll/drum visual refresh and keyboard interactions | Queued |
| 3 | Bus/return channels, per-channel metering, routing controls; render/export workflow and artifact-download UI | Queued |

### Increment 1 implementation

- Extracted shared buttons, panels, toolbars, tabs, badges, committed sliders, disclosure controls, meters, and resize handles into `apps/music-studio/components/ui`.
- Adopted the shared controls across the studio, mixer, generation/adaptive actions, and piano-roll/drum toolbars. Specialized canvas rendering remains part of increment 2.
- Added a Layout disclosure with independent navigation/inspector visibility and a reset action.
- Added bounded pointer and keyboard resizing for navigation, inspector, and mixer height, with persisted dimensions separate from project revisions.
- Preserved desktop/tablet defaults; narrower viewports hide side panels and constrain mixer height while retaining the saved larger-screen layout.
- Added layout coverage for persistence, collapse/reset, keyboard focus, pointer sizing, responsive constraints, and malformed/unavailable preferences.

Validation: 24 desktop/tablet browser tests pass with two workers, including eight new layout cases, axe accessibility checks, and existing home/mixer regressions. TypeScript and package-boundary checks pass. The initial eight-worker run hit intermittent home-navigation timing failures; the two-worker run completed without failures.

The optimized production build also passes. The refreshed Docker stack has six healthy services; a browser smoke check at `localhost:3000` verifies panel/mixer resizing, persisted sizes, reset, and mobile disclosure focus.

## Task checklist

Checked tasks describe features present in the application. Unchecked tasks include incomplete visual refinements as well as features not yet implemented. Generation and cloud workflows still require the separate platform service; publication still requires certification evidence.

### Workstream 1 — Design system foundation

- [x] Dark application palette and semantic color tokens.
- [x] Baseline typography, radius, elevation, focus styling, and responsive breakpoints.
- [x] Shared master meter and reusable committed fader component.
- [x] Accessibility checks for home, generation, and mixer; keyboard mixer controls.
- [x] Extract a consistent shared panel, toolbar, button, tab, badge, slider, and disclosure component library.
- [ ] Complete contrast, keyboard, and screen-reader coverage across arrangement, note editing, and adaptive authoring.
- [ ] Document and enforce minimum supported editing viewport dimensions.

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
- [x] Drum lanes, step/velocity editing, and a separate preview cursor.
- [ ] Professional timeline ruler and playhead driven by authoritative transport ticks.
- [ ] Compact track headers and richer MIDI clip content/selection states.
- [ ] Piano-roll and drum-sequencer visual refresh with consistent shared controls.
- [ ] Complete keyboard note/step interactions and transport-synchronized playback feedback.

### Workstream 4 — Mixer and production audio

- [x] Track channel strips with command-backed volume/pan/mute/solo.
- [x] Master output section with live peak/RMS metering and clipping indication.
- [x] Existing instrument/device parameter controls in track headers, including reverb send.
- [ ] Bus and return channel strips, and editable master controls.
- [ ] Real per-track/bus/return metering from the audio engine.
- [ ] Dedicated device/effect panels with complete keyboard interaction support.
- [ ] Send/return controls and routing visualization.
- [ ] Master render/export entry point and render-job lifecycle/download UI.

### Workstream 5 — Stage 13 adaptive-audio panels

- [x] Completed-render candidate discovery and editable state list/intensity values.
- [x] Validated draft-manifest preview and initial drone parameter mappings.
- [x] Visible certification/missing-evidence status and disabled publication gate.
- [ ] Rich state intensity visualization and transition graph/trigger configuration.
- [ ] Loop, entry, exit, and cue-point editor.
- [ ] Interactive package playback preview and runtime-event simulator.
- [ ] Certification evidence loading/verification in the UI.
- [ ] SynaptixPlay publication workflow and immutable version history.

The current adaptive workspace validates a draft manifest and shows a certification gate. It does not yet expose interactive transition playback or load certification evidence; the existence of supporting runtime helpers does not complete those UI tasks.

### Validation and project-home follow-up

- [x] Desktop/tablet shell layout contracts and accessibility checks.
- [x] Home navigation, saved-project reopening, storage errors, and phone-width checks.
- [x] Mixer command persistence, undo/redo, pointer gestures, and keyboard checks.
- [ ] Approved screenshot baselines with automatic visual-diff assertions (current tests capture screenshots and assert layout).
- [ ] Project creation, cloud project discovery, search, and project deletion from home.

## Delivery order

1. UI tokens and primitive components — **shared components and initial editor adoption implemented**
2. Studio shell and panel layout — **responsive shell, mobile workspace access, persisted panel dimensions/visibility, and layout reset implemented**
3. Arrangement visual refresh
4. Piano roll and drum visual refresh
5. Mixer and production-audio controls — **track strips and master metering implemented; buses, routing, and export UI remain**
6. Adaptive package authoring workspace — **draft state authoring implemented; interactive preview and publication remain**
7. Accessibility, responsiveness, and visual-regression closure — **home, generation, and mixer coverage implemented; full editor coverage and screenshot baselines remain**

## Guardrails

- No direct canonical project mutation from visual components
- Existing commands, history, persistence, and synchronization remain authoritative
- Audio nodes remain browser-only and lifecycle-managed
- New visual work requires keyboard and screen-reader behavior where applicable
- Visual regression tests accompany major shell and editor changes

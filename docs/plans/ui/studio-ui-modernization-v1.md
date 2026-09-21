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
- AI generation is represented as an explicitly disabled next-slice entry point until the existing generation APIs are connected to a production form and job lifecycle.

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

## Workstream 1 — Design system foundation

- Dark application palette and semantic color tokens
- Typography, spacing, radius, elevation, and focus tokens
- Reusable panel, toolbar, button, tab, badge, meter, slider, and menu primitives
- Accessible contrast and keyboard-focus requirements
- Responsive desktop breakpoints and minimum supported viewport

## Workstream 2 — Studio application shell

- Persistent top transport and project-status bar
- Left browser/navigation rail
- Central workspace with arrangement/editor tabs
- Right inspector/device panel
- Bottom mixer and status drawer
- Resizable and collapsible panels with persisted layout

## Workstream 3 — Arrangement and editing surfaces

- Professional timeline ruler and playhead
- Track headers with compact mixer controls
- Rich MIDI clip styling and selection states
- Piano-roll toolbar, keyboard, velocity lane, and grid controls
- Drum sequencer lane hierarchy and playback feedback

## Workstream 4 — Mixer and production audio

- Channel strips for track, bus, return, and master channels
- Peak/RMS meters and clipping state
- Device and effect parameter panels
- Send/return controls and routing visualization
- Master section with render/export entry point

## Workstream 5 — Stage 13 adaptive-audio panels

- State list with intensity visualization
- Transition graph and trigger configuration
- Loop, entry, exit, and cue-point editor
- Artifact certification and missing-evidence status
- Package preview controls and runtime-event simulator
- SynaptixPlay publication and version history

Initial authoring slice implemented: the Adaptive States workspace now discovers completed master renders for the active project, assembles named/intensity-tagged states into a validated runtime manifest, previews deterministic next-bar transitions, and exposes the Stage 12 certification gate. Publication is intentionally disabled until a passing staging certification report and matching artifact-manifest checksum can be supplied to the hardened backend publication transition.

## Delivery order

1. UI tokens and primitive components — **foundation implemented; extraction into reusable components remains**
2. Studio shell and panel layout — **initial responsive shell implemented**
3. Arrangement visual refresh
4. Piano roll and drum visual refresh
5. Mixer and production-audio controls
6. Adaptive package authoring workspace
7. Accessibility, responsiveness, and visual-regression closure — **desktop/tablet generation-workspace gate implemented**

## Guardrails

- No direct canonical project mutation from visual components
- Existing commands, history, persistence, and synchronization remain authoritative
- Audio nodes remain browser-only and lifecycle-managed
- New visual work requires keyboard and screen-reader behavior where applicable
- Visual regression tests accompany major shell and editor changes

# Synaptix Music Studio UI Modernization v1

## Goal

Evolve the current functional editor into a coherent production-oriented DAW interface without coupling visual redesign to audio-runtime or synchronization correctness.

The generated concept image is a visual target, not a claim about the current implementation. The redesign will be delivered incrementally behind stable component boundaries.

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

## Delivery order

1. UI tokens and primitive components
2. Studio shell and panel layout
3. Arrangement visual refresh
4. Piano roll and drum visual refresh
5. Mixer and production-audio controls
6. Adaptive package authoring workspace
7. Accessibility, responsiveness, and visual-regression closure

## Guardrails

- No direct canonical project mutation from visual components
- Existing commands, history, persistence, and synchronization remain authoritative
- Audio nodes remain browser-only and lifecycle-managed
- New visual work requires keyboard and screen-reader behavior where applicable
- Visual regression tests accompany major shell and editor changes

# MIDI Synthesis, Clip Visualization, Mixer Commands, and Autosave v1

## Objective

Turn the browser arrangement shell into an audible and locally durable editor by scheduling canonical MIDI notes, rendering clip regions, applying mixer edits through project commands and revisions, and persisting snapshots in IndexedDB.

## Audio engine

`BrowserAudioEngine` rebuilds a Tone.js runtime graph whenever a canonical project is loaded.

- Each instrument track receives a `Tone.Channel` and `Tone.PolySynth`.
- Track volume and pan are copied from the canonical project.
- Mute and solo state determine channel audibility.
- MIDI clip positions and note offsets are converted into transport ticks.
- Scheduled events trigger MIDI pitches with canonical velocity and duration values.
- Reloading or disposing the project clears scheduled events and disposes all audio nodes.

This remains an MVP synthesizer layer. Device-specific synthesis, drum mapping, effects, automation, and AudioWorklet processing remain deferred.

## Arrangement visualization

The studio displays a 16-bar ruler and one lane per canonical track. MIDI clips are positioned and sized using their musical range and display their note count.

## Mixer command boundary

Volume and pan changes create `SetTrackVolumeCommand` and `SetTrackPanCommand` operations. Each operation is committed as a `CommandTransaction`, producing a new checksum-backed project revision.

Mute, solo, and loop edits currently update canonical project state and trigger autosave. They should become dedicated commands in a later command-registry slice.

## IndexedDB autosave

The editor creates `IndexedDbProjectStorage` only in the browser and wraps it with `LocalProjectRepository`.

- Existing project snapshots are loaded during hydration.
- Project changes are saved after a 500 ms debounce.
- Mixer revisions are saved immediately with their revision metadata.
- Storage status is visible in the studio header.
- Schema and checksum validation are inherited from the local project repository.

## Acceptance criteria

- The four canonical instrument tracks produce audible scheduled MIDI.
- Reloading a project clears and rebuilds the scheduling graph without duplicate notes.
- Canonical MIDI clips are visible on the arrangement timeline.
- Volume and pan changes pass through command transactions and project revisions.
- Project snapshots recover from IndexedDB after a browser refresh.
- The standard TypeScript, Python, Rust, and Docker CI lanes remain green.

## Deferred

- Dedicated drum synthesis and General MIDI percussion mapping
- Device-specific instrument factories
- Audio effects and automation
- AudioWorklet processing
- Command-backed mute, solo, and loop changes
- Undo/redo controls in the browser UI
- Autosave conflict handling across multiple browser tabs
- Integration tests using a browser IndexedDB implementation

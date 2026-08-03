# Generation Commands and Browser Transport v1

## Purpose

Convert a validated procedural generation proposal into canonical project mutations, commit the result as one undoable transaction and project revision, and establish the first browser transport and four-track arrangement shell.

## Generation conversion

A generation proposal is validated with `GenerationProposalSchema` and converted into:

1. One generation-state command that applies tempo, section markers, and generator provenance.
2. Four ordinary `AddTrackCommand` instances for drums, bass, harmony, and melody.
3. One `CommandTransaction` with deterministic IDs when a seed and explicit options are supplied.
4. One committed `ProjectRevision` containing parent lineage and a SHA-256 checksum.

Generation proposal v1 only applies to an empty project. This prevents accidental replacement of user-authored tracks until partial regeneration and conflict policies are designed.

## Undo behavior

Undoing the transaction removes all generated tracks and restores the prior tempo map, markers, and generation metadata. The proposal therefore behaves as one user-visible operation.

## Extension command boundary

The existing command union is closed to the initial editor command types. The generation-state adapter is isolated behind a compatibility wrapper so it can participate in `CommandTransaction` without changing existing serialized commands. A later command-system revision should add first-class extensible command registration.

## Browser transport

`BrowserAudioEngine` now implements an `AudioTransport` boundary with:

- explicit initialization after user interaction
- project loading
- project tempo and PPQ synchronization
- play, pause, stop, and seek
- loop enablement and loop-range application
- transport snapshots
- deterministic disposal

Tone.js remains encapsulated inside `@synaptix/daw-engine`.

## Four-track editor shell

The studio route now renders:

- transport controls
- 16-bar ruler
- four instrument lanes
- mute and solo controls
- empty clip-lane placeholders
- project and tempo metadata

This stage does not yet synthesize or schedule MIDI notes. Generated clip rendering, command-backed mixer controls, IndexedDB autosave integration, and playback scheduling are follow-up work.

## Acceptance criteria

- A valid proposal converts into one transaction.
- Applying the transaction creates four canonical instrument tracks.
- Tempo, markers, and provenance are retained in the project.
- Commit output contains a revision and checksum.
- Undo restores the empty project state.
- Browser transport compiles without leaking Tone.js into React components.
- The studio route displays a four-track arrangement shell.
- All TypeScript, Python, Rust, and Docker CI lanes remain green.

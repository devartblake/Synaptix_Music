# Piano Roll v1

## Scope

This slice adds the first detailed MIDI-note editor on top of the shared command and revision system.

## Capabilities

- Open any MIDI clip from the arrangement through an Edit action or double-click.
- Display pitches 36 through 84 with piano-key labels.
- Select one note or add/remove notes from a multi-selection.
- Create notes by double-clicking the grid.
- Move selected notes in time and pitch through pointer gestures.
- Resize selected notes through note-edge handles.
- Delete, quantize, transpose, and change velocity for the selection.
- Choose quarter, eighth, sixteenth, thirty-second, and triplet grids.
- Enable or disable snapping.
- Return to the arrangement without changing the route.

## Command boundary

Every completed edit calls the MIDI commands exported from `@synaptix/command-system/midi`. The existing `EditorCommandHistory` then creates a checksummed revision, writes it to IndexedDB, queues it for platform synchronization, and exposes it through undo/redo.

Transient selection, grid, and pointer-drag state remain editor-only and are not stored in `MusicProject`.

## Deferred

- Marquee selection
- Clipboard operations
- Note audition and panic
- Velocity lanes
- Per-note resize previews
- Horizontal and vertical zoom controls
- Drum-specific step-sequencer presentation

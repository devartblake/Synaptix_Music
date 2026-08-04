# Editor Command Coverage and Browser Undo/Redo v1

## Scope

This slice moves all currently exposed editor mutations through a revision-producing command boundary.

Implemented commands:

- track mute;
- track solo;
- track volume;
- track pan;
- transport loop enabled;
- project tempo.

Each command records its previous and next value, produces a canonical SHA-256-backed project revision, and participates in browser undo and redo.

## Browser history

The studio exposes Undo and Redo buttons and supports:

- `Ctrl+Z` / `Cmd+Z` for undo;
- `Ctrl+Y` for redo;
- `Ctrl+Shift+Z` / `Cmd+Shift+Z` for redo.

Undo and redo create new revisions rather than silently rewinding cloud history. Those revisions are persisted locally and queued through the existing hybrid project synchronization repository.

## Gesture coalescing

Volume and pan sliders preview changes while dragging but commit one command when the pointer is released. This prevents one revision per input event and keeps history meaningful.

## Next slice

The next editor slice adds command-backed MIDI note creation, deletion, movement, resizing, velocity changes, piano-roll selection, grid snapping, and a drum step sequencer.

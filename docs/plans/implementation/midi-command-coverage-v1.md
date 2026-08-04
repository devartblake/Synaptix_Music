# MIDI Command Coverage v1

## Objective

Provide one reversible command boundary shared by the piano roll and drum step sequencer. MIDI editing must never mutate canonical project state directly.

## Package surface

The commands are exported from:

```text
@synaptix/command-system/midi
```

## Commands

- `AddMidiNoteCommand`
- `RemoveMidiNotesCommand`
- `MoveMidiNotesCommand`
- `ResizeMidiNotesCommand`
- `SetMidiVelocityCommand`
- `TransposeMidiNotesCommand`
- `QuantizeMidiNotesCommand`
- `DuplicateMidiNotesCommand`
- `ToggleDrumStepCommand`
- `ClearDrumPatternCommand`
- `SetMidiClipLoopCommand`

## Guarantees

- Commands target one canonical MIDI clip.
- Multi-note operations remain one command and one undo step.
- Undo restores the complete prior note array.
- Duplicate note IDs are rejected.
- Pitch is constrained to MIDI 0–127.
- Velocity is constrained to 1–127.
- Start ticks are nonnegative integers.
- Durations are positive integers.
- Notes cannot extend beyond the clip duration.
- Results are deterministically sorted by start tick and pitch.

## Next slice

The piano-roll foundation should consume these commands through `EditorCommandHistory`, keeping selection, zoom, snapping mode, and drag state outside the canonical project model.

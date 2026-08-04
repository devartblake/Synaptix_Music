# Drum Step Sequencer v1

## Scope

This slice adds a drum-focused MIDI editor that reuses the canonical project model, editor command history, IndexedDB persistence, and platform synchronization pipeline.

## Editor routing

When a MIDI clip belongs to a track with a device type containing `drum`, the clip editor opens the step sequencer. Other MIDI clips continue to open the piano roll.

## Device mappings

The sequencer resolves General MIDI fallback lanes for kick, snare, clap, closed/open hats, and toms. A drum device can override a lane pitch through numeric parameters named `drum-map.<lane-id>` or `drumMap.<lane-id>`.

## Editing behavior

- 16 steps per bar
- One-, two-, and four-bar editing windows
- Command-backed step toggling
- Soft, normal, and accent velocity cycling
- Configurable velocity for newly created steps
- Previous-bar duplication
- Pattern clearing
- Visual playback cursor based on the project tempo

Every completed edit creates one command-history entry and one canonical project revision. The resulting revision is saved locally and queued for platform synchronization by the existing studio runtime.

## Follow-up

The next slice should bind the cursor to the authoritative audio transport, add note audition and panic handling, expand device-provided lane metadata beyond pitch overrides, and harden editor history and integration tests.

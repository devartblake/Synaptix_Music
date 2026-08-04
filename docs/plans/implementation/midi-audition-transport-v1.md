# MIDI Audition and Authoritative Transport v1

## Objective

Move note preview, panic handling, and editor playback cursors behind the DAW engine so React components do not import or manipulate Tone.js directly.

## Implemented boundary

`BrowserAudioEngine` now exposes:

- track-scoped `auditionNote` using the loaded track runtime;
- MIDI pitch, velocity, and audition-duration validation;
- `allNotesOff` panic handling;
- automatic note release on pause and stop;
- authoritative transport snapshots with both seconds and ticks;
- a disposable transport subscription API with a bounded refresh interval.

## Integration sequence

1. Bind the studio transport state to `AudioTransport.subscribe`.
2. Pass authoritative `positionTicks` to the drum sequencer and piano roll.
3. Trigger audition when notes are created, selected, or moved.
4. Throttle drag audition and suppress it while transport playback is active.
5. Add a visible Panic action and invoke `allNotesOff` on editor close, project replacement, and disposal.
6. Add deterministic tests around throttling, transport cursor conversion, and audition request validation.

## Invariants

- UI packages do not import Tone.js.
- Audition targets the selected track runtime and therefore follows its instrument/channel path.
- Panic releases every active synth voice.
- Transport subscriptions are disposable and are cleared with the engine.
- Editor cursor state remains transient and does not create project revisions.

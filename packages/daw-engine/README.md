# @synaptix/daw-engine

Turns a `MusicProject` into sound: live playback in the browser (Tone.js), plus pure, deterministic helpers that the offline render worker shares.

## Entry points

| Import                                   | Runs in              | Contents                                                                                                                                                              |
| ---------------------------------------- | -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@synaptix/daw-engine`                   | Browser              | `BrowserAudioEngine` (transport, playback, preview, meters), `BrowserProductionAudioGraph`, and everything below                                                      |
| `@synaptix/daw-engine/production-audio`  | Browser **and** Node | Instrument catalog and profiles, effective instrument settings, bus/send resolution, frequency-drone render plan. No Tone.js import, so the render worker can use it. |
| `@synaptix/daw-engine/device-parameters` | Both                 | Canonical device parameter IDs, ranges and clamping                                                                                                                   |

## Signal flow

```text
instrument (catalog profile + device parameters)
  → low-pass filter → track channel (volume, pan, mute/solo)
  → music or drums bus ─┐
  → reverb send ─ reverb return ─┤→ master compressor → master → output
```

Frequency drones are continuous oscillators with their own device parameters. They take the same channel and bus path, and have no notes.

## Key rules

- **One source of truth.** `resolveEffectiveInstrumentSettings(track)` defines how a track sounds. Both the browser graph and the offline renderer call it, so live playback and exports stay consistent. Change instrument behaviour there, or in `instrument-catalog.ts`, never in only one path.
- **Instruments come from the catalog.** A track's device type (or, for generic devices, its name) resolves to an `InstrumentDefinition`. `createInstrumentTrack(deviceType)` builds a ready-to-edit track with a starter phrase.
- **Parameters are canonical.** Parameter IDs and ranges live in `device-parameters.ts`, and every read goes through `resolveDeviceParameterValue`, which clamps to range.
- **The graph rebuilds on every project change.** `loadProject` recreates track runtimes, so anything that must outlive an edit uses its own nodes. Note preview (`auditionNote`) plays through a short-lived voice for this reason.

## Adding an instrument

Add an entry to `INSTRUMENT_CATALOG`: device type, label, keywords, profile (oscillator, envelope, filter, reverb send, bus) and a one-bar starter pattern. The catalog tests check uniqueness, slider ranges and track validity. The studio picker and icons pick new entries up automatically; add an icon for any new `kind` in `InstrumentIcon.tsx`.

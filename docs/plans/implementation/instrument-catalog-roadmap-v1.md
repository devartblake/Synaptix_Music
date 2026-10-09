# Instrument Catalog Roadmap v1

**Status:** second slice done · **Created:** 2026-10-09 · **First slice:** done · **Second slice:** done

Every instrument Synaptix Music could add, grouped by how quickly it can ship, with what each
needs. It follows the render-speed plan in [`../../development/dsp-profiling.md`](../../development/dsp-profiling.md):
step 3 there introduces a Rust synthesis kernel, and the instruments here are what that kernel is
for.

## Where we are today

**Catalog:** 12 built-in instruments in `packages/daw-engine/src/instrument-catalog.ts`, plus the
frequency-drone device.

| Instrument      | Oscillator | Notes                                               |
| --------------- | ---------- | --------------------------------------------------- |
| Drum Synth      | sine       | short sine hits; no noise, so no real snare or hats |
| Sub Bass        | sine       |                                                     |
| Bass Synth      | square     |                                                     |
| Lead Synth      | sawtooth   |                                                     |
| Warm Pad        | triangle   |                                                     |
| Pluck           | sawtooth   | short envelope on a saw, not a plucked string       |
| Electric Piano  | sine       |                                                     |
| Organ           | square     |                                                     |
| String Ensemble | sawtooth   |                                                     |
| Brass Section   | sawtooth   |                                                     |
| Bell            | sine       |                                                     |
| Poly Synth      | triangle   |                                                     |

**Voice:** one oscillator → one-pole low-pass → ADSR → velocity, per note.

**Two engines, not one:**

- The **studio preview** plays notes through Tone.js / WebAudio oscillators
  (`browser-production-graph.ts`). WebAudio oscillators are band-limited.
- The **offline renderer** (`services/render-worker/src/offline-renderer.ts`) computes naive
  waveforms sample by sample. Its saw and square waves alias, so exports of the six saw/square
  instruments are slightly harsher than the preview.

**Guard rail:** a golden-checksum test in `offline-renderer.test.ts` renders one track per catalog
instrument and fails if the audio changes. An instrument whose sound changes on purpose (such as
PolyBLEP below) updates those checksums in the same change and says so in the changelog.

## The Rust kernel (what the first slice builds)

- **One voice kernel in Rust** (`crates/dsp`), compiled to:
  - **WASM in an AudioWorklet** for the studio preview. The repo already has an AudioWorklet host
    for plug-ins (`audio-worklet-host.ts`); first-party modules are bundled, never fetched.
  - **WASM (or native) in the render worker** for exports.
- The same code makes the same samples in both places, so **preview and export match**. That's a
  stronger guarantee than today, where they are separate implementations.
- **Determinism:** the kernel uses only operations with bit-identical results on every platform
  (no fused multiply-add differences, no platform `sin`; a shared table or polynomial instead),
  so golden checksums hold across machines.
- **Parity test:** the renderer runs the same golden project through the TypeScript path and the
  kernel while both exist. During migration they must agree (byte-identical where the algorithm
  is unchanged, within a stated tolerance where it changes on purpose).
- `crates/wasm-bindings` already builds a WASM module (today only a gain function), so the build
  plumbing exists.

## Decided first slice

In this order. Each step ships on its own and keeps the golden test green (or updates it
deliberately).

| #   | Step                                                                    | Kind           | Improves or adds                                                                                                               | Why first                                                                                                                        |
| --- | ----------------------------------------------------------------------- | -------------- | ------------------------------------------------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **PolyBLEP oscillators** (band-limited saw, square, pulse)              | Engine upgrade | Removes aliasing from Bass Synth, Lead Synth, Pluck, Organ, String Ensemble, Brass Section; export now sounds like the preview | The smallest real kernel; proves Rust → WASM → AudioWorklet and render worker, and the parity test, on sounds that already exist |
| 2   | **Supersaw / unison** (3–7 detuned saws per note, stereo spread)        | New instrument | **Supersaw Lead**, **Unison Pad**                                                                                              | Multiplies voice cost, which is exactly what the kernel is for                                                                   |
| 3   | **Karplus–Strong pluck** (delay line + loss filter, seeded noise burst) | New instrument | **Plucked String** (guitar, harp, koto colours)                                                                                | Cheap, large quality jump over the saw pluck; introduces seeded noise                                                            |
| 4   | **2-operator FM** (sine modulating sine, envelope on the index)         | New instrument | **FM Bell**, **FM Electric Piano**                                                                                             | Distinctive tone with tiny CPU; establishes per-voice modulation                                                                 |

**Progress**

- Step 1, exports: **done.** `crates/dsp` (`voice.rs`) renders every instrument note in the
  render worker through `packages/dsp-kernel` (the WebAssembly is embedded in `kernel-wasm.ts` and
  checked in; CI rebuilds it and fails if it differs). Saw and square are PolyBLEP; the six
  saw/square instruments changed on purpose and the sine and triangle instruments stayed
  byte-identical. `kernel.test.ts` checks the kernel against a TypeScript reference sample for
  sample.
- Step 1, studio preview: **done.** Instrument tracks and note auditions play through the same
  module in an AudioWorklet (`voice-processor.ts`, `KernelInstrument` in `daw-engine`) instead of
  Tone.js synths. `voice-processor.test.ts` runs the shipped worklet source in 128-frame blocks and
  requires every sample to equal the export's (as 32-bit float); the same check passed in Chromium's
  real audio thread (48,000 samples, none different).

- Step 2, supersaw: **done.** Kernel oscillator `supersaw` (seven PolyBLEP saws at ratios
  0.989–1.011, fixed start phases, centre voice louder) and two catalog instruments, **Supersaw
  Lead** (`synaptix-supersaw`) and **Unison Pad** (`synaptix-unison`). Stereo spread is not done:
  voices are mono until the channel strip, in both preview and export; spreading needs a stereo
  voice path and comes later. Cost: a dense all-supersaw project exports at 5.0× real time
  (master) and 3.5× (stems).

- Step 3, Karplus–Strong: **done.** Kernel oscillator `plucked-string`: a delay line one period
  long, filled with a seeded noise burst (mean removed), fed back through a two-point average and
  a first-order all-pass that tunes the fractional period (in tune to within about 1%), with
  feedback 0.996. Catalog instrument **Plucked String** (`synaptix-guitar`). The noise seed comes
  from the note's id, so the preview and every export pluck the same string. Cost: about the
  same as the default synths (dense project, 9.4× real time master, 5.4× stems).

- Step 4, two-operator FM: **done.** Kernel presets `fm-bell` (modulator ratio 3.5, index 5 →
  0.5) and `fm-piano` (ratio 1, index 2.5 → 0.3, falling faster). The index falls as
  `end + (start − end) / (1 + t · fall)`, a division rather than `exp`, so every platform agrees.
  Catalog instruments **FM Bell** (`synaptix-fm-glass`) and **FM Electric Piano**
  (`synaptix-fm-ep`). An FM voice costs about 1.4× a sine voice. With every track on FM, the
  typical scenario renders at 3.5× real time (master) and 3.3× (stems), against 4.9× and 4.4× for
  the sine Bell. Long releases are what make bell-like instruments expensive: in the dense
  scenario the existing Bell is 1.7× and FM is 1.2×.

**First slice complete.** One Rust kernel now renders exports and plays the preview, sample for
sample. Six existing instruments are band-limited, and five are new (Supersaw Lead, Unison Pad,
Plucked String, FM Bell, FM Electric Piano). No asset work was needed. Next candidates are in the quick-wins table.

Result: the kernel proven in both places, six existing instruments improved, three to five new
instruments, and no asset work.

## Second slice: rhythm and retro

Decided order: **Drum Kit**, then **808 Bass**, then **Chiptune Lead**. No asset work, and no
existing sound changes: Drum Kit is added alongside Drum Synth, which stays byte-identical.

- Step 1, Drum Kit: **done.** Kernel oscillator `drum-kit` (`synaptix-beat-kit`). The note picks
  the drum from the General MIDI map: 36 and below kick, 37 rim, 38/40 snare, 39 clap, 42/44
  closed hat, 46 open hat, 49/52/55/57 crash, 51/53/59 ride, any other note a tom tuned to the
  note. The kernel finds the note from the frequency by comparison only. Each drum combines a
  sine with a pitch drop (integrated sample by sample) and seeded noise through one-pole high-
  and low-pass filters; envelopes are `1 / (1 + rate·t)²`, so there is no `exp`. Peak levels:
  kick, snare, clap and tom about 0.9–1.0; hats and cymbals 0.45–0.65. A second golden test pins
  one hit of every drum, because the catalog golden project only reaches the toms. Cost: about
  the same as Drum Synth (typical project 7.3× real time master, 6.7× stems).
- Step 2, 808 Bass: **done.** Kernel oscillator `808-bass` (`synaptix-boom`; "808" and "bass"
  are other instruments' keywords). A sine whose pitch falls from 2.5× the note onto it
  (`f · (1 + 1.5 / (1 + 35·t))`, integrated sample by sample), through the soft clipper
  `x / (1 + |x|)` at drive 2.2, normalized so peaks reach 1. Cost: typical project 7.7× real
  time master, 7.2× stems.
- Step 3, Chiptune Lead: **done.** Kernel oscillator `pulse-25` (`synaptix-chiptune`): a 25% pulse
  with both edges band-limited (PolyBLEP) and its mean (−0.5) removed, so it sits centred on zero.
  Its spectrum skips every fourth harmonic, which gives the hollow, nasal retro sound. The
  arpeggio stays out of the voice: arpeggios are notes, and belong in the editor (a pattern or arp
  tool), so the piano roll keeps showing what plays. A 12.5% pulse would be another small preset.
  Cost: typical project 14.7× real time master, 12.7× stems.

**Second slice complete.** Three new instruments (Drum Kit, 808 Bass, Chiptune Lead), all through
the same kernel in preview and export, with no change to any existing sound.

## Quick wins (days each)

These reuse the voice model (oscillator → filter → envelope) with small additions. None needs
recorded audio.

| Instrument                 | What it is                             | DSP needed                                                                          | CPU               | Notes                                                                           |
| -------------------------- | -------------------------------------- | ----------------------------------------------------------------------------------- | ----------------- | ------------------------------------------------------------------------------- |
| PolyBLEP saw/square/pulse  | Band-limited versions of today's waves | Polynomial correction at each discontinuity                                         | Low               | First slice, step 1                                                             |
| Supersaw Lead / Unison Pad | 3–7 detuned saws, stereo spread        | Several oscillators per voice, detune, pan                                          | Medium (× voices) | First slice, step 2                                                             |
| Plucked String             | Guitar, harp, koto                     | Karplus–Strong: delay line, averaging loss filter, seeded noise                     | Low               | First slice, step 3                                                             |
| FM Bell, FM Electric Piano | Glassy bells, DX-style keys            | 2-operator FM, index envelope                                                       | Low               | First slice, step 4                                                             |
| Chiptune Lead / Arp        | Retro game sound                       | Pulse with 12.5 / 25 / 50% duty, built-in arpeggio                                  | Low               | Strong fit for a trivia game; needs step 1                                      |
| Synth Drum Kit             | Kick, snare, closed/open hat, clap     | Kick: sine with pitch drop. Snare/hat/clap: filtered seeded noise + short envelopes | Low               | Replaces the sine-only Drum Synth; the render manifest already carries the seed |
| 808 Bass                   | Long boomy bass with a pitch drop      | Sine + pitch envelope + soft clipping                                               | Low               |                                                                                 |
| Sub Bass upgrade           | Cleaner low end                        | Optional saturation and glide                                                       | Low               | Small change to an existing instrument                                          |

## Medium (one to two weeks each)

| Instrument                     | What it is                                | What makes it longer                                                                                                                    |
| ------------------------------ | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| Acid Bass                      | 303-style squelch                         | Resonant state-variable filter with cutoff envelope and accent; coefficients change every sample and must stay stable and deterministic |
| Resonant filter on every synth | A shared upgrade, not one instrument      | Same filter as Acid Bass, exposed as device parameters on all instruments                                                               |
| Drawbar Organ                  | Classic organ registrations               | Additive: 9 sines per note; fine in Rust, heavy in TypeScript                                                                           |
| Modulated Pads                 | Vibrato, filter sweeps, slow movement     | A modulation system (LFOs and envelopes routed to pitch, cutoff, level) that later instruments reuse                                    |
| Wavetable Synth                | Morphing modern tones                     | Needs wavetable files, so it waits on the asset and licensing system (roadmap section 6), plus band-limited table interpolation         |
| Noise and Riser FX             | Sweeps, whooshes, impacts for transitions | Filtered noise with long automated envelopes; useful for adaptive-music transitions                                                     |

## Longer (several weeks each; new subsystems)

| Instrument                                           | What it needs                                                                                                                                                                                                                     |
| ---------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Sampled Piano, Orchestral Strings, Choir, Real Drums | The asset and licensing system first (ingestion, SHA-256 checks, provenance and licences); sample storage and streaming; high-quality resampling (one of the roadmap's named Rust/WASM kernels); velocity layers and round-robins |
| Physical models: Marimba, Mallets, Bowed Strings     | Modal synthesis or waveguides; heavier DSP and tuning by ear                                                                                                                                                                      |
| Vocal / Formant Synth ("ooh", "aah")                 | Formant filter banks and vowel morphing                                                                                                                                                                                           |
| Granular Textures                                    | Sample-based and CPU-heavy (many grains per note); waits on assets                                                                                                                                                                |

## Rules every new instrument follows

- **Same sound in preview and export:** one kernel implementation, run in both places.
- **Deterministic:** any randomness (noise, detune drift) comes from a seed derived from the note
  (`noteSeed(note.id)` in `packages/dsp-kernel`), so a render is reproducible byte for byte and the
  studio preview, which never sees a render manifest, makes the same sound as the export.
- **Golden test:** a new instrument joins the catalog, so the golden-checksum project covers it
  automatically; its checksum is reviewed when added.
- **Profiled:** each slice reruns `npm run profile -w @synaptix/render-worker` and records the
  real-time factor in `dsp-profiling.md`. A slice that drops a typical project below the revisit
  line there needs a performance plan before it ships.
- **Adaptive-music fit:** instruments must render as stems like today, so game packages keep
  working (master and stem renders only).
- **Kids audience:** no new instrument needs special handling, but presets with harsh or very
  loud tones (for example aggressive Acid Bass or Chiptune) get sensible default levels.

## Open questions

- Ship the kernel to the render worker as **WASM** (one artifact, simplest parity) or as a
  **native Node add-on** (faster, two builds)? Start with WASM; revisit only if profiling says so.
- Do improved existing instruments (step 1) keep their names, or appear as new versions so old
  projects render exactly as before? Recommended: change in place, since packages store rendered
  audio, not live synthesis. Note it in the changelog with the updated golden checksums.

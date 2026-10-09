# DSP profiling (Stage 12, step 9)

The roadmap defers Rust/WASM until profiling shows a material bottleneck in a DSP kernel
(resampling, stretching, pitch shifting, filtering, encoding preparation and similar). This
records that profiling for the offline renderer (`services/render-worker`) and the decision it
supports.

## How to run it

```bash
npm run profile -w @synaptix/render-worker            # every scenario
npm run profile -w @synaptix/render-worker -- dense   # one scenario by name
# Per-function self time (open the .cpuprofile in Chrome DevTools, or sum it by function):
node --experimental-transform-types --cpu-prof --cpu-prof-dir=/tmp/render-prof \
  services/render-worker/scripts/profile-render.ts dense
```

`scripts/profile-render.ts` builds synthetic projects heavier than typical studio projects
(overlapping notes on every track, reverb sends, master compressor), renders the master and
every stem at 48 kHz / 24-bit, and times the reverb, compressor and WAV encoder on their own. It
reports the real-time factor: seconds of audio rendered per second of wall time.

| Scenario   | Tracks | Length          | Notes  |
| ---------- | ------ | --------------- | ------ |
| typical    | 8      | 32 bars (66 s)  | 2,048  |
| dense      | 16     | 64 bars (130 s) | 16,384 |
| worst case | 32     | 64 bars (130 s) | 65,536 |

## Results (2026-10-09)

Node 22.22, one core of a shared 4-vCPU Xeon VM that was running another test suite at the same
time, so whole-render times vary by roughly ±15% between runs. The CPU-profile shares and the
encoder before/after comparison (same input, back to back) are the reliable figures.

**Real-time factor** (higher is faster):

| Scenario   | Master render | Stems render | Reverb | Compressor | WAV encode |
| ---------- | ------------- | ------------ | ------ | ---------- | ---------- |
| typical    | 8.8×          | 7.9×         | 55×    | 145×       | 140×       |
| dense      | 4.0×          | 2.9×         | 44×    | 160×       | 138×       |
| worst case | 1.7×          | 1.2×         | 44×    | 155×       | 143×       |

**Where the time goes** (CPU profile, self time, dense scenario, before the encoder change):

| Function                                                | Share       |
| ------------------------------------------------------- | ----------- |
| `renderTrackBuffer` (per-voice synthesis loop)          | 38%         |
| `encodeWav`                                             | 22%         |
| `reverberateChannel`                                    | 8%          |
| `renderProjectOffline` (mixing, master gain)            | 7%          |
| Garbage collection                                      | 7%          |
| `triangle`, `sawtooth`, `oscillatorValue` (oscillators) | 8% together |
| `mixIntoScaled`, `applyCompressor`                      | 5% together |

## Changes made from this

- **WAV encoder.** It allocated a two-element array for every frame and wrote through
  bounds-checked `Buffer` methods. It now writes the little-endian bytes directly. Output is
  byte-identical (checked on a million samples including ±1, out-of-range values, −0, ±Infinity
  and NaN at 16, 24 and 32 bits). It is 1.6× faster at 16-bit, 2.0× at 24-bit and 3.9× at 32-bit,
  which also removes much of the garbage-collection time.

## Step 1: faster synthesis (2026-10-09)

The per-note loop now computes the oscillator and envelope inline (no per-sample function calls
or table lookups) and clips each note to the buffer once instead of checking every sample.
**Output is byte-identical**: 96 renders across all four oscillators, master and stems, matched
the previous renderer byte for byte, and a golden-checksum test (one track per catalog instrument)
now fails on any change to the rendered audio.

Same idle machine, main then this change, back to back:

| Scenario   | Master render | Stems render |
| ---------- | ------------- | ------------ |
| typical    | 8.1× → 11.9×  | 6.8× → 10.1× |
| dense      | 3.6× → 6.4×   | 2.9× → 4.2×  |
| worst case | 1.7× → 3.2×   | 1.1× → 1.9×  |

## Decision

**Rust/WASM stays deferred.** None of the roadmap's candidate kernels is a bottleneck: the
effects and the encoder run 40–160× real time. The cost is synthesis, a per-sample loop over
every voice, so it scales with voices × note length. Even the worst case (32 dense tracks)
exports its stems at 1.2× real time, about 110 s for a 130 s song, which is acceptable for an
asynchronous render job.

If renders need to be faster, in this order:

1. ~~Plain TypeScript in `renderTrackBuffer`: compute the oscillator and envelope inline.~~ Done
   (above). Voices already stop at the end of their release. Reusing track buffers is still open.
2. When a package needs both a master and stems, render them from one synthesis pass (they are
   separate render jobs today, so every track is synthesized twice).
3. Only then a WASM synthesis kernel, re-profiled against step 1.

**Revisit when** a typical project renders below 2× real time, or a stems export of a
production project takes longer than its own length, on the production render-worker hardware.

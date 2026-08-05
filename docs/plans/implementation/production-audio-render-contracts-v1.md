# Production Audio and Render Contracts v1

## Scope

This slice starts Stage 12 with four stable boundaries:

1. device-specific instrument profiles;
2. explicit drum, music, effect-return, and master routing;
3. master peak/RMS metering with clipping evidence;
4. versioned deterministic render request and result contracts.

## Browser production graph

`BrowserProductionAudioGraph` owns the production preview topology:

```text
Instrument → filter → track channel → drum/music bus
                                  ↘ shared reverb return
Drum/music/effect return → master compressor → peak meter → RMS meter → destination
```

Device type is the primary instrument-profile selector. Track names are only a compatibility fallback.

## Render determinism

A render request identifies the exact project revision, project SHA-256 checksum, engine version, seed, tick range, scope, sample format, and requested timestamp. Results contain immutable artifact checksums and fail closed when required evidence is missing.

The browser graph remains a preview/runtime implementation. Production workers must consume the render contract and must not infer mutable editor state.

## Next slices

- Integrate the production graph into `BrowserAudioEngine` scheduling and audition.
- Add command-backed device and effect parameters.
- Add studio master meters and clipping indicators.
- Add render-job API contracts, persistence, queueing, worker leases, and cancellation.
- Add deterministic offline WAV rendering before lossy formats and stems.

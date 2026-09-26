# @synaptix/render-contracts

Zod schemas and pure logic shared by the studio, the render worker and SynaptixPlay for offline rendering and adaptive game-audio packages. All schemas are strict and versioned (`*_CONTRACT_VERSION`). Treat a field change as a contract change.

## Render jobs

| Export                                         | Purpose                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `RenderManifestSchema`                         | What to render: project revision + checksum, scope (master or stems), tick range, output format (WAV/MP3/OGG), optional preview |
| `RenderJobSchema`, `RenderJobStatusSchema`     | Durable job record. Status is one of `queued → running → completed / failed / cancelled / dead_letter`                          |
| `RenderJobEventSchema`                         | Audit trail of job transitions                                                                                                  |
| `RenderJobQueue`                               | In-memory reference queue: idempotent submit, leases, retries                                                                   |
| `computeRetryDelayMs`, `resolveFailureOutcome` | Exponential backoff and the retry/dead-letter decision (5 attempts by default)                                                  |
| `RenderResultSchema`, `RenderArtifactSchema`   | Completed output: artifacts with byte length and SHA-256                                                                        |
| `RenderArtifactManifestSchema`                 | The `artifact-manifest.json` that ties every artifact to its immutable revision, checksum and engine                            |

## Adaptive game audio

| Export                                                                    | Purpose                                                                                                                                     |
| ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `AdaptiveGameAudioManifestSchema`                                         | Published package: states (master + stem artifacts, intensity, loop points, tags), transitions, cue points, and an optional musical `clock` |
| `buildAdaptiveGameAudioManifest`                                          | Builds a manifest from certified render artifacts                                                                                           |
| `selectAdaptiveState`, `findAdaptiveTransition`, `planAdaptiveTransition` | Reference runtime logic: intensity-based state choice, and beat/bar/phrase/cue quantization                                                 |
| `AdaptiveRuntimeEventSchema`                                              | `set-state`, `set-intensity` and `trigger-stinger` events                                                                                   |
| `AdaptiveDeviceParameterMappingSchema`                                    | Draft mapping of device parameters to intensity                                                                                             |

Conventions the game runtime relies on:

- A state tagged `stinger` plus a cue tag (e.g. `correct`, `victory`) is a one-shot stinger, not a looping state.
- States may be addressed by ID or by tag.

The Flutter client mirrors these rules. Keep the two in step.

## Changing a contract

1. Add fields as optional where possible, so existing manifests stay valid.
2. Update every consumer in the same change: studio, render worker, platform contracts, and the SynaptixPlay Flutter models.
3. Add a test that parses both an old manifest and a new one.

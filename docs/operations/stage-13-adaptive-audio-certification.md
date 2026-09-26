# Stage 13 Adaptive Audio Certification and Rollout Runbook

## Status

The Stage 13 runtime is implemented and unit-tested. This runbook turns the Slice 13.7 exit criterion into an executable procedure: a device matrix, functional checks, a long-session soak, a staged rollout, and a kill switch with rollback. A release is certified only when every required matrix row passes and the evidence below is retained.

**Entry gates**

- Stage 12 staging certification has passed (see `stage-12-deployment-certification.md`). Adaptive publication stays disabled until it does.
- One adaptive package has been published from certified renders, and all of its artifacts are finalized. The version shows `active` in the studio's version history.
- The package includes at least two music states with stems, one authored transition, and at least one stinger (studio Role: "Stinger: Correct answer" or similar).

## Configuration reference

| Setting | Where | Effect |
| --- | --- | --- |
| `adaptive_music_enabled` | Admin flags (`/admin/config`) | Kill switch. `false` (default) means the game never starts adaptive music. |
| `adaptive_music_stems_enabled` | Admin flags | `false` forces the master mix on every device (no stem layering). |
| `Music:AdaptiveGamePackageId` | Backend configuration | The package the game plays. It must be a UUID. |
| `Music:AdaptiveArtifactSigningKey`, `Music:AdaptiveArtifactBaseUrl` | Backend secrets/config | Signed delivery. The signing key must be at least 32 characters. |

**Flags are read when the app starts.** Changing a flag affects new sessions, not sessions already running. To stop music in running sessions, revoke the package version (see *Kill switch*).

**Admin flag updates replace the whole flag set.** `PATCH /admin/config` stores the dictionary it receives as the complete set of flags. Always `GET /admin/config` first, change only the adaptive keys, and send the full dictionary back. Sending only the adaptive keys resets every omitted flag to its built-in default, undoing any operator overrides (for example, re-enabling a feature that moderation had switched off). Admin calls need the `X-Admin-Ops-Key` header and an admin-role bearer token.

## Device matrix

Run every **required** row. Record the device model, OS version, app build, and package version for each.

| # | Class | Example devices | Audio route | Required |
| --- | --- | --- | --- | --- |
| 1 | Android flagship | Pixel 8 / Galaxy S23 | Speaker | Yes |
| 2 | Android mid-range | Galaxy A54 / Pixel 6a | Wired or USB-C headphones | Yes |
| 3 | Android low-memory (≤ 3 GB RAM) | Galaxy A14 / Moto G Play | Speaker | Yes |
| 4 | Android tablet | Galaxy Tab S9 / Tab A8 | Bluetooth headphones | Yes |
| 5 | iPhone current | iPhone 15 | Speaker | Yes |
| 6 | iPhone older supported | iPhone 11 / SE (2nd gen) | AirPods (Bluetooth) | Yes |
| 7 | iPad | iPad (10th gen) | Speaker | Yes |
| 8 | Any | Oldest supported OS version | Speaker | Recommended |

Bluetooth rows exist to surface output latency: transitions should still land on musical boundaries as heard.

## Functional checks (per device)

Open **Admin dashboard → Adaptive Audio** (route `/admin/adaptive-audio`, the Adaptive Audio Diagnostics screen) alongside gameplay. Every check below maps to a slice exit criterion.

| Check | How | Pass when |
| --- | --- | --- |
| Load and verify (13.2) | Launch online with the flag on | Rollout `ready`, offline readiness `current`, 0 checksum failures |
| Offline restart (13.2) | Airplane mode, force-quit, relaunch | Music plays; recent events show `offlineFallback` |
| Tamper rejection (13.2) | Staging only: finalize an artifact with a wrong checksum | The download is refused, the checksum-failure counter rises, and no music plays for that version |
| Revocation (13.1/13.2) | Revoke the active version in the studio while the device is offline, then reconnect | Music stops after reconnect; `packageUnavailable` appears (or the previous version plays if the revoke restored one) |
| Quantized transitions (13.3) | Play a match; answer wrong, build a streak, reach the final round | Changes land on beats/bars by ear; missed boundaries stay rare; no cancelled transitions without a newer event |
| Pause and resume (13.3) | Background the app for 30 s mid-match, then return | Music resumes in time; no underrun is logged for the pause |
| Stems and intensity (13.4) | Watch the Mixing card while intensity changes | Layers `Stems`; layers enter and leave without clicks; intensity tracks gameplay |
| Master fallback (13.4) | Set `adaptive_music_stems_enabled=false`, relaunch | Layers `Master mix (fallback)`; music is otherwise unchanged |
| Stingers and ducking (13.5) | Answer correctly several times quickly | One stinger per cooldown window; music dips and fully recovers (duck level back to 100%) |
| Telemetry (13.6) | Inspect analytics for the session | `adaptive_audio_*` events present; no URLs, tokens, or file paths in any attribute |
| Interruptions | Incoming call, alarm, Bluetooth disconnect mid-match | Music pauses and resumes cleanly, and the app does not crash |

## Long-session soak (leak, thermal, battery)

1. Charge the device to at least 80%. Note the battery % and whether the device feels warm.
2. On the diagnostics screen, tap **Start 30-minute soak**. Keep the screen on and the app in the foreground. The harness plays scripted matches through the real gameplay event bus: about 900 events across 20+ matches.
3. At the end, note battery % and temperature again (Android: Settings → Battery; iOS: warm to touch or a thermal warning).
4. Copy the JSON report shown on the screen.

The harness fails the run automatically on any of these:

- an underrun (`playbackUnderrun > 0`);
- a playback failure;
- more than 64 MB of resident-memory growth after the 2-minute warmup;
- a stopped run.

The tester also fails the row if the device shows a thermal warning or throttling, or if battery drain exceeds 8% over the 30 minutes on rows 1, 2, 5 and 7 (12% on low-memory and older devices).

## Staged rollout

| Stage | Scope | Advance when |
| --- | --- | --- |
| 0 | Dev and staging environments, internal testers | Matrix rows 1–7 pass, including the soak |
| 1 | Production with the flag on, stems **off** (`adaptive_music_stems_enabled=false`) | 48 h with playback-failure and underrun rates at or below staging, and no crash-rate change |
| 2 | Production, stems **on** | 7 days within thresholds; master-fallback rate stays low (layer budget is sufficient) |

The flags are global: there is no per-player percentage targeting. Rollout is staged by environment and by stems on/off. Watch the `adaptive_audio_*` analytics events at each stage. Dashboards and alerts are a Slice 13.6 follow-up that needs staging data.

## Kill switch and rollback

**Rollback a bad package (immediate for reconnecting players):** in the studio's version history, enter a reason and select **Revoke version N**. Players are rolled back to the newest unexpired superseded version. With no earlier version, the package becomes unavailable and music stops. Running sessions pick this up when they reconnect or next load, and delivery grants for the revoked version stop working immediately.

**Stop adaptive music everywhere (new sessions):** set `adaptive_music_enabled=false` using the full-dictionary PATCH described above. Sessions started after the change never start adaptive music. Combine it with a revoke to also stop sessions already running.

**Reduce risk without turning music off:** set `adaptive_music_stems_enabled=false` to play master mixes only.

**Demonstrate rollback before Stage 1.** In staging, publish v2, confirm players get v2, revoke v2, and confirm players return to v1. The revoke response reports `restoredVersion: 1`, and the diagnostics screen shows version 1 after reconnect. Retain the evidence.

## Evidence to retain

For each release, store these in the certification record:

- **Per matrix row:** device model, OS, app build, package ID and version, and the functional-check results.
- **Soak:** the JSON report, plus the battery and thermal notes.
- **Rollback:** the rollback demonstration, including the revoke response and a screenshot of the diagnostics screen.
- **Flags:** the flag values at each rollout stage, with timestamps.
- **Telemetry:** a telemetry sample showing redacted attributes.

## Revision date

2026-09-25

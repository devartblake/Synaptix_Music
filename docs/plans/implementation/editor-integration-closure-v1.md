# Editor Integration and Recovery Closure v1

## Status

Implemented in PR #24 after the command-history, piano-roll, drum-sequencer, audition, and transport foundations.

## Scope

This slice closes the detailed MIDI editor milestone by defining the browser-session recovery boundary used around command execution and project persistence.

## Delivered behavior

- Tracks `clean`, `saving`, `unsaved`, and `failed` persistence states.
- Retains the exact pending `PlatformRevisionEnvelope` after a persistence failure.
- Retries persistence without replaying the musical command or producing a second revision.
- Exposes a before-unload guard while a revision is saving, unsaved, or failed.
- Adds project-scoped multi-tab leases through `BroadcastChannel` semantics.
- Places secondary tabs into read-only mode while another active tab owns the same project.
- Releases leases on tab shutdown and expires stale heartbeats.
- Keeps project/revision history resets explicit when loading a different project or remote revision.
- Preserves the command system as the only musical mutation boundary.

## Recovery flow

```text
Editor command
  -> canonical revision
  -> mark saving
  -> local save and sync queue
     -> success: mark clean
     -> failure: retain envelope and mark failed
  -> Retry save
     -> persist the same envelope
     -> do not execute the command again
```

## Multi-tab policy

Only one browser tab should actively edit a project at a time. Tabs exchange `claim`, `heartbeat`, and `release` messages. A competing live claim makes the current tab read-only until the owner releases the project or its heartbeat expires.

## Test coverage

Deterministic tests verify:

- Retrying the exact failed revision without command replay.
- Preserving pending revisions after repeated failures.
- Before-unload warning eligibility.
- Competing-tab read-only transitions.
- Lease release behavior.

## Completed milestone sequence

- PR #17: editor commands and browser undo/redo.
- PR #18: reversible MIDI command coverage.
- PR #19: piano-roll selection, snapping, and editing.
- PR #20: marquee, zoom, duplication, and velocity interaction hardening.
- PR #21: command-backed drum step sequencer.
- PR #22: MIDI audition, panic, and authoritative transport snapshots.
- PR #23: bounded single-flight editor history.
- PR #24: persistence recovery, multi-tab protection, regression tests, and documentation closure.

## Next stage

The next major stage is production audio and rendering hardening: instrument factories, drum-device mappings, effects and buses, metering, deterministic server-side rendering, and export packages for SynaptixPlay game clients.

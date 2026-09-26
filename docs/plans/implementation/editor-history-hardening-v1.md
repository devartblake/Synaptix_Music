# Editor History Hardening v1

## Scope

This slice strengthens the command-backed editor history before broader integration and release testing.

## Implemented

- Configurable bounded undo depth with a default limit of 100 entries.
- Redo invalidation after any new edit.
- Project ownership checks that require history reset before switching projects.
- Explicit reset support for project loads and remote-revision replacement.
- Single-flight execution for execute, undo, and redo operations.
- Stack mutation only after revision/checksum generation succeeds.
- Observable history snapshots with undo depth, redo depth, busy state, project ID, and revision ID.
- Deterministic tests for depth limits, redo invalidation, project switching, and validation failures.

## Remaining integration work

> **Complete (2026-09-25).** The studio now uses `EditorSessionCoordinator`: a Saved/Saving/Not saved indicator, a failed-save banner with Retry (re-saves the same revision without replaying the command), a leave-page warning, and first-tab-wins read-only tabs. History resets on project and cloud-revision loads. Covered by `tests/ui/save-safety.spec.ts`.

The studio client still needs to consume the hardened state by:

1. Disabling mutation controls during active commits.
2. Resetting history with the loaded project or selected cloud revision.
3. Showing an unsaved/persistence-failure state when local save or queueing fails.
4. Retrying persistence without replaying the musical command.
5. Adding before-unload protection for unsaved revisions.
6. Adding multi-tab edit coordination and end-to-end recovery tests.

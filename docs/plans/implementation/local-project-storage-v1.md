# Stage 5 — Local Project Storage v1

## Objective

Persist canonical music projects and immutable revision snapshots locally without coupling editor state to a browser-specific database API.

## Architecture

`@synaptix/project-storage` provides three layers:

1. `LocalProjectStorage` defines the persistence contract.
2. `IndexedDbProjectStorage` provides browser durability using versioned object stores.
3. `LocalProjectRepository` validates, verifies, and translates storage records into canonical `MusicProject` values.

An `InMemoryProjectStorage` adapter supports deterministic application tests and non-browser development.

## Stored data

The `projects` store contains the latest validated snapshot for each project, including searchable metadata and a SHA-256 checksum.

The `revisions` store contains immutable project snapshots keyed by project and revision ID. Revision metadata comes from the Stage 4 command system.

## Integrity rules

- Every save validates against canonical project schema v1.
- Project and revision identifiers must match the embedded snapshot.
- Latest-project loads recompute the canonical SHA-256 checksum.
- Revision saves and loads verify the checksum produced by the command system.
- Unsupported local storage schema versions fail explicitly.
- Returned values are cloned so callers cannot mutate stored records by reference.

## Database lifecycle

The initial IndexedDB schema version creates:

- `projects`, keyed by `projectId`
- `revisions`, keyed by `[projectId, revision.revisionId]`
- a `projectId` revision index for history queries and cascading deletion

Future schema changes must use additive `onupgradeneeded` migrations. Destructive migrations require an export or recovery path.

## Current acceptance scope

- Save and replace the latest project snapshot
- Load with schema and checksum verification
- List projects by most recently updated
- Delete a project and all local revision snapshots
- Store and retrieve immutable revisions
- List revision metadata
- Restore a revision snapshot
- Browser IndexedDB adapter
- In-memory adapter
- Runtime injection of `IDBFactory` for browser testing

## Deferred follow-up

- Debounced autosave orchestration
- Crash-recovery draft journal
- Storage quota reporting and eviction UX
- Import/export archive format
- Multi-tab writer leases and conflict prompts
- Cloud synchronization
- IndexedDB browser integration tests

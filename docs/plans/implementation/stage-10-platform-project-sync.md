# Stage 10 — Platform Project Synchronization

## Objective

Synchronize canonical Synaptix Music projects and immutable revisions between IndexedDB and the SynaptixPlay platform without weakening local-first editing.

## Foundation slice

This slice introduces:

- `PlatformProjectRepository` for project listing, current-project download, and revision upload;
- `PlatformRevisionEnvelope` containing the canonical project snapshot and checksum-backed revision;
- optimistic concurrency through `expectedRevisionId`;
- explicit accepted, already-current, and conflict upload outcomes;
- `ProjectSyncQueue` for offline writes;
- `HybridProjectRepository` for local-first load, local save, queueing, and reconnect drain;
- conflict retention: queued operations are removed only after accepted or already-current results.

## Data flow

```text
Editor transaction
    ↓
Canonical project + revision
    ↓
IndexedDB save
    ↓
Offline sync queue
    ↓
Platform revision upload
    ├── accepted → remove queue item
    ├── already current → remove queue item
    └── conflict → retain queue item and return remote envelope
```

## Required backend contracts

The next backend slice should expose authenticated endpoints for:

- listing accessible music projects;
- retrieving the current canonical project and revision;
- uploading a revision with an idempotency key and expected parent/current revision;
- returning a typed conflict response containing the remote current revision.

## Deferred

- persistent IndexedDB sync queue adapter;
- automatic online/offline event drain;
- conflict-resolution UI;
- project archive/delete/share operations;
- large binary asset synchronization;
- multi-user collaborative merge.

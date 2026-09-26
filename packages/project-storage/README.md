# @synaptix/project-storage

Local-first persistence for projects, and the queue that syncs them to the SynaptixPlay platform.

## Local storage (`@synaptix/project-storage`)

| Export                                              | Purpose                                                                            |
| --------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `IndexedDbProjectStorage`                           | Browser storage (database `synaptix-music`): project records, revisions, summaries |
| `InMemoryProjectStorage`                            | Same contract for tests and non-browser code                                       |
| `LocalProjectRepository`                            | `load(projectId)` / `save(project, revision?)` over a storage                      |
| `createStoredProjectRecord`, `StoredProjectSummary` | Record creation and the home-page project list                                     |
| `ProjectStorageCorruptionError`                     | Thrown when a stored record fails schema or checksum validation                    |

Every stored project is validated against the project schema on read. Corrupt data fails closed rather than loading a half-valid project.

## Platform sync (`@synaptix/project-storage/platform-sync`)

| Export                                                   | Purpose                                                                                                                                                                                                                                      |
| -------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `HybridProjectRepository`                                | `saveAndQueue(envelope, expectedRevisionId, idempotencyKey)` saves locally **and** queues an upload; `drain()` uploads queued revisions; `load()` returns the local copy, or fetches the cloud copy and caches it locally when there is none |
| `IndexedDbProjectSyncQueue` / `InMemoryProjectSyncQueue` | Durable queue of pending uploads                                                                                                                                                                                                             |
| `PlatformProjectRepository`                              | Interface the app implements over the BFF (`HttpPlatformProjectRepository` in the studio)                                                                                                                                                    |
| `PlatformRevisionEnvelope`, `RevisionUploadResult`       | Upload payload and `accepted` / `conflict` outcome                                                                                                                                                                                           |

### Rules that keep sync safe

- **Local first.** A save succeeds locally even when offline; the queue uploads later.
- **Optimistic concurrency.** Each upload names the revision it expects the cloud to hold. A mismatch returns `conflict` (with the remote project) and the operation stays queued until the user chooses "Use cloud" or "Keep mine".
- **Idempotent uploads.** Retries reuse the same idempotency key, so a lost response never creates a duplicate revision.
- **Name the last saved parent.** When a local save fails, the next upload should expect the last revision that actually saved, not the failed one. The studio tracks this in `persistedRevisionRef`.

See `docs/architecture/flows.md` for the end-to-end sync sequence.

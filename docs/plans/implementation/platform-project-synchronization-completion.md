# Platform Project Synchronization Completion

## Scope

Task 3 completes the local-first project synchronization path between the Synaptix Music editor, its Next.js BFF, and the SynaptixPlay backend.

## Runtime flow

1. The editor loads through `HybridProjectRepository`.
2. IndexedDB remains the first local persistence boundary.
3. Missing local projects are downloaded through `HttpPlatformProjectRepository` and persisted locally.
4. Command-produced revisions are saved locally and added to `IndexedDbProjectSyncQueue`.
5. `ProjectSyncCoordinator` drains on startup, browser-online events, a 30-second active interval, and the manual **Sync now** action.
6. Accepted and already-current operations leave the queue.
7. Conflicts remain queued until the user chooses **Use cloud** or **Keep mine**.

## Platform API

The BFF forwards to the authenticated SynaptixPlay routes:

- `GET /api/v1/music/projects`
- `POST /api/v1/music/projects`
- `GET /api/v1/music/projects/{projectId}`
- `PUT /api/v1/music/projects/{projectId}/revisions/{revisionId}`
- `GET /api/v1/music/projects/{projectId}/revisions`
- `GET /api/v1/music/projects/{projectId}/revisions/{revisionId}`
- `POST /api/v1/music/projects/{projectId}/archive`
- `POST /api/v1/music/projects/{projectId}/restore`

## Consistency model

- Project revisions are immutable.
- Uploads use player-scoped idempotency keys.
- `If-Match` carries the expected remote revision.
- The backend updates the project head and inserts the immutable revision in one serializable transaction.
- A stale expected revision returns the complete remote envelope for explicit resolution.

## Offline behavior

Editing never waits for the platform. Network failures leave operations in IndexedDB. Logout or component disposal stops the active coordinator. A later startup or online event resumes queue draining.

## Validation

Synchronization tests cover accepted operations leaving the queue and conflicts remaining queued. Backend contract tests preserve revision lineage, checksums, and stable upload outcomes.

## Follow-up product polish

A dedicated cloud project browser, richer structural diff view, and duplicate-project conflict action can be added as UI enhancements without changing the synchronization protocol.

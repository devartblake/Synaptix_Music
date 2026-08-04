# Project Synchronization Persistence and BFF v1

## Scope

This slice builds on the Stage 10 synchronization foundation by adding a browser-persistent synchronization queue and authenticated Next.js backend-for-frontend routes for project discovery, project download, and optimistic revision upload.

## Browser persistence

`IndexedDbProjectSyncQueue` stores queued revision uploads in a dedicated IndexedDB database. Operations are keyed by operation ID, sorted by creation time, and remain available across browser restarts. Conflicts remain queued until a later conflict-resolution workflow explicitly removes or replaces them.

## Platform BFF routes

The music studio proxies these authenticated platform operations:

- `GET /api/platform/projects`
- `GET /api/platform/projects/{projectId}`
- `PUT /api/platform/projects/{projectId}/revisions/{revisionId}`

The BFF forwards authorization or cookie credentials, correlation IDs, idempotency keys, and `If-Match` optimistic-concurrency metadata. The SynaptixPlay API remains the source of truth for ownership, access grants, current revision IDs, and conflict decisions.

## Reliability

- Local project saves remain authoritative while offline.
- Revision upload operations are persisted before network delivery.
- Accepted and already-current uploads are removed from the queue.
- Conflict responses remain queued and expose the remote revision envelope.
- Network and server failures leave operations queued for retry.

## Deferred

- Corresponding SynaptixPlay backend project synchronization endpoints
- Automatic browser reconnect drain
- Conflict-resolution UI
- Multi-tab queue coordination
- Project archive/delete synchronization

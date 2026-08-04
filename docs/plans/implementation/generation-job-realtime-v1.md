# Generation Job Realtime v1

## Objective

Deliver low-latency music-generation lifecycle updates while keeping durable polling as the recovery authority.

## Flow

1. Submit a generation job through the Next.js BFF.
2. Connect to the authenticated SynaptixPlay `/ws/notify` SignalR hub.
3. Receive `MusicGenerationJobStatusChanged` events from the player's private group.
4. On initial connection and every reconnect, fetch the durable job status through the BFF.
5. Apply a completed proposal with deterministic command, transaction, and revision IDs.
6. Record the applied job ID locally so duplicate events or reconnect recovery cannot mutate the project twice.

## Reliability rules

- PostgreSQL job state is authoritative.
- SignalR events are advisory low-latency notifications.
- Reconnect always performs an immediate durable status fetch.
- Event payloads are validated before use.
- Events for other jobs are ignored.
- Completed proposal application is guarded by an applied-job registry.
- Polling remains available when SignalR is unavailable.

## Configuration

The browser should receive a public authenticated SignalR URL, normally:

```text
https://api.synaptixplay.com/ws/notify
```

Cookie authentication or an access-token factory may be used depending on deployment topology.

## Deferred

- Server-side event sequence numbers and replay cursor.
- Cross-device applied-job registry synchronization.
- Applying generation results to non-empty projects.
- Partial-track and section regeneration conflict resolution.

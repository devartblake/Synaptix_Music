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

Set `NEXT_PUBLIC_SYNAPTIX_SIGNALR_HUB_URL` to that public endpoint. The studio uses `withCredentials: true`, so the browser's secure SynaptixPlay session cookie authenticates the connection without publishing a token in the client bundle. The lower-level subscriber continues to accept an access-token factory for deployment topologies that require bearer authentication.

## Deferred

- Server-side event sequence numbers and replay cursor.
- Cross-device applied-job registry synchronization.
- Partial-track and section regeneration conflict resolution.

## Studio integration update

The UI.3 closure connects each non-terminal workspace job to the configured hub, reports connecting/connected/reconnecting state, applies validated matching events, and reconciles immediately on initial connection and reconnect. Connection failure or closure returns the indicator to durable polling; the polling loop remains active throughout and remains authoritative.

The workspace also restores project jobs after reload, previews completed proposals, and applies a complete generated variation to non-empty projects through a reversible arrangement-replacement editor command. This is intentionally whole-arrangement replacement; partial regeneration remains deferred.

# ADR-0002: Local-First Persistence with Explicit Platform Synchronization

**Status:** Accepted  
**Revision date:** 2026-08-05

## Context

Music editing must remain responsive and usable during network failure. Platform synchronization is still required for multi-device recovery, durable history, and SynaptixPlay integration.

## Decision

Persist every committed revision locally in IndexedDB before platform upload. Represent uploads as durable queue operations. Drain the queue on startup, online recovery, reconnect, manual synchronization, and periodic checks.

Use optimistic concurrency and explicit conflict outcomes. Never silently overwrite local or remote state.

## Consequences

- Editing does not block on network availability.
- Browser restarts preserve pending work.
- Multi-device divergence is surfaced as a user-resolvable conflict.
- Queue ordering, idempotency, and recovery require deterministic identifiers.
- The platform remains the durable cross-device authority without becoming the interactive editing loop.

## Rejected Alternatives

- Cloud-first saves that block the editor
- Last-write-wins conflict handling
- In-memory retry queues that disappear on restart

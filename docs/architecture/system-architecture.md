# Synaptix Music System Architecture

**Status:** Accepted current architecture  
**Revision date:** 2026-08-05

## System Purpose

Synaptix Music produces editable, deterministic music for SynaptixPlay. The system separates browser preview editing from platform control-plane responsibilities and from production rendering.

## Runtime Boundaries

```text
Browser Studio
├── Arrangement, piano roll, drum sequencer, mixer
├── Command history and canonical revisions
├── IndexedDB local project repository
├── Offline synchronization queue
└── BrowserAudioEngine / Tone.js preview graph
         │
         ▼
Next.js BFF
├── Authentication forwarding
├── Correlation and idempotency headers
├── Generation-job routes
└── Project synchronization routes
         │
         ▼
SynaptixPlay .NET API
├── Player identity and authorization
├── Durable generation jobs
├── Durable project/revision persistence
├── Optimistic concurrency and idempotency
├── Audit evidence and lifecycle delivery
└── Future durable render-job control plane
         │
    ┌────┴────────────┐
    ▼                 ▼
Python Generation    Render Workers
├── deterministic    ├── exact manifest/revision
│   composition      ├── verified assets
└── future private   ├── deterministic WAV
    model inference  └── stems and exports
```

## Canonical Project Boundary

`@synaptix/project-model` is the source of truth for musical project state. It must remain independent of React, Next.js, Tone.js, Python web frameworks, and database implementations.

Canonical state includes:

- project and revision identity;
- transport, tempo, and time signatures;
- tracks, clips, notes, devices, and parameters;
- assets and checksums;
- markers and generation provenance.

Transient UI state such as selection, zoom, drag gestures, scroll position, and open panels is not stored in the canonical project unless it changes musical output.

## Command and Revision Boundary

Every meaningful edit is represented by an editor command. A committed command produces:

1. a new canonical project snapshot;
2. a new immutable revision ID;
3. parent revision lineage;
4. command/transaction identifiers;
5. a SHA-256 checksum;
6. local persistence and optional platform queueing.

Undo and redo create new revisions. They do not move a shared cloud pointer backward.

## Local-First Persistence

The browser stores projects and revisions in IndexedDB before platform synchronization. Editing must remain available while offline.

```text
Editor command
→ canonical revision
→ IndexedDB save
→ persistent sync operation
→ background/platform upload
```

Conflicts are explicit. The system does not silently overwrite either local or remote state.

## Browser Audio Architecture

The browser audio engine is a preview implementation. Tone.js is hidden behind `AudioTransport` and production-graph interfaces.

```text
Instrument
→ device filter
→ track channel
→ drum or music bus
↘ shared effect return
→ master compressor
→ peak/RMS meters
→ browser destination
```

The engine supports scheduling, audition, panic, transport snapshots, and meter subscriptions. Canonical device parameters are being mapped into runtime nodes during Stage 12.

## Generation Architecture

The Python generation service accepts typed generation requests and returns deterministic proposals. Proposals are not directly inserted into editor state. The TypeScript conversion layer validates and applies them as one command transaction and revision.

In the production flow, the browser calls the SynaptixPlay platform through the Next.js BFF. The private Python service is dispatched server-to-server.

## Platform Synchronization Architecture

The Next.js BFF preserves authentication, idempotency, correlation, and optimistic concurrency headers. The .NET API owns durable project records, immutable revisions, access control, archive/restore behavior, and revision history.

Upload outcomes are normalized as:

- accepted;
- already current;
- conflict;
- forbidden or validation failure.

## Render Architecture

Browser playback is not accepted as production-render evidence. Production rendering consumes a versioned render manifest containing the exact project revision, checksum, engine version, seed, tick range, scope, and output settings.

```text
Render manifest
→ durable render job
→ leased worker
→ exact project/assets verification
→ offline graph reconstruction
→ WAV artifact
→ checksum and render evidence
→ optional stems/lossy/adaptive packages
```

WAV is the certification format. MP3 and OGG are derivative outputs after deterministic PCM output is validated.

## Data Ownership

| Data | Owner |
|---|---|
| Local editor project/revisions | Browser IndexedDB |
| Durable project metadata/revisions | SynaptixPlay PostgreSQL |
| Durable generation/render jobs | SynaptixPlay PostgreSQL |
| Queue coordination and short-lived leases | Redis or database lease tables, depending on final worker design |
| Large audio artifacts | Object storage |
| Procedural generation execution | Private Python service |
| Browser preview audio | Tone.js/Web Audio |
| Production rendering | Dedicated render worker |

## Security and Reliability Rules

- The browser never receives private service credentials.
- Every write is owner-scoped and idempotent where retries are expected.
- Canonical checksums are verified at persistence and render boundaries.
- Network failure never blocks local editing.
- Render workers must not infer mutable editor state.
- Large binary assets are not stored directly in PostgreSQL.
- Rust/WASM is introduced only for measured DSP bottlenecks.

## Current Gaps

- Runtime mapping for all device/effect parameters
- Durable render-job state machine and worker leases
- Deterministic offline WAV implementation
- Asset ingestion and licensing workflow
- Stem and adaptive export packages
- Production observability and recovery runbooks

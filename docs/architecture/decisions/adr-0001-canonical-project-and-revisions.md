# ADR-0001: Canonical Project Model and Immutable Revisions

**Status:** Accepted  
**Revision date:** 2026-08-05

## Context

Synaptix Music spans TypeScript, Python, Rust, .NET, browser storage, and future render workers. Direct framework-specific models would create incompatible musical state and make deterministic synchronization and rendering unreliable.

## Decision

Use a versioned framework-neutral canonical project model. Every meaningful edit is applied through a command and committed as a new immutable revision with parent lineage and a SHA-256 checksum.

Undo and redo create new revisions rather than moving a shared revision pointer backward.

## Consequences

- Cross-runtime contracts can be validated against the same musical semantics.
- Synchronization and rendering can identify exact immutable inputs.
- Command history and audit evidence remain deterministic.
- Schema evolution requires explicit versioning and migration.
- UI-only state must be kept outside the canonical model.

## Rejected Alternatives

- React component state as the project source of truth
- Mutable database rows without revision snapshots
- Framework-specific TypeScript and Python models with informal mapping

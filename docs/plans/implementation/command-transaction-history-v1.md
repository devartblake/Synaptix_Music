# Command, Transaction, Undo, and Revision System v1

## Status

In implementation.

## Purpose

Establish the framework-neutral editing boundary used by the browser DAW, autosave, generated changes, rendering snapshots, and later collaboration. Components must dispatch commands instead of mutating `MusicProject` objects directly.

## Scope

The first version provides:

- Serializable project commands
- Immutable command execution and reversal
- Atomic multi-command transactions
- Undo and redo history
- Revision lineage
- Deterministic canonical JSON
- SHA-256 project checksums

## Initial commands

- Add and remove track
- Rename track
- Set track volume
- Set track pan
- Add and remove clip
- Move clip
- Resize clip

Commands validate their own input and fail when referenced tracks or clips do not exist. Command execution returns a new project and does not mutate the supplied project.

## Transaction lifecycle

```text
Begin transaction
    ↓
Execute commands sequentially
    ↓
Failure? ── yes ──> Undo completed commands in reverse order
    │
    no
    ↓
Assign revision lineage and timestamp
    ↓
Calculate canonical SHA-256 checksum
    ↓
Push one history entry
```

A pointer drag may preview many positions in UI state, but only the final change should be committed as one command or transaction.

## Revision contract

Each committed transaction produces:

- Revision ID
- Parent revision ID
- Transaction ID
- Command IDs
- Creation timestamp
- Project checksum

IDs and timestamps may be injected by tests, autosave, or synchronization code. Runtime defaults use `crypto.randomUUID()` and the current ISO timestamp.

## Canonical checksums

The command package recursively sorts object keys while preserving array order, encodes the resulting JSON as UTF-8, and calculates SHA-256 with Web Crypto. This keeps the implementation browser-compatible and provides a deterministic integrity value for synchronization and render manifests.

## Undo and redo

History stores immutable before-and-after project snapshots for each committed transaction. This avoids replay ambiguity when commands contain captured inverse state. Executing a new transaction clears the redo stack.

## Generated changes

The Python generation service should eventually return a proposal that the TypeScript client converts into the same command types. Generated work can therefore be accepted, undone, redone, audited, and compared without a separate mutation pathway.

## Deferred

- Command coalescing for continuous controls
- Persistent command journals
- Revision branching and named variants
- Collaborative conflict resolution
- Server-assigned revision IDs
- Automation-lane commands
- MIDI-note editing commands
- Device graph commands

## Acceptance criteria

- Commands operate only on canonical schema v1 types.
- Commands do not import React, Next.js, Tone.js, or Node-only APIs.
- Failed transactions restore the input state.
- One transaction creates one undo entry.
- Undo and redo preserve project revision snapshots.
- Canonical checksums are SHA-256 lowercase hexadecimal values.
- TypeScript build and type-check remain green.

## Revision date

August 3, 2026

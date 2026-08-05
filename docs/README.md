# Synaptix Music Documentation

This directory contains the durable architecture, implementation, development, operations, release, and compliance documentation for Synaptix Music.

## Start Here

- [Root project README](../README.md)
- [Current roadmap and status](roadmap.md)
- [Current system architecture](architecture/system-architecture.md)
- [Architecture decision records](architecture/decisions/README.md)
- [Local development guide](development/local-development.md)
- [Implementation-stage index](plans/implementation/README.md)
- [Alpha foundation release notes](releases/alpha-foundation.md)
- [Project changelog](../CHANGELOG.md)

## Directory Structure

```text
docs/
├── architecture/             # Accepted architecture, diagrams, and ADRs
│   └── decisions/            # Architecture decision records
├── development/              # Setup, testing, coding, and contribution guides
├── operations/               # Deployment, observability, recovery, and runbooks
├── releases/                 # Milestone and release notes
├── legal/                    # Licensing, provenance, and compliance guidance
└── plans/
    ├── product/              # Product scope and user workflows
    ├── architecture/         # Proposed architecture and technology plans
    ├── implementation/       # Sequenced implementation plans and completed slices
    ├── research/             # Evaluations and external-project analysis
    └── archive/              # Superseded plans retained for history
```

## Current Status

Stages 1–11 are complete. Stage 12 — Production Audio and Rendering — is active.

Completed capabilities include the canonical project model, deterministic procedural generation, command-backed editing, undo/redo, piano roll, drum sequencer, browser transport, local/cloud project synchronization, generation-job lifecycle delivery, persistence recovery, multi-tab coordination, production audio profiles, buses, master metering, and deterministic render contracts.

The active Stage 12 work integrates the production graph into the live engine and studio. The remaining production sequence is runtime parameter mapping, durable render jobs, deterministic offline WAV rendering, stems, lossy formats, and adaptive-game export packages.

## Documentation Ownership

| Document | Purpose |
|---|---|
| `README.md` | Repository entry point and local startup |
| `docs/roadmap.md` | Current completion state and ordered remaining work |
| `docs/architecture/system-architecture.md` | Accepted runtime and service boundaries |
| `docs/architecture/decisions/` | Durable architecture decisions and rationale |
| `docs/plans/implementation/README.md` | PR-to-stage implementation ledger |
| `CHANGELOG.md` | User- and developer-visible change history |
| `docs/releases/` | Milestone summaries and release readiness |

## Plan File Convention

Use lowercase kebab-case names. Every active plan should include scope, current status, constraints, ordered work, risks, acceptance criteria, and revision date. When implementation is complete and durable decisions are captured elsewhere, move superseded plans to `docs/plans/archive/` rather than deleting them.

# Synaptix Music Documentation

This directory contains durable project documentation for the Synaptix Music platform.

## Directory Structure

```text
docs/
├── plans/
│   ├── product/          # Product scope, user workflows, and milestone plans
│   ├── architecture/     # Proposed architecture and technology plans
│   ├── implementation/   # Sequenced implementation plans and completed slices
│   ├── research/         # Evaluations, prototypes, and external-project analysis
│   └── archive/          # Superseded plans retained for historical context
├── architecture/         # Accepted architecture decisions and system diagrams
├── development/          # Setup, coding standards, testing, and contribution guides
├── operations/           # Deployment, observability, runbooks, and recovery procedures
└── legal/                # Licensing, asset provenance, and compliance guidance
```

## Start Here

- [Root project README](../README.md)
- [Local development guide](development/local-development.md)
- [Implementation-stage index](plans/implementation/README.md)
- [Project changelog](../CHANGELOG.md)
- [SynaptixPlay openDAW-informed architecture plan](plans/architecture/synaptixplay-opendaw-architecture-plan.md)

## Current Status

Stages 1 through 8 are complete. Stage 9 establishes the SynaptixPlay client/BFF integration boundary and defines the required contracts for authentication, project access, entitlements, credit reservations, durable generation jobs, and normalized errors.

The remaining Stage 9 backend implementation belongs primarily in `TycoonTycoon_Backend`.

## Plan File Convention

Use lowercase kebab-case names:

```text
<subject>-plan.md
<subject>-implementation-plan.md
<subject>-research.md
```

Every active plan should include:

- Purpose and scope
- Current status
- Assumptions and constraints
- Architecture or workflow
- Ordered implementation phases
- Risks and mitigations
- Acceptance criteria
- Revision date

When a plan is completed and its durable decisions have been captured elsewhere, move it to `docs/plans/archive/` rather than deleting it.

## Active Implementation Documents

- [Implementation-stage index](plans/implementation/README.md)
- [Stage 9 platform integration](plans/implementation/stage-9-platform-integration.md)

## Completed Implementation Documents

- [Foundation Slice 1](plans/implementation/foundation-slice-1.md)
- [Canonical Project Schema v1](plans/implementation/canonical-project-schema-v1.md)
- [Command Transaction History v1](plans/implementation/command-transaction-history-v1.md)
- [Local Project Storage v1](plans/implementation/local-project-storage-v1.md)
- [Procedural Generation Service v1](plans/implementation/procedural-generation-service-v1.md)
- [Generation Commands and Transport v1](plans/implementation/generation-commands-and-transport-v1.md)
- [MIDI Synthesis, Clip Visualization, and Autosave v1](plans/implementation/midi-synthesis-clip-autosave-v1.md)

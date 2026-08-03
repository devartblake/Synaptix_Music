# Synaptix Music Documentation

This directory contains durable project documentation for the Synaptix Music platform.

## Directory Structure

```text
docs/
├── plans/
│   ├── product/          # Product scope, user workflows, and milestone plans
│   ├── architecture/     # Proposed architecture and technology plans
│   ├── implementation/   # Sequenced implementation plans and task slices
│   ├── research/         # Evaluations, prototypes, and external-project analysis
│   └── archive/          # Superseded plans retained for historical context
├── architecture/         # Accepted architecture decisions and system diagrams
├── development/          # Setup, coding standards, testing, and contribution guides
├── operations/           # Deployment, observability, runbooks, and recovery procedures
└── legal/                # Licensing, asset provenance, and compliance guidance
```

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

## Current Plans

- [SynaptixPlay openDAW-informed architecture plan](plans/architecture/synaptixplay-opendaw-architecture-plan.md)

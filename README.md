# Synaptix Music

Synaptix Music is the multi-runtime music-production foundation for **SynaptixPlay**. The repository combines a browser-based digital audio workstation, procedural and AI-assisted composition services, deterministic render workers, and a future Rust/WebAssembly DSP layer.

The current codebase is an independently authored starter architecture informed by general browser-DAW patterns. It is intentionally narrower than a general-purpose desktop DAW and is designed around editable generated music, game-oriented loops, stingers, adaptive music states, and creator-safe exports.

## Architecture at a Glance

| Layer | Primary technology | Responsibility |
|---|---|---|
| Studio application | Next.js, React, TypeScript | Product shell, DAW UI, project management, generator controls |
| Browser audio | Tone.js, Web Audio | MVP transport, playback, scheduling, and preview effects |
| DAW domain | Framework-neutral TypeScript packages | Project model, commands, engine abstractions, contracts |
| Generation | Python, FastAPI | Procedural composition, prompt interpretation, analysis, AI inference |
| DSP acceleration | Rust, WebAssembly | Future resampling, stretching, pitch shifting, filters, and render kernels |
| Platform services | Existing SynaptixPlay .NET backend | Identity, billing, credits, entitlements, moderation, and gateway concerns |
| Data and jobs | PostgreSQL, Redis, object storage | Metadata, queues, media, stems, previews, and exports |
| Production rendering | Background workers, FFmpeg | Deterministic WAV, MP3, OGG, stem, and adaptive-game exports |

## Repository Layout

```text
Synaptix_Music/
├── apps/
│   └── music-studio/          # Next.js browser studio
├── packages/                  # Framework-neutral TypeScript DAW libraries
├── services/
│   ├── generation-api/        # Python/FastAPI generation service
│   └── render-worker/         # Server rendering boundary
├── crates/                    # Rust DSP and WASM bindings
├── schemas/                   # Cross-runtime JSON schemas
├── infrastructure/            # Docker and deployment support
├── docs/
│   ├── plans/                 # Strategic, architectural, and implementation plans
│   ├── architecture/          # Durable architecture decisions and diagrams
│   ├── development/           # Setup, standards, testing, and contribution guides
│   ├── operations/            # Deployment, observability, runbooks, and recovery
│   └── legal/                 # Licensing, asset provenance, and compliance guidance
└── .github/                   # CI and repository automation
```

## Documentation Convention

All future plan documents belong under `docs/plans/` rather than the repository root or a generic `plans/` directory.

Use these subfolders as the documentation grows:

```text
docs/plans/product/          # Product scope, user workflows, and milestones
docs/plans/architecture/     # Proposed architecture and technology plans
docs/plans/implementation/   # Sequenced implementation plans and task slices
docs/plans/research/         # Evaluations, prototypes, and external-project analysis
docs/plans/archive/          # Superseded plans retained for history
```

The initial openDAW-informed plan is located at:

- [`docs/plans/architecture/synaptixplay-opendaw-architecture-plan.md`](docs/plans/architecture/synaptixplay-opendaw-architecture-plan.md)

## Development Prerequisites

- Node.js 22 or later
- npm 10 or later
- Python 3.12 or later
- Rust stable
- Docker and Docker Compose

## Initial Setup

```bash
npm install
npm run typecheck
```

Start the Next.js studio:

```bash
npm run dev
```

Start the Python generation API in a separate terminal:

```bash
cd services/generation-api
python -m venv .venv
source .venv/bin/activate
pip install -e .
uvicorn app.main:app --reload --port 8100
```

On Windows PowerShell, activate the virtual environment with:

```powershell
.venv\Scripts\Activate.ps1
```

## Current Development Stage

The repository currently establishes the foundation for Phase 1:

- Monorepo workspace
- Next.js studio shell
- Versioned TypeScript project model
- Browser audio-engine boundary
- Python generation-service boundary
- Rust DSP and WebAssembly workspace
- Cross-runtime schemas
- CI foundation

The next implementation slice should focus on project-schema stabilization, command-based editing, transport lifecycle tests, IndexedDB autosave, and a minimal four-track sequencer.

## Design Rules

- Keep the canonical DAW model independent of React, Next.js, Tone.js, and Python.
- Hide Tone.js behind audio-engine interfaces so individual components can be replaced later.
- Represent meaningful edits as commands to support undo, redo, autosave, collaboration, and generated-change review.
- Exchange versioned JSON contracts between TypeScript, Python, Rust, and .NET services.
- Separate browser preview rendering from deterministic production rendering.
- Introduce Rust/WASM only for measured DSP bottlenecks.
- Keep large audio objects in object storage rather than PostgreSQL.

## Licensing and Clean-Room Development

openDAW is available under AGPL terms or a commercial license. This repository must remain an independently authored implementation based on general architectural patterns, public standards, and license-compatible dependencies.

Do not copy substantial AGPL-licensed openDAW source into a closed-source SynaptixPlay product without legal review or an appropriate commercial agreement.

## Project Status

This repository is an early architecture scaffold. APIs, project schemas, package boundaries, and deployment configuration are expected to evolve as the first playable and editable MVP is implemented.

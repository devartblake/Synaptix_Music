# Synaptix Music

Synaptix Music is the multi-runtime music-production system for **SynaptixPlay**. It combines a browser DAW, deterministic procedural composition, local-first project persistence, SynaptixPlay platform synchronization, production-oriented audio routing, and versioned render contracts.

The product is intentionally narrower than a general-purpose desktop DAW. Its primary use cases are editable generated music, trivia and game-show loops, stingers, adaptive music states, and creator-safe exports.

## Current Capabilities

The repository currently provides:

- A Next.js/React browser studio with arrangement, piano-roll, and drum-step-sequencer workflows
- Command-backed mixer, transport, MIDI-note, quantization, transposition, duplication, and drum-step editing
- Bounded browser undo/redo, keyboard shortcuts, persistence recovery, and multi-tab editing protection
- Tone.js MIDI scheduling, device-aware synthesis, note audition, panic/all-notes-off, and authoritative transport ticks
- A strict canonical project schema shared across TypeScript/Zod, JSON Schema, and Python/Pydantic
- Immutable checksummed project revisions and deterministic command transactions
- IndexedDB local storage, immutable revision history, offline synchronization queueing, and cloud conflict resolution
- SynaptixPlay BFF and .NET platform APIs for durable project synchronization and generation-job lifecycle delivery
- A deterministic Python/FastAPI procedural generator for electronic trivia and game-show arrangements
- Production audio profiles, drum/music buses, shared effects, master compression, peak/RMS metering, and clipping evidence
- Versioned deterministic render request and result contracts
- Reproducible TypeScript, Python, Rust, Docker, and GitHub Actions toolchains

## Architecture at a Glance

| Layer | Primary technology | Responsibility |
|---|---|---|
| Studio application | Next.js, React, TypeScript | Arrangement, piano roll, step sequencer, mixer, project lifecycle, BFF routes |
| Browser audio | Tone.js, Web Audio | Preview transport, scheduling, synthesis, buses, effects, audition, and metering |
| DAW domain | Framework-neutral TypeScript packages | Canonical model, commands, revisions, storage, platform and render contracts |
| Generation | Python, FastAPI | Deterministic procedural composition and future private model inference |
| Platform integration | Next.js BFF and SynaptixPlay .NET API | Identity, authorization, durable jobs, project synchronization, audit, and concurrency |
| DSP acceleration | Rust, WebAssembly | Profile-driven future DSP kernels where measured bottlenecks justify them |
| Production rendering | Background workers and FFmpeg-compatible tooling | Deterministic WAV-first rendering, stems, previews, and adaptive exports |

## Repository Layout

```text
Synaptix_Music/
├── apps/music-studio/          # Next.js browser studio and BFF routes
├── packages/
│   ├── project-model/          # Canonical schema v1
│   ├── command-system/        # Commands, transactions, history, revisions
│   ├── project-storage/       # IndexedDB, hybrid repository, offline sync queue
│   ├── generator-contracts/   # Generation proposals and canonical conversion
│   ├── platform-contracts/    # SynaptixPlay API and lifecycle contracts
│   ├── daw-engine/            # Transport, scheduling, production audio graph
│   ├── render-contracts/      # Deterministic render manifests and results
│   └── shared-types/          # Cross-package shared types
├── services/generation-api/   # Python/FastAPI procedural generator
├── services/render-worker/    # Production-render worker boundary
├── crates/                    # Rust DSP and WASM bindings
├── schemas/                   # Cross-runtime schemas and fixtures
├── infrastructure/            # Docker and deployment support
├── docs/                      # Architecture, ADRs, plans, development, releases
└── .github/                   # CI and repository automation
```

## Supported Toolchain

- Node.js `22.14.0`
- npm `11.4.2`
- Python `3.12.4`
- Rust `1.88.0`
- Docker with Docker Compose

## Run Locally

```bash
git clone https://github.com/devartblake/Synaptix_Music.git
cd Synaptix_Music
npm install --global npm@11.4.2
npm ci --no-audit --no-fund
npm run dev
```

Open:

```text
http://localhost:3000/studio/local-demo
```

For cloud synchronization, configure:

```env
SYNAPTIX_PLATFORM_API_URL=http://localhost:8080
```

The browser studio remains locally usable when the platform API is unavailable. IndexedDB persistence, editing, transport, and preview audio do not require PostgreSQL or Redis.

Start the Python generation API separately when needed:

```bash
cd services/generation-api
python -m venv .venv
source .venv/bin/activate   # Windows: .venv\Scripts\Activate.ps1
python -m pip install -e ".[dev]"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8100
```

See [Local development](docs/development/local-development.md) for the complete Windows, Linux, Docker, and platform setup.

## Validation

```bash
npm run ci
```

CI independently validates TypeScript, Python, Rust/WASM, and Docker Compose.

## Current Development Stage

Stages 1–11 are complete. **Stage 12 — Production Audio and Rendering** is active.

Completed Stage 12 foundation work includes:

- device-specific instrument profiles;
- drum and music buses with shared reverb and master compression;
- peak/RMS metering and clipping evidence;
- versioned deterministic render manifests and result contracts.

The active integration slice connects that graph to `BrowserAudioEngine`, exposes master meters in the studio, and adds command-backed device/effect parameters. Remaining Stage 12 work centers on runtime parameter mapping, durable render jobs, deterministic offline WAV rendering, stems, lossy exports, and adaptive-game packages.

## Documentation

- [Documentation index](docs/README.md)
- [Current roadmap and status](docs/roadmap.md)
- [Current architecture](docs/architecture/system-architecture.md)
- [Architecture decisions](docs/architecture/decisions/README.md)
- [Implementation-stage index](docs/plans/implementation/README.md)
- [Alpha release notes](docs/releases/alpha-foundation.md)
- [Project changelog](CHANGELOG.md)

## Design Rules

- Keep the canonical project model independent of React, Next.js, Tone.js, and Python.
- Hide Tone.js behind audio-engine interfaces.
- Route meaningful edits through commands and immutable revisions.
- Exchange versioned contracts between TypeScript, Python, Rust, and .NET.
- Keep local editing operational when network and platform services are unavailable.
- Separate browser preview playback from deterministic production rendering.
- Introduce Rust/WASM only after profiling identifies a material DSP bottleneck.
- Store large rendered audio objects outside PostgreSQL.

## Licensing and Clean-Room Development

openDAW is available under AGPL terms or a commercial license. Synaptix Music remains an independently authored implementation based on general architectural patterns, public standards, and license-compatible dependencies.

Do not copy substantial AGPL-licensed source into a closed-source SynaptixPlay product without legal review or an appropriate commercial agreement.

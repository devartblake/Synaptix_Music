# Synaptix Music

Synaptix Music is the multi-runtime music-production foundation for **SynaptixPlay**. It combines a browser-based digital audio workstation, deterministic procedural composition, local-first project storage, SynaptixPlay platform integration contracts, and future server-rendering and Rust/WebAssembly DSP capabilities.

The project is intentionally narrower than a general-purpose desktop DAW. Its primary use cases are editable generated music, trivia and game-show loops, stingers, adaptive music states, and creator-safe exports.

## Current Capabilities

The repository currently provides:

- A Next.js/React browser studio with transport controls and a four-track arrangement view
- Tone.js MIDI scheduling, polyphonic synthesis, track channels, volume, pan, mute, and solo
- Generated MIDI clip visualization on a 16-bar timeline
- A strict cross-runtime canonical project schema implemented in TypeScript/Zod, JSON Schema, and Python/Pydantic
- Serializable project commands, atomic transactions, undo/redo history, revisions, lineage, and SHA-256 checksums
- IndexedDB and in-memory project storage with schema and integrity verification
- Debounced local autosave and immutable local revision persistence
- A deterministic Python/FastAPI procedural generator for electronic trivia/game-show arrangements
- Conversion of generation proposals into one undoable canonical command transaction and revision
- A typed SynaptixPlay platform-integration boundary with a Next.js BFF route
- Reproducible TypeScript, Python, Rust, Docker, and GitHub Actions toolchains

## Architecture at a Glance

| Layer | Primary technology | Responsibility |
|---|---|---|
| Studio application | Next.js, React, TypeScript | DAW UI, project lifecycle, browser BFF, generator controls |
| Browser audio | Tone.js, Web Audio | Transport, MIDI scheduling, synthesis, mixing, and preview playback |
| DAW domain | Framework-neutral TypeScript packages | Project model, commands, revisions, storage, and contracts |
| Generation | Python, FastAPI | Deterministic procedural composition and future AI inference |
| Platform integration | Next.js BFF and SynaptixPlay .NET API | Identity, project authorization, entitlements, credits, jobs, and audit |
| DSP acceleration | Rust, WebAssembly | Future resampling, stretching, pitch shifting, filters, and render kernels |
| Data and jobs | PostgreSQL, Redis, object storage | Future server metadata, queues, media, stems, previews, and exports |
| Production rendering | Background workers, FFmpeg | Future deterministic WAV, MP3, OGG, stem, and adaptive-game exports |

## Repository Layout

```text
Synaptix_Music/
├── apps/
│   └── music-studio/          # Next.js browser studio and BFF routes
├── packages/
│   ├── project-model/         # Canonical schema v1
│   ├── command-system/        # Commands, transactions, history, revisions
│   ├── project-storage/       # IndexedDB and in-memory persistence
│   ├── generator-contracts/   # Procedural-generation contracts and conversion
│   ├── platform-contracts/    # SynaptixPlay integration contracts
│   ├── daw-engine/            # Tone.js transport, scheduling, and synthesis
│   └── ...                    # Shared framework-neutral packages
├── services/
│   ├── generation-api/        # Python/FastAPI procedural generator
│   └── render-worker/         # Future server-rendering boundary
├── crates/                    # Rust DSP and WASM bindings
├── schemas/                   # Cross-runtime JSON schemas and fixtures
├── infrastructure/            # Docker and deployment support
├── docs/                      # Architecture, development, and implementation docs
├── CHANGELOG.md               # Consolidated project history
└── .github/                   # CI and repository automation
```

## Supported Toolchain

The repository pins and validates:

- Node.js `22.14.0`
- npm `11.4.2`
- Python `3.12.4`
- Rust `1.88.0`
- Docker with Docker Compose

Using the pinned versions is strongly recommended because CI enforces the npm engine range and the committed lockfile.

## Run Locally

### 1. Clone and configure

```bash
git clone https://github.com/devartblake/Synaptix_Music.git
cd Synaptix_Music
cp .env.example .env.local
```

On Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

For standalone browser development, the SynaptixPlay platform API can remain unavailable until you exercise the Stage 9 generation-job BFF route. The browser DAW, local project storage, and direct Python generator can run independently.

### 2. Install the JavaScript workspace

Use the pinned npm version:

```bash
npm install --global npm@11.4.2
npm ci --no-audit --no-fund
```

### 3. Start the browser studio

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

A studio project route uses:

```text
http://localhost:3000/studio/<project-id>
```

For example:

```text
http://localhost:3000/studio/local-demo
```

The browser will initialize audio only after a user interaction. Project snapshots and revisions are stored locally in IndexedDB.

### 4. Start the Python generation API

In a second terminal:

```bash
cd services/generation-api
python -m venv .venv
```

Linux or macOS:

```bash
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8100
```

Windows PowerShell:

```powershell
.venv\Scripts\Activate.ps1
python -m pip install --upgrade pip
python -m pip install -e ".[dev]"
uvicorn app.main:app --reload --host 127.0.0.1 --port 8100
```

Verify the service:

```text
http://localhost:8100/healthz
http://localhost:8100/readyz
http://localhost:8100/docs
```

### 5. Start local infrastructure when needed

PostgreSQL and Redis are not required for the current local-first editor workflow, but they can be started for platform and job-infrastructure work:

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d --wait
docker compose -f infrastructure/docker/docker-compose.yml ps
```

Stop and remove local volumes:

```bash
docker compose -f infrastructure/docker/docker-compose.yml down --volumes
```

### 6. Configure SynaptixPlay Stage 9 integration

The Next.js BFF uses the server-only variable:

```env
SYNAPTIX_PLATFORM_API_URL=http://localhost:8080
```

The corresponding SynaptixPlay .NET API must eventually provide:

```text
POST /api/music/generation/jobs
GET  /api/music/generation/jobs/{jobId}
GET  /api/music/projects/{projectId}/access
GET  /api/music/entitlements
```

The browser must not call the private Python generation service directly in the integrated production flow.

## Validation Commands

Run the same aggregate TypeScript checks used by CI:

```bash
npm run ci
```

Individual commands:

```bash
npm run check:boundaries
npm run typecheck
npm run build
npm run test
npm run lint
```

Python validation:

```bash
cd services/generation-api
ruff check app tests
ruff format --check app tests
pytest
```

Rust validation:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
rustup target add wasm32-unknown-unknown
cargo check --workspace --target wasm32-unknown-unknown
```

Docker validation:

```bash
docker compose -f infrastructure/docker/docker-compose.yml config --quiet
docker compose -f infrastructure/docker/docker-compose.yml up -d --wait
docker compose -f infrastructure/docker/docker-compose.yml down --volumes
```

## Documentation

- [Documentation index](docs/README.md)
- [Local development guide](docs/development/local-development.md)
- [Implementation-stage index](docs/plans/implementation/README.md)
- [openDAW-informed architecture plan](docs/plans/architecture/synaptixplay-opendaw-architecture-plan.md)
- [Project changelog](CHANGELOG.md)

All plan documents belong under `docs/plans/` and use lowercase kebab-case filenames.

## Design Rules

- Keep the canonical DAW model independent of React, Next.js, Tone.js, and Python.
- Hide Tone.js behind audio-engine interfaces.
- Route meaningful edits through commands and revisions rather than direct UI mutation.
- Exchange versioned contracts between TypeScript, Python, Rust, and .NET services.
- Keep the Python generator private in the production platform flow.
- Separate browser preview playback from future deterministic production rendering.
- Introduce Rust/WASM only for measured DSP bottlenecks.
- Keep large audio objects in object storage rather than PostgreSQL.

## Current Development Stage

Stages 1 through 8 are complete. Stage 9 establishes the SynaptixPlay platform-integration boundary. The remaining Stage 9 backend work belongs primarily in the existing SynaptixPlay .NET repository: authorization, entitlement checks, credit reservations, durable job persistence, audit evidence, and private Python dispatch.

Likely next Synaptix Music slices include generation-job status polling, applying completed platform proposals to the editor, dedicated mute/solo/loop commands, browser undo/redo controls, piano-roll editing, device-specific synth factories, and rendering contracts.

## Licensing and Clean-Room Development

openDAW is available under AGPL terms or a commercial license. This repository must remain an independently authored implementation based on general architectural patterns, public standards, and license-compatible dependencies.

Do not copy substantial AGPL-licensed openDAW source into a closed-source SynaptixPlay product without legal review or an appropriate commercial agreement.

# Local Development Guide

## Purpose

This guide describes how to run and validate the Synaptix Music monorepo on a development workstation.

## Supported Versions

- Node.js 22.14.0
- npm 11.4.2
- Python 3.12.4
- Rust 1.88.0
- Docker with Docker Compose

The pinned version files are:

```text
.nvmrc
.python-version
rust-toolchain.toml
```

## Clone and Configure

```bash
git clone https://github.com/devartblake/Synaptix_Music.git
cd Synaptix_Music
cp .env.example .env.local
```

Windows PowerShell:

```powershell
Copy-Item .env.example .env.local
```

Important variables:

```env
NEXT_PUBLIC_API_BASE_URL=http://localhost:8080
NEXT_PUBLIC_GENERATION_API_URL=http://localhost:8100
SYNAPTIX_PLATFORM_API_URL=http://localhost:8080
DATABASE_URL=postgresql://synaptix:synaptix@localhost:5432/synaptix_music
REDIS_URL=redis://localhost:6379/0
```

`SYNAPTIX_PLATFORM_API_URL` is server-only. Do not expose platform credentials or privileged internal URLs through `NEXT_PUBLIC_*` variables.

## Install TypeScript Dependencies

```bash
npm install --global npm@11.4.2
npm ci --no-audit --no-fund
```

Use `npm ci` for normal development and CI. Run `npm install` only when intentionally changing dependencies, and commit the resulting `package-lock.json`.

## Start the Browser Studio

```bash
npm run dev
```

Open:

```text
http://localhost:3000/studio/local-demo
```

Notes:

- Browser audio starts only after a user gesture.
- The current editor persists projects and revisions in IndexedDB.
- Clearing browser site data removes local-only projects.
- PostgreSQL and Redis are not required for the current local-first editor.

## Start the Generation API

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

Endpoints:

```text
GET  http://localhost:8100/healthz
GET  http://localhost:8100/readyz
POST http://localhost:8100/generation/projects
GET  http://localhost:8100/docs
```

The direct Python endpoint is suitable for generator development. In the integrated SynaptixPlay flow, the browser calls the Next.js BFF and the .NET platform dispatches to Python privately.

## Start PostgreSQL and Redis

```bash
docker compose -f infrastructure/docker/docker-compose.yml up -d --wait
docker compose -f infrastructure/docker/docker-compose.yml ps
```

Stop services:

```bash
docker compose -f infrastructure/docker/docker-compose.yml down
```

Remove services and development volumes:

```bash
docker compose -f infrastructure/docker/docker-compose.yml down --volumes
```

## SynaptixPlay Platform Integration

The Stage 9 BFF route expects a SynaptixPlay API at `SYNAPTIX_PLATFORM_API_URL`.

Expected platform endpoints:

```text
POST /api/music/generation/jobs
GET  /api/music/generation/jobs/{jobId}
GET  /api/music/projects/{projectId}/access
GET  /api/music/entitlements
```

The platform API is responsible for:

- Authentication
- Project authorization
- Entitlement and quota checks
- Credit reservation
- Idempotency
- Durable job persistence
- Audit evidence
- Private generation-service dispatch

Without the .NET endpoint implementation, the local browser DAW and direct Python generator still work, but the Stage 9 BFF submission route will return an upstream configuration or connectivity error.

## Validation

### Full TypeScript lane

```bash
npm run ci
```

### Python

```bash
cd services/generation-api
ruff check app tests
ruff format --check app tests
pytest
```

### Rust

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
rustup target add wasm32-unknown-unknown
cargo check --workspace --target wasm32-unknown-unknown
```

### Docker

```bash
docker compose -f infrastructure/docker/docker-compose.yml config --quiet
docker compose -f infrastructure/docker/docker-compose.yml up -d --wait
docker compose -f infrastructure/docker/docker-compose.yml down --volumes
```

## Common Problems

### `npm ci` reports package-lock drift

A workspace dependency changed without regenerating the lockfile.

```bash
npm install --global npm@11.4.2
npm install --package-lock-only --ignore-scripts --no-audit --no-fund
git add package-lock.json
git commit -m "Synchronize npm lockfile"
```

Then verify:

```bash
npm ci --no-audit --no-fund
```

### npm engine warning

Confirm the versions:

```bash
node --version
npm --version
```

Expected:

```text
v22.14.0
11.4.2
```

### Browser produces no audio

- Click Play or another audio-control button to satisfy browser autoplay rules.
- Confirm the tab is not muted.
- Confirm the project has MIDI clips and notes.
- Check the browser console for AudioContext or cross-origin-isolation errors.

### IndexedDB project cannot be recovered

- Confirm the same browser profile and origin are being used.
- Verify site data was not cleared.
- Inspect the `synaptix-music` IndexedDB database in browser developer tools.
- Corrupted records are rejected by schema and SHA-256 integrity checks.

## Revision Date

2026-08-03

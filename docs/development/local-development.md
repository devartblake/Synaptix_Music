# Local Development Guide

## Purpose

This guide describes how to run and validate the Synaptix Music monorepo on a development workstation.

## Supported Versions

- Node.js 22.14.0
- npm 11.4.2
- Python 3.12.4
- Rust 1.88.0
- Docker with Docker Compose
- FFmpeg 6+ with `libmp3lame` and `libvorbis` for MP3/OGG packaging

The pinned version files are:

```text
.nvmrc
.python-version
rust-toolchain.toml
```

## Run the Local Stack on Docker Desktop

Start Docker Desktop with Linux containers enabled. On Windows, open Git Bash
in the repository, or use WSL with Docker Desktop integration enabled. From
PowerShell, you can invoke Git Bash explicitly:

```powershell
& "C:\Program Files\Git\bin\bash.exe" ./run-local.sh
```

On Git Bash, WSL, macOS, or Linux:

```sh
sh run-local.sh
sh run-local.sh status
sh run-local.sh logs music-studio
sh run-local.sh down
```

The first run downloads images, installs dependencies inside containers, and
waits for service health checks. It copies `infrastructure/docker/local.env.example`
to the ignored `.env.docker` file without overwriting existing settings. This
Docker setup deliberately uses its own settings; host `.env.local` files are
excluded from images. Re-run `sh run-local.sh` after editing code or settings.
The studio uses Next.js development mode; source files are copied into the image,
so host edits require rebuilding rather than updating a live bind mount.

| Service | Default address |
| --- | --- |
| Project home / studio launcher | http://localhost:3000 |
| Generation API docs | http://localhost:8100/docs |
| Render jobs API | http://localhost:8200/render-jobs |
| PostgreSQL | localhost:5432 |
| Redis | localhost:6379 |
| MinIO S3 API | http://localhost:9000 |
| MinIO console | http://localhost:9001 |

Ports and MinIO login credentials are configurable in `.env.docker`. The default
console login is `synaptix_local` / `synaptix_local_password`. Published ports
bind to loopback for local development. PostgreSQL, Redis, and MinIO use named
volumes retained by `down`; studio projects also persist in your browser's
IndexedDB. `sh run-local.sh down --volumes` explicitly deletes the Docker data.
Rust crates are libraries, not standalone services, and need no running container.
The worker uses the network alias `minio.localhost` for object storage so signed
URLs also resolve to loopback in the browser. If your host resolver does not
resolve this name, add `127.0.0.1 minio.localhost` to your hosts file.

**Platform integration:** the SynaptixPlay .NET backend is not included in this
repository. Local editing, playback, persistence, and the direct Python API work
without it. Login, cloud synchronization, integrated generation, and fetching
project revisions for render execution require that separate backend. The render
API starts and applies its database migrations; polling remains disabled until
you configure a platform URL and service token.

To connect a platform running on your computer, set these in `.env.docker` and
run the launcher again. The SynaptixPlay backend's development profile listens on
port **5100**:

```env
SYNAPTIX_PLATFORM_API_URL=http://host.docker.internal:5100
RENDER_WORKER_SERVICE_TOKEN=your-platform-service-token
NEXT_PUBLIC_SYNAPTIX_SIGNALR_HUB_URL=http://localhost:5100/ws/notify
```

The platform must accept connections from Docker Desktop. The backend's launch
profile binds to `localhost` only, which containers may not reach, so start it on
all interfaces from `Synaptix.Backend.Api`:

```bash
dotnet run --urls http://0.0.0.0:5100
```

`RENDER_WORKER_SERVICE_TOKEN` must equal the backend's `ServiceTokens:RenderWorker`
value. Generate one high-entropy value (for example `openssl rand -hex 32`), put it in
`.env.docker`, and store the same value in the backend's development user secrets:

```bash
dotnet user-secrets set "ServiceTokens:RenderWorker" "<the same token>" --project Synaptix.Backend.Api
```

Restart both after changing it. A missing token disables worker polling; a mismatch
makes the backend answer `401`. If the platform is containerized on the same network, it can reach
the generator at `http://generation-api:8100` and worker at `http://render-worker:8200`;
a platform running on the host uses the published localhost ports.

If a port is occupied, change its setting in `.env.docker`. For startup failures,
the launcher prints recent logs; use `sh run-local.sh logs SERVICE` for more detail.
`sh run-local.sh config` validates Compose without requiring a running engine.
The original infrastructure-only command below still starts just PostgreSQL and Redis.

## Configure Host Development

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

The render worker additionally needs `RENDER_WORKER_SERVICE_TOKEN` and complete `RENDER_WORKER_MINIO_*` configuration before its polling loop starts. Use `RENDER_WORKER_FFMPEG_PATH` only when FFmpeg is not on `PATH`.

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

## Mixer routing and export

Open **Mixer** to edit track output, reverb send, Music/Drums bus levels, Reverb return,
and Master level/mute. The meters measure browser audio; use **Play** to see signal.
The reverb send is post-track-fader and independent of the dry bus mute.

Open **Render / export** from the workspace selector, navigation, or Master strip.
Save/sync an edit before submitting a fresh local project. Export checks that the cloud
holds the same revision and checksum, then submits a durable render job. The worker
still needs `SYNAPTIX_PLATFORM_API_URL` and `RENDER_WORKER_SERVICE_TOKEN` to fetch that
revision; a platform session is required by the studio proxy. Authentication/service
errors are shown in the workspace. The local Docker stack does not supply that platform.

Master exports include bus/return/master settings. Stems isolate selected instrument
tracks before bus and master processing. Completed artifacts expose **Get download link**
and **Download** actions; use **Refresh link** if a signed URL expires. A submission that
loses its response can be retried with the same stored request, including after reload.

### Rehearse Stage 12 certification locally

`npm run certify:stage12` reads only the process environment; npm does not load
`.env` files. Put the certification inputs in `.env.local` and let Node load them:

```bash
node --env-file=.env.local scripts/certify-stage12-render-pipeline.mjs
```

```env
RENDER_WORKER_API_URL=http://localhost:8200
STAGE12_CERT_PROJECT_ID=<a project saved to the platform>
STAGE12_CERT_REVISION_ID=<its revision id>
STAGE12_CERT_PROJECT_CHECKSUM_SHA256=<that revision's checksum>
STAGE12_CERT_OUTPUT_FORMAT=ogg
```

The script also checks the **host** FFmpeg for `libmp3lame` and `libvorbis`, even though
the worker container already has both. Install a full build (for example
`winget install Gyan.FFmpeg`) or set `RENDER_WORKER_FFMPEG_PATH`. A local run is a
rehearsal only; Stage 12 closes on the staging run described in
`docs/operations/stage-12-deployment-certification.md`.

## Revision Date

2026-09-25

## Project management, devices, and adaptive packages

The home page can create a named local project, search local/cloud project names, and
load cloud projects using the platform session. **Delete local copy** asks for confirmation
before removing that browser's project, revision history, and pending sync operations.
It does not delete the cloud copy. Avoid editing the same project in another tab during deletion.

**Devices & effects** exposes the supported synth/drone, filter, envelope, and reverb-send
controls. Tab and arrow keys work with project undo/redo. Bypassed devices remain visible.

The minimum editing viewport is **320 × 480 CSS pixels**; **1024 × 768** or larger is
recommended. Below the minimum, editing is hidden, audio stops, and guidance links back
to Projects. Editor grids scroll inside their panels on small screens.

In **Adaptive states**, add completed master renders of the same immutable revision.
Configure state intensity, loop start/end, entry/exit, named cues, and transition triggers.
The first state is the default. Drafts are saved in this browser separately from the canonical
project. Renaming and removing states updates their transition and cue references.

**Load preview audio** obtains signed URLs, checks audio byte lengths and SHA-256,
and decodes the full masters. The storage server must allow browser CORS downloads.
**Play preview** uses real audio, loop/entry timing, and scheduled crossfades. Send state
or intensity events, or audition a selected master as a one-shot stinger. Stop or leave the
workspace to dispose playback. Editing a draft also invalidates its loaded preview.
Preview currently supports up to 100 MB per artifact and uses the project's first tempo
and time signature. Device mappings remain draft annotations, outside the audio manifest.

For each selected render, load its Stage 12 certification report and the exact original
`artifact-manifest.json` bytes. **Verify evidence** checks identity, revision, checksum,
artifact metadata, and the required certified preview. These are operator-supplied reports;
matching them establishes consistency, not issuer authenticity. Reopening requires revalidation.

Publication also needs an operator-supplied JSON array of platform artifact locations:

```json
[
  {
    "artifactId": "<UUID from the render job>",
    "storageKey": "<platform-owned object key>",
    "mediaType": "audio/wav",
    "checksumSha256": "<64 lowercase hex characters>",
    "byteLength": 123456
  }
]
```

Include every master/stem referenced by the draft. Storage keys cannot be inferred from
signed download URLs. The platform validates authorization and creates immutable versions.
Retries use the same content-derived idempotency key; inspect immutable snapshots in version
history. A UUID cloud project and configured authenticated platform are required. Local-demo
projects can author drafts, but are not valid platform publication targets.

## Visual and accessibility regression checks

Run `npm run test:ui --workspace=@synaptix/music-studio` for behavior, keyboard, axe, and
screenshot assertions. Checked-in baselines use Windows Chromium at desktop/tablet sizes.
To intentionally revise them from `apps/music-studio`, run
`node ../../node_modules/@playwright/test/cli.js test tests/ui/visual.spec.ts tests/ui/remaining.spec.ts --update-snapshots`,
review each changed image, and rerun without the update flag. Other operating systems need
their own reviewed baseline set. Automated role/name/contrast checks supplement manual
screen-reader usability review; they do not substitute for it.

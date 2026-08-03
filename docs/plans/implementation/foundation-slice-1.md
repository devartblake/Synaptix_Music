# Foundation Slice 1

## Goal

Make the TypeScript, Python, Rust, Docker, and GitHub Actions toolchains executable from a clean checkout before feature development begins.

## Implemented baseline

- Pin supported Node, npm, Python, and Rust versions.
- Define root build, type-check, test, boundary, Docker, and CI commands.
- Validate framework-neutral package boundaries.
- Pin Python runtime dependencies and configure Ruff and Pytest.
- Add generation API health and readiness smoke tests.
- Pin Docker service images and add health checks and persistent development volumes.
- Validate Rust formatting, Clippy, unit tests, and the WebAssembly target.
- Split GitHub Actions into independent TypeScript, Python, Rust, and Docker jobs.

## Clean-checkout validation

```bash
npm ci --no-audit --no-fund
npm run ci

cd services/generation-api
python -m venv .venv
python -m pip install -e ".[dev]"
ruff check app tests
ruff format --check app tests
pytest

cd ../..
cargo fmt --all --check
cargo clippy --workspace --all-targets -- -D warnings
cargo test --workspace
cargo check --workspace --target wasm32-unknown-unknown

docker compose -f infrastructure/docker/docker-compose.yml config --quiet
docker compose -f infrastructure/docker/docker-compose.yml up -d --wait
docker compose -f infrastructure/docker/docker-compose.yml down --volumes
```

## Exit criteria

- All four GitHub Actions jobs are green.
- A clean checkout passes every validation command above.
- The root npm lockfile is committed and CI uses `npm ci`.
- No framework dependency is introduced into reusable `packages/*` modules.

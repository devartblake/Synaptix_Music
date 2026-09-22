#!/bin/sh
# Run with `sh run-local.sh` from Git Bash, WSL, macOS, or Linux.
set -eu

ROOT=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
ENV_FILE="$ROOT/.env.docker"

usage() {
  cat <<'EOF'
Usage: sh run-local.sh [up|down|logs|status|config|help] [arguments...]

  up      Build and start the local stack, waiting for health checks (default).
  down    Stop the stack. Named volumes are preserved.
  logs    Follow logs; optionally specify a service, e.g. logs music-studio.
  status  Show container status.
  config  Validate the Compose configuration.

Requires Docker Desktop running Linux containers and Docker Compose v2+.
Settings are copied to .env.docker on first use. Existing files are preserved.
Re-run up after changing source code or settings to rebuild/recreate services.
EOF
}

ACTION=${1:-up}
if [ "$#" -gt 0 ]; then shift; fi
case "$ACTION" in
  help|-h|--help) usage; exit 0 ;;
  up|down|logs|status|config) ;;
  *) usage >&2; exit 2 ;;
esac

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker was not found. Install Docker Desktop and reopen your terminal." >&2
  exit 1
fi
if ! docker compose version >/dev/null 2>&1; then
  echo "Docker Compose v2+ is required. Update Docker Desktop." >&2
  exit 1
fi
if [ "$ACTION" != config ]; then
  if ! docker info >/dev/null 2>&1; then
    echo "Docker is not running. Start Docker Desktop, wait until it is ready, then retry." >&2
    exit 1
  fi
  if [ "$(docker info --format '{{.OSType}}')" != linux ]; then
    echo "Switch Docker Desktop to Linux containers, then retry." >&2
    exit 1
  fi
fi

if [ ! -f "$ENV_FILE" ]; then
  cp "$ROOT/infrastructure/docker/local.env.example" "$ENV_FILE"
  echo "Created .env.docker with local development defaults."
fi

compose() {
  docker compose --project-name synaptix-music --env-file "$ENV_FILE" \
    -f "$ROOT/infrastructure/docker/docker-compose.yml" \
    -f "$ROOT/infrastructure/docker/docker-compose.local.yml" "$@"
}

case "$ACTION" in
  up)
    compose config --quiet
    if ! compose up --build --detach --wait --wait-timeout 180 "$@"; then
      compose ps --all
      compose logs --tail 60
      echo "Startup failed. Review the logs above, fix the issue, and run this script again." >&2
      exit 1
    fi
    compose ps
    cat <<'EOF'

Synaptix Music is running. Default URLs (ports can be changed in .env.docker):
  Project home:    http://localhost:3000
  Generation docs: http://localhost:8100/docs
  Render jobs:     http://localhost:8200/render-jobs
  MinIO console:   http://localhost:9001

Cloud sync, integrated generation, and render execution require the separate
SynaptixPlay platform API. See docs/development/local-development.md.
EOF
    ;;
  down) compose down "$@" ;;
  logs) compose logs --follow "$@" ;;
  status) compose ps "$@" ;;
  config) compose config --quiet "$@" ;;
esac

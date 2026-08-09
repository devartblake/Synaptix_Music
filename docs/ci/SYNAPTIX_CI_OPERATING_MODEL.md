# Synaptix CI Operating Model

**Applies to:** `Synaptix_Music`

## Goals

- Keep TypeScript, Python, Rust, and Docker validation independent so an unrelated stack does not consume runner time.
- Cancel superseded PR runs.
- Keep downstream stacked PRs Draft until they become merge candidates.
- Allow trusted internal Synaptix servers to supplement GitHub-hosted Actions runners.

## Path-aware CI

The main CI workflow has a lightweight `changes` job. On pull requests it compares the PR base/head SHAs and enables only affected stacks:

- **TypeScript:** `apps/`, `packages/`, npm/turbo/TypeScript configuration, and shared scripts.
- **Python:** `services/generation-api/` and Python toolchain configuration.
- **Rust:** `crates/`, `Cargo.toml`, and `Cargo.lock`.
- **Docker:** infrastructure plus application/service/package/crate changes that can affect the compose environment.

A change to `.github/workflows/ci.yml` deliberately enables every stack so workflow edits certify the whole pipeline.

Pushes to `main` continue to run all stacks as post-merge certification.

## Stacked PR policy

1. Current merge candidate: non-draft, affected CI stacks run.
2. Next implementation: Draft, only lightweight scope detection runs.
3. Prepared follow-up: Draft, no expensive stack validation until promoted.
4. After the predecessor merges, rebase/retarget once, mark Ready for Review, and run affected full CI once.

## Internal runners

Jobs use:

```yaml
runs-on: ${{ fromJSON(vars.SYNAPTIX_MUSIC_RUNNER_LABELS || vars.SYNAPTIX_CI_RUNNER_LABELS || '["ubuntu-latest"]') }}
```

With no repository variable configured, GitHub-hosted Ubuntu remains the default.

A trusted internal music runner can be selected with a repository variable such as:

```json
["self-hosted", "linux", "x64", "synaptix-ci", "music"]
```

The runner image should provide Docker/Compose and enough disk/CPU/RAM for Node, Python, Rust, and local service containers. Toolchain setup actions still pin the repository versions.

## Security requirements

- Run CI on dedicated VMs/hosts, never directly on production API/database/audio-generation servers.
- Place runners on a separate CI VLAN or firewall zone with no direct production database access.
- Prefer ephemeral/rebuilt runners and clean the workspace after each job.
- Permit outbound HTTPS to GitHub; avoid exposing inbound management ports publicly.
- Do not send untrusted fork PRs to internal runners.
- Use separate runner labels/pools for release/deployment if those workloads are later moved internally.
- Keep signing keys, production storage credentials, and deployment tokens out of ordinary build runners.

## Cost controls

- `cancel-in-progress` prevents superseded PR commits from continuing to consume time.
- Draft stacked PRs do not run expensive stacks.
- Path detection prevents Python/Rust/Docker jobs from running for TypeScript-only changes and vice versa.
- GitHub-hosted runners remain available as automatic fallback until the internal pool is ready.

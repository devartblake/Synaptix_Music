# Contributing to Synaptix Music

## Before you open a pull request

1. **Run the checks.** `npm run ci` runs package boundaries, typecheck, build and unit tests. For studio UI changes, also run the browser suite from `apps/music-studio`: `npx playwright test`.
2. **Change state through commands.** Project changes go through a command in `@synaptix/command-system` with a working `undo`. Never mutate a `MusicProject` directly (see `packages/command-system/README.md`).
3. **Treat contracts as contracts.** Schema changes in `render-contracts` or `platform-contracts` must stay backward compatible or be versioned, and must update every consumer in the same change. That includes the SynaptixPlay backend and Flutter client.
4. **Review visual changes.** When a Playwright screenshot baseline changes, open the new image and confirm the difference is intended before committing it. Never regenerate baselines blindly.

## Documentation is part of the change

Every feature or behaviour change updates, in the same pull request:

- **`CHANGELOG.md`:** one entry under _Unreleased_ describing the user-visible change.
- **The plan or status document it advances:** tick completed items and move finished work out of "Remaining" or "Next slice" sections. Stage progress lives in `docs/roadmap.md` and `docs/plans/implementation/README.md`.
- **Developer guides:** `docs/development/local-development.md` for setup, ports or environment changes, and the relevant `packages/*/README.md` for API changes.
- **Operations runbooks:** `docs/operations/` when deployment, configuration or certification steps change.
- **Diagrams:** `docs/architecture/flows.md` when a cross-service flow changes.

A pull request that changes behaviour without these updates is not ready for review.

## Secrets and local configuration

- Never commit `.env`, `.env.local`, `.env.docker` or any real credential. Templates (`.env.example`, `infrastructure/docker/local.env.example`) hold placeholders only.
- Local backend secrets belong in `dotnet user-secrets` (see the local development guide).

# Synaptix Music

Starter monorepo for the SynaptixPlay browser DAW, music-generation services, render workers, and future Rust/WASM DSP.

## Layout

- `apps/music-studio`: Next.js browser studio
- `packages`: framework-neutral TypeScript DAW libraries
- `services/generation-api`: Python/FastAPI generator
- `services/render-worker`: server rendering placeholder
- `crates`: Rust DSP and WASM bindings
- `schemas`: cross-runtime schemas
- `infrastructure`: local deployment support
- `plans`: architecture documents

## Important

This is an independently authored scaffold. Do not copy AGPL-licensed openDAW code into a closed-source product without legal review or an appropriate commercial license.

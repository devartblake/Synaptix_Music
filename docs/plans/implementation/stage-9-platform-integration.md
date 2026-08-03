# Stage 9 — SynaptixPlay Platform Integration

## Status

**Synaptix Music boundary complete in PR #9.** The remaining backend implementation belongs primarily in `TycoonTycoon_Backend`.

## Objective

Connect the music studio to the existing SynaptixPlay platform without exposing the Python generation service directly to browsers.

## Request Path

```text
Browser studio
  -> Next.js BFF route
  -> SynaptixPlay .NET API
  -> authorize project access
  -> validate entitlements and quotas
  -> reserve generation credits
  -> create audited generation job
  -> dispatch internal Python generation work
```

## Implemented Synaptix Music Boundary

- Shared Zod contracts for platform users, entitlements, project access, credit reservations, generation jobs, and platform errors.
- A typed browser client for submitting generation jobs.
- A Next.js server route that validates requests and forwards authentication, correlation, and idempotency headers.
- Strict response validation before platform data reaches the editor.
- Server-only `SYNAPTIX_PLATFORM_API_URL` configuration.
- npm workspace and lockfile integration for `@synaptix/platform-contracts`.
- Local-development documentation for standalone and platform-integrated execution.

## Security and Reliability Rules

- The browser never calls the Python service directly in the production platform flow.
- Authentication remains owned by SynaptixPlay.
- Every write requires an idempotency key and correlation ID.
- The platform API owns project authorization and generation-credit reservation.
- The expected project revision is included to prevent generation against stale editor state.
- Upstream errors are normalized into a typed platform error contract.
- Cookies or authorization headers are forwarded only to the configured platform API.
- The platform URL is server-only and must not use a `NEXT_PUBLIC_` prefix.

## Expected .NET Endpoints

```text
POST /api/music/generation/jobs
GET  /api/music/generation/jobs/{jobId}
GET  /api/music/projects/{projectId}/access
GET  /api/music/entitlements
```

The corresponding .NET handlers should own:

- Authentication and project authorization
- Entitlement and quota evaluation
- Credit reservation and release
- Idempotency enforcement
- Durable generation-job persistence
- Audit evidence
- Private Python dispatch
- Retry, failure, and cancellation transitions

## Local Development

Configure:

```env
SYNAPTIX_PLATFORM_API_URL=http://localhost:8080
```

The standalone browser DAW and direct Python generator can run without the .NET platform. The BFF generation-job route requires the configured .NET API.

See [Local Development](../../development/local-development.md).

## Acceptance Criteria

- Cross-runtime platform payloads are versioned and schema validated.
- Unauthenticated BFF requests return a normalized 401 response.
- Invalid generation requests are rejected before reaching the platform API.
- Idempotency and correlation headers are preserved.
- The platform URL is not exposed through a `NEXT_PUBLIC_` environment variable.
- The Python generation endpoint remains private in the integrated flow.
- The new workspace is represented in `package-lock.json` and strict `npm ci` passes.
- TypeScript, Python, Rust, and Docker CI lanes remain green.

## Deferred Follow-Up

- Auth-provider-specific session resolution.
- Generation-job polling, SSE, or SignalR updates.
- .NET endpoint implementation.
- Durable job and credit-reservation persistence.
- Project upload and synchronization to the platform database.
- Applying completed platform proposals through command/revision history.
- Render authorization and storage quota enforcement.

## Revision Date

2026-08-03

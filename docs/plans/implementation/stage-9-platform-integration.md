# Stage 9 — SynaptixPlay Platform Integration

## Objective

Connect the music studio to the existing SynaptixPlay platform without exposing the Python generation service directly to browsers.

## Request path

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

## Implemented boundary

- Shared Zod contracts for platform users, entitlements, project access, credit reservations, generation jobs, and platform errors.
- A typed browser client for submitting generation jobs.
- A Next.js server route that validates requests and forwards authentication, correlation, and idempotency headers.
- Strict response validation before platform data reaches the editor.
- Server-only `SYNAPTIX_PLATFORM_API_URL` configuration.

## Security and reliability rules

- The browser never calls the Python service directly.
- Authentication remains owned by SynaptixPlay.
- Every write requires an idempotency key and correlation ID.
- The platform API owns project authorization and generation-credit reservation.
- The expected project revision is included to prevent generation against stale editor state.
- Upstream errors are normalized into a typed platform error contract.
- Cookies or authorization headers are forwarded only to the configured platform API.

## Expected .NET endpoints

```text
POST /api/music/generation/jobs
GET  /api/music/generation/jobs/{jobId}
GET  /api/music/projects/{projectId}/access
GET  /api/music/entitlements
```

The initial Synaptix Music repository slice implements the client and BFF boundary. The corresponding .NET handlers, persistence, credit ledger integration, and internal Python dispatch belong in `TycoonTycoon_Backend`.

## Acceptance criteria

- Cross-runtime platform payloads are versioned and schema validated.
- Unauthenticated BFF requests return a normalized 401 response.
- Invalid generation requests are rejected before reaching the platform API.
- Idempotency and correlation headers are preserved.
- The platform URL is not exposed through a `NEXT_PUBLIC_` environment variable.
- The Python generation endpoint remains private.

## Deferred

- Auth-provider-specific session resolution.
- Generation job polling or SignalR updates.
- .NET endpoint implementation.
- Durable job and credit-reservation persistence.
- Project upload/synchronization to the platform database.
- Render authorization and storage quota enforcement.

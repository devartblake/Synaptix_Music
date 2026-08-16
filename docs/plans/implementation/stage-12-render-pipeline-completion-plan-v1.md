# Stage 12 Render Pipeline Completion — Plan v1

## Objective

Close the three gaps left open after the render-job control plane, offline WAV renderer, and worker loop landed (commits `c3b3d98`, `c3ffdc9`, `513b7b9`):

1. A real `ProjectLoader` — the worker can't fetch an actual project revision yet.
2. Real artifact storage with signed delivery — `FilesystemArtifactSink` is a local-disk placeholder.
3. Reverb and master compression in the offline renderer — currently dry-signal only.

Gaps 1 and 2 are architectural decisions as much as they are code; this plan grounds both in patterns that already exist in the SynaptixPlay backend (`TycoonTycoon_Backend`) rather than inventing new ones, found via a read-only research pass. Gap 3 is self-contained DSP work with no cross-repo dependency.

## Gap 1 — Service-to-service authentication for the ProjectLoader

### Problem

`worker.ts`'s `ProjectLoader` interface has no implementation. It needs `GET /api/v1/music/projects/{projectId}/revisions/{revisionId}` from `Synaptix.Backend.Api`, but that route currently authenticates only end users (`MusicProjectSyncEndpoints.cs` calls `TryGetPlayerId(user, ...)` → `401` if there's no JWT). A background worker has no end-user session to present.

### What already exists (researched, not assumed)

No OAuth2/`client_credentials`, IdentityServer/Duende/OpenIddict, mTLS, or Aspire-based service-discovery auth exists anywhere in the backend solution. The established internal-service pattern — used twice already — is a **static shared-secret header**, `X-Service-Token`:

- **Client side** (`Synaptix.Security.Kms.Client`, `Synaptix.Compliance.Client`): the typed `HttpClient` adds the header once at registration —
  ```csharp
  if (!string.IsNullOrEmpty(opts.ServiceToken))
      client.DefaultRequestHeaders.Add("X-Service-Token", opts.ServiceToken);
  ```
  Config: `KmsClient:ServiceToken` / `ComplianceClient:ServiceToken`.
- **Server side** (`Synaptix.Security.Kms.Api/Security/ServiceTokenFilter.cs`, and an identical copy in `Synaptix.Compliance.Api`): an `IEndpointFilter` on an `/internal/*` route group —
  ```csharp
  if (!context.HttpContext.Request.Headers.TryGetValue("X-Service-Token", out var value) || value != _expected)
      return Results.Json(new { error = "service_auth_required" }, statusCode: 401);
  ```
  Config: `KmsApi:ServiceToken` / `ComplianceApi:ServiceToken`.
- KMS additionally supports optional TLS certificate pinning (`PinningEnabled`, off by default) as defense-in-depth — not core auth, not used elsewhere.

`Synaptix.Backend.Api` (the API that hosts the music routes) has **no equivalent scheme today** — only JWT bearer for end users, plus a separate `X-Admin-Ops-Key` gate scoped to `/admin/*`. The music revision routes are unreachable by anything other than an authenticated end user.

### Recommendation

Extend `Synaptix.Backend.Api` with the same `ServiceTokenFilter` pattern already proven twice in this solution, rather than introducing OAuth2/mTLS infrastructure the codebase doesn't have anywhere. Add a **new, internal-only route** rather than layering a second auth scheme onto the existing end-user route, so the render-worker's access path is fully separate from — and can't weaken — the existing JWT-gated path.

### Execution steps

**In `TycoonTycoon_Backend`** (requires your explicit go-ahead before I touch this repo — see "Sign-off needed" below):

1. Add `Synaptix.Backend.Api/Security/ServiceTokenFilter.cs`, ported directly from the KMS/Compliance implementation.
2. Add a `ServiceTokens:RenderWorker` config key (appsettings + Docker env), a fresh high-entropy secret.
3. Add `GET /internal/music/projects/{projectId}/revisions/{revisionId}` — a read-only mirror of the existing revision-fetch logic in `MusicProjectSyncEndpoints.cs`, under the new path, gated by the filter instead of JWT.
4. Add a test proving: no token → 401, wrong token → 401, correct token → 200 with the expected payload. Mirror whatever test pattern (if any) covers the existing `ServiceTokenFilter` in KMS/Compliance.

**In `synaptix-music`:**

5. Add `RENDER_WORKER_SERVICE_TOKEN` to `.env.example` (client-side secret, matching the `KmsClientOptions.ServiceToken` naming spirit). Reuse the existing `SYNAPTIX_PLATFORM_API_URL` for the base URL — it's the same backend.
6. Implement `services/render-worker/src/http-project-loader.ts`: `HttpProjectLoader implements ProjectLoader` — `GET {SYNAPTIX_PLATFORM_API_URL}/internal/music/projects/{projectId}/revisions/{revisionId}` with `X-Service-Token`, response validated with `MusicProjectSchema.parse()` (fail closed on schema drift).
7. Test `HttpProjectLoader` against a local fake HTTP server (same pattern as `http-server.test.ts`) asserting the header is sent and the response is parsed/validated correctly — no live backend needed for this.
8. Wire `HttpProjectLoader` into `main.ts` so `runWorker` can finally start for real.
9. Manual/staging verification: run render-worker against a real local `Synaptix.Backend.Api`, submit a render job for a real project, confirm an end-to-end render.

### Risk and known limitation

Additive and low-risk to existing routes (new path, new config key, existing JWT-gated route untouched). The shared-secret approach is weaker than OAuth2/mTLS long-term — no per-request expiry or rotation without a redeploy — but it matches the codebase's existing risk posture (KMS uses the identical pattern for a security-sensitive service). Worth revisiting if the platform ever adopts a real service-identity system; not worth blocking on that now since none exists.

## Gap 2 — Artifact storage and signed delivery

### Problem

`FilesystemArtifactSink` writes WAV bytes to local disk: not durable across worker restarts or redeploys, not reachable by the BFF for download, no signed delivery.

### What already exists

The backend already runs MinIO (`synaptix_minio`, S3-compatible) with an established .NET-side pattern in `Synaptix.Backend.Infrastructure/Storage/MinioObjectStorage.cs`, using the **official Minio .NET SDK** (not the AWS S3 SDK). One bucket (`synaptix-assets`, config key `MinIO:Bucket`) with prefix-based key namespacing. Uploads and downloads both go through presigned URLs (`GetPresignedPutUrlAsync` / `GetPresignedGetUrlAsync`), and the closest existing key-naming precedent is `MediaService.cs`:
```csharp
var assetKey = $"uploads/{policy.Category}/{now:yyyyMMdd}/{Guid.NewGuid():N}_{Sanitize(req.FileName)}";
```
Local dev connection: endpoint `minio:9000` (in-network) / `localhost:9000` (host), access key `synaptix_minio_user`, secret via `MINIO_ROOT_PASSWORD`, no SSL. The music revision endpoints don't touch object storage today — there's no existing "audio artifact in MinIO" example, so this establishes the first one.

### Recommendation

Connect render-worker directly to the same MinIO instance using the official `minio` npm package (parity with the backend's SDK choice), reusing the existing `synaptix-assets` bucket under a new `renders/{renderId}/{fileName}` prefix — no schema change needed, since the key is fully reconstructible from fields `RenderArtifact` already has. Use a **dedicated MinIO access key scoped to `synaptix-assets/renders/*`** (MinIO supports per-key bucket policies) rather than reusing the backend's broader credentials — least privilege, and no coordination needed with the backend's own credential rotation.

This is entirely implementable within `synaptix-music` — **no `TycoonTycoon_Backend` code changes required**, since MinIO is directly reachable by any service holding credentials. Signed-URL generation for downloads can live in render-worker's own HTTP API and be proxied by the BFF, consistent with the direct-proxy architecture already chosen for the rest of the render-job control plane.

### Execution steps

1. Add `minio` as a dependency of `services/render-worker`.
2. Provision a MinIO access key/policy scoped to `synaptix-assets/renders/*` on the existing instance (an ops step — via the MinIO console or `mc` CLI; I'll write the exact policy JSON when this is scheduled).
3. Add env vars: `RENDER_WORKER_MINIO_ENDPOINT`, `RENDER_WORKER_MINIO_ACCESS_KEY`, `RENDER_WORKER_MINIO_SECRET_KEY`, `RENDER_WORKER_MINIO_BUCKET` (default `synaptix-assets`), `RENDER_WORKER_MINIO_USE_SSL`.
4. Implement `MinioArtifactSink implements ArtifactSink` (`services/render-worker/src/minio-artifact-sink.ts`) — drop-in replacement for `FilesystemArtifactSink`; `worker.ts` needs no changes since `ArtifactSink` is already the right seam.
5. Add presigned-GET generation and a new render-worker route, `GET /render-jobs/:id/artifacts/:artifactId/download-url`.
6. Add the matching BFF route, `apps/music-studio/app/api/platform/render-jobs/[jobId]/artifacts/[artifactId]/download-url/route.ts`.
7. Integration tests against a real, throwaway MinIO container (same "skip if unconfigured, run for real when it is" pattern already used for `RENDER_WORKER_TEST_DATABASE_URL`): upload, then presigned-URL round-trip.
8. Switch `main.ts` to `MinioArtifactSink` when MinIO env vars are present; keep `FilesystemArtifactSink` available for local/offline dev.
9. Add a MinIO service container to the CI TypeScript job, mirroring exactly what was done for Postgres.

### Risk

Low. No backend changes, no shared-route surface, additive only. The main judgment call is the access-key provisioning step, which needs whoever administers that MinIO instance.

## Gap 3 — Reverb and master compression in the offline renderer

### Problem

`offline-renderer.ts` renders dry signal only. The browser preview graph (`browser-production-graph.ts`) routes every instrument through a shared `Tone.Reverb` return (per-instrument send amount, already resolved as `settings.reverbSend` but currently unused by the offline renderer) and a fixed master `Tone.Compressor` (`threshold: -10, ratio: 3, attack: 0.01, release: 0.15`).

### Approach

Tone.js's reverb is a synthesized-noise convolution reverb — matching it bit-for-bit offline would need an FFT-based convolution engine, a new dependency, and real complexity for a "documented simplification" line. ADR-0003 requires the preview and worker to share **canonical device and routing semantics**, not identical DSP — and that's already the case everywhere else in this renderer (the oscillator/filter/envelope math isn't bit-identical to Tone.js's either). I'm proposing a **Freeverb-style algorithmic reverb** (parallel comb filters + series allpass filters — a well-documented, public-domain algorithm, no FFT, fully deterministic) and a standard **feed-forward envelope-follower compressor**, both pure-JS, both operating on the whole buffer at once to match the renderer's existing functional style.

### Execution steps

1. `services/render-worker/src/reverb.ts` — `applyReverb(buffer, decaySeconds, sampleRate): StereoBuffer`: 8 parallel comb filters per channel (classic Freeverb tuning, scaled to sample rate) into 4 series allpass filters; feedback coefficient derived from `decaySeconds`.
2. `services/render-worker/src/compressor.ts` — `applyCompressor(buffer, { thresholdDb, ratio, attackSeconds, releaseSeconds }, sampleRate): { buffer, warnings }`: peak-envelope follower with attack/release smoothing, static curve above threshold, unity gain below.
3. Wire into `offline-renderer.ts`, **master scope only** (stems stay dry — the standard convention for remixable stems, and consistent with how `renderTrackBuffer` already treats stems as independent of the shared bus):
   - Build a per-instrument wet-send buffer weighted by `settings.reverbSend` alongside the existing dry sum.
   - Run `applyReverb` on the wet buffer, mix it back into the master.
   - Run `applyCompressor` on the final master buffer, before normalization/clipping detection/WAV encoding.
   - Compressor parameters hardcoded to match the browser's current fixed defaults for now — there's no canonical "master bus parameter" concept yet (same limitation the browser already has); making it adjustable is new scope tied to the deferred bus/master controls from Stage 12 item 1, not this gap.
4. Tests: impulse-response decay + determinism for the reverb; threshold/ratio gain reduction + unity-gain-below-threshold + determinism for the compressor; re-verify the existing silence/range tests in `offline-renderer.test.ts` still hold (they should — nothing to reverb when there's no signal).
5. No cross-repo work.

### Risk

Lowest of the three — self-contained, no backend or infra dependency, purely additive to an already-tested module.

## Suggested sequencing

Gaps 2 and 3 have no backend dependency and can start immediately, in either order or in parallel. Gap 1 is the one that touches a separate, shared production system (`TycoonTycoon_Backend`, which also hosts KMS, Wallet, and Compliance) — **I'd sequence it last and want explicit sign-off before making any change there**, even though the plan above is now concrete and low-risk by construction (it copies an existing, twice-proven pattern rather than inventing one).

## Sign-off needed before implementation

- **Gap 1**: confirm you want me to add the `ServiceTokenFilter` + internal route to `Synaptix.Backend.Api`, following the plan above exactly. This is the only piece touching a repo outside `synaptix-music`.
- **Gaps 2 and 3**: no cross-repo risk; I can start on either as soon as you say go, or both.

## Revision Date

2026-08-16

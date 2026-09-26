# Stage 12 Certification Evidence: Local Rehearsal, 2026-09-26

**Result:** every step of `docs/operations/stage-12-deployment-certification.md` passed against a local Docker deployment.

**Scope:** this is a local rehearsal, not staging. The runbook's staging requirement (the intended environment, its secret store, and private networking) is not met here. Whether this evidence closes Stage 12 for Stage 13 work is the release owner's decision. To produce staging evidence, run the same commands against staging.

## Environment

| Item | Value |
| --- | --- |
| Date | 2026-09-26, renders 16:31 UTC |
| Operator | linkmatrix7499@gmail.com, with Claude Code |
| Music repository | `8cd73d6721e29c9b32c647ae87651e1df973f637` **plus uncommitted working-tree changes** |
| Backend repository | `7a24915ea0e659d716abbb5f5c2f7236bb0ec503` **plus uncommitted working-tree changes** (startup and internal-endpoint fixes below) |
| Render-worker image | `sha256:9c515a7b9ff5ad55f53eb7e181ead10c0369dd7abe395dbb1400a9773646d380` |
| Backend image | `sha256:cf7e03998bbb46daf1ea525cd0d0322398c0b371ae6db3c32d10c69e0c880ffb` |
| FFmpeg | Worker image; `libmp3lame` and `libvorbis` present |
| MinIO credentials | Scoped `synaptix-render-worker` service account (not root), policy `infrastructure/minio/render-worker-policy.json` |
| Certified revision | Project `79ee2ca5-b23f-4dc7-8ba2-40ac0cf53139`, revision `79ee2ca5-b23f-4dc7-8ba2-40ac0cf53139-cert-1`, checksum `3504ed830f70f59b7ae95b81dcf00817f36b5ae628ec45a8f89eda1fccdd01a7`, 4 bars, drums + poly synth with reverb send |

Because both repositories had uncommitted changes, the SHAs above don't fully identify the code. Commit the changes, rebuild the images, and rerun the procedure (about five minutes) to tie the evidence to exact commits.

## Procedure

1. Published the revision with `npm run publish:cert-revision`: signed in through the studio, uploaded through the studio's sync route, and read it back to confirm the platform's stored checksum.
2. Ran `scripts/certify-stage12-render-pipeline.mjs` inside the render-worker container (so FFmpeg and signed MinIO URLs are the worker's own) for OGG, MP3, WAV, and a repeated WAV.

## Renders

| Format | Job | Certified at | Artifacts (size, SHA-256 prefix) |
| --- | --- | --- | --- |
| ogg | `09f1d45f-a0c0-4cfa-a82a-25a7b6d058ea` | 2026-09-26T16:31:32.710Z | `master.ogg` 142,581 B `9209172b31ba305f…`<br>`preview.mp3` 120,429 B `8ce4b663909c7ac3…`<br>`artifact-manifest.json` 1,328 B `39220ada720bfd80…` |
| mp3 | `de26f283-95ec-4a04-908a-a17ba97f98e8` | 2026-09-26T16:31:35.160Z | `master.mp3` 240,813 B `934566d98aff1e2c…`<br>`preview.mp3` 120,429 B `8ce4b663909c7ac3…`<br>`artifact-manifest.json` 1,329 B `98ec9cfe0e99e598…` |
| wav | `a950fef1-27ba-48b6-b1cf-9e73be1da253` | 2026-09-26T16:31:37.569Z | `master.wav` 2,880,044 B `0c7898fe2a1165dc…`<br>`preview.mp3` 120,429 B `8ce4b663909c7ac3…`<br>`artifact-manifest.json` 1,329 B `9e9c74f016918f39…` |
| wav (repeat) | `041e8141-5b3b-426f-9683-f1fb2047e155` | 2026-09-26T16:31:39.988Z | `master.wav` 2,880,044 B `0c7898fe2a1165dc…`<br>`preview.mp3` 120,429 B `8ce4b663909c7ac3…`<br>`artifact-manifest.json` 1,329 B `d801bd434b6ce18b…` |

Full reports: `report-*.json` in this folder. Every signed download matched its recorded byte length and SHA-256.

**Determinism:** the repeated WAV render produced a byte-identical `master.wav`, and `preview.mp3` is identical across all four jobs. Artifact manifests differ only because each records its own render ID and timestamps.

## Negative paths

| Check | Expected | Observed |
| --- | --- | --- |
| Worker → backend with a wrong service token | 401 | 401 `ServiceAuthenticationRequired` |
| Backend with no service token configured | 503 | 503 `ServiceAuthenticationUnavailable` (temporary backend on port 5199) |
| Signed URL used after expiry | Rejected | 200 when fresh, then 403 `AccessDenied` after 1 s expiry; worker issues 900 s URLs |
| Scoped MinIO account: read/write `renders/*` | Allowed | Allowed |
| Scoped account: write outside `renders/`, write `packages/`, list bucket root, list buckets, delete | Denied | All denied |
| Unavailable revision | Retry, then dead-letter, no artifacts | `submitted → leased → retry_scheduled → leased → dead_lettered`, 0 artifacts, last error `RevisionNotFound` (404) |
| Credentials in logs, reports, client env | None | No service token, MinIO secret, MinIO root password, signing key or player password in worker, backend, studio or generation logs, or in reports; the only `NEXT_PUBLIC_*` variable is the SignalR hub URL |

Shutdown, heartbeat and expired-lease recovery weren't exercised live. They're covered by the render-worker's automated tests against a real PostgreSQL instance.

## Defects found and fixed during this run

1. **Backend: the render worker could never load a revision** (every environment). The deny-by-default authorization fallback rejected the internal endpoint before its service-token check. Fixed with `.AllowAnonymous()` on that endpoint; a contract test with the fallback active guards it.
2. **Backend: the API couldn't start in Development.** `IDiagnosticsProvider` was never registered. Registered in `MediatorPipelineExtensions`.
3. **MinIO policy rejected by MinIO.** `s3:GetBucketLocation` can't carry an `s3:prefix` condition. It now has its own statement.
4. **Local stack gave the worker MinIO root credentials.** `docker-compose.local.yml` now prefers `RENDER_WORKER_MINIO_ACCESS_KEY` / `RENDER_WORKER_MINIO_SECRET_KEY`.

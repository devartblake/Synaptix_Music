# Stage 12 Deployment and Certification Runbook

## Status

The Stage 12 implementation is code-complete. Production closure requires this runbook to be executed against the intended staging environment and its retained evidence to pass review. Credentials must be created in the deployment secret store; no production secret belongs in Git, an image, or a certification report.

## Required deployment components

- SynaptixPlay backend containing the internal immutable-revision endpoint from backend PR #525.
- PostgreSQL with render-worker migration `0001_render_jobs.sql` applied.
- MinIO bucket `synaptix-assets`.
- Render-worker image built from `services/render-worker/Dockerfile`; the image includes FFmpeg with `libmp3lame` and `libvorbis`.
- Private connectivity from the worker to PostgreSQL, MinIO, and the platform API.
- Private connectivity from the Next.js BFF to the render-worker HTTP API.

## Production credentials

Generate two independent high-entropy secrets. Never reuse the MinIO root credentials or a player/admin token.

1. Render-worker service token:
   - backend secret: `ServiceTokens__RenderWorker`;
   - worker secret: `RENDER_WORKER_SERVICE_TOKEN`;
   - values must match;
   - rotate both sides together and restart the two services.
2. MinIO service account:
   - access key: `RENDER_WORKER_MINIO_ACCESS_KEY`;
   - secret key: `RENDER_WORKER_MINIO_SECRET_KEY`;
   - attach `infrastructure/minio/render-worker-policy.json`;
   - policy access is limited to `synaptix-assets/renders/*`.

Example operator commands, with placeholders only:

```bash
mc alias set synaptix-minio https://MINIO_HOST MINIO_ADMIN_ACCESS_KEY MINIO_ADMIN_SECRET_KEY
mc admin policy create synaptix-minio synaptix-render-worker infrastructure/minio/render-worker-policy.json
mc admin user add synaptix-minio RENDER_WORKER_ACCESS_KEY RENDER_WORKER_SECRET_KEY
mc admin policy attach synaptix-minio synaptix-render-worker --user RENDER_WORKER_ACCESS_KEY
```

## Worker configuration

Required:

```text
DATABASE_URL
SYNAPTIX_PLATFORM_API_URL
RENDER_WORKER_SERVICE_TOKEN
RENDER_WORKER_MINIO_ENDPOINT
RENDER_WORKER_MINIO_ACCESS_KEY
RENDER_WORKER_MINIO_SECRET_KEY
```

Recommended production values:

```text
RENDER_WORKER_MINIO_USE_SSL=true
RENDER_WORKER_MINIO_BUCKET=synaptix-assets
RENDER_WORKER_SIGNED_URL_TTL_SECONDS=900
RENDER_WORKER_FFMPEG_PATH=ffmpeg
```

The worker refuses to start its polling loop when the platform loader is configured without MinIO. The backend returns `503` when service authentication is not configured and `401` for a missing or incorrect token.

## Certification procedure

1. Deploy the exact backend and music-worker SHAs under review.
2. Apply the render-job migration.
3. Confirm the worker can reach the backend, database, and MinIO only over the intended private network.
4. Publish one small, known-good project revision to the platform.
5. Set the non-secret `STAGE12_CERT_*` inputs and run:

```bash
npm run certify:stage12
```

The command submits a real render, waits for completion, requests signed delivery for every artifact, downloads each artifact, verifies byte length and SHA-256, requires `preview.mp3` and `artifact-manifest.json`, checks FFmpeg encoder availability, and writes `stage12-certification-report.json`.

6. Repeat with `STAGE12_CERT_OUTPUT_FORMAT=mp3`, `ogg`, and `wav`.
7. Exercise negative paths:
   - wrong service token returns `401`;
   - unset backend token returns `503`;
   - expired signed URL is rejected;
   - MinIO credentials cannot read or write outside `renders/*`;
   - unavailable project revision reaches retry/dead-letter behavior without producing artifacts.
8. Retain the reports, exact image digests/SHAs, deployment timestamp, operator, and negative-path evidence in the release record.

## Pass criteria

- WAV, MP3, and OGG jobs complete from an immutable platform revision.
- Repeated identical renders have matching audio checksums.
- Master/stem names, preview metadata, and the artifact manifest validate.
- Signed downloads match recorded checksums and byte lengths.
- The service token and MinIO policy fail closed.
- Retry, dead-letter, shutdown, and lease recovery behave as designed.
- No credential appears in logs, reports, Git history, or client-visible environment variables.

## Current boundary

Repository implementation and automated tests can establish deployment readiness. Only an authorized operator with access to the staging secret store and infrastructure can complete the live certification evidence.

## Revision date

2026-09-20

# Core Flows

Sequence diagrams for the three flows that cross service boundaries. Diagrams use Mermaid, which GitHub and most Markdown viewers render.

## 1. Editing and project sync

Every edit is saved locally first; cloud sync is a separate, retryable step.

```mermaid
sequenceDiagram
    actor User
    participant Studio as Studio (browser)
    participant History as EditorCommandHistory
    participant Session as EditorSessionCoordinator
    participant Local as IndexedDB (project + sync queue)
    participant BFF as Next.js BFF /api/platform
    participant Platform as SynaptixPlay API

    User->>Studio: edit (note, tempo, mixer…)
    Studio->>History: execute(command)
    History-->>Studio: new project + ProjectRevision (checksum)
    Studio->>Session: markSaving(revision)
    Studio->>Local: saveAndQueue(envelope, last saved revision)
    alt save failed
        Studio->>Session: markFailed → "Not saved" banner + Retry, unload warning
    else saved
        Studio->>Session: markSaved
        Studio->>BFF: drain queue (on edit, "Sync now", or reconnect)
        BFF->>Platform: upload revision (expected parent, idempotency key)
        alt accepted
            Platform-->>Studio: accepted → operation removed from queue
        else conflict
            Platform-->>Studio: conflict + remote project → "Use cloud" / "Keep mine"
        end
    end
```

Only the first browser tab on a project may edit. Later tabs become read-only through a `BroadcastChannel` lease.

## 2. Generation jobs

```mermaid
sequenceDiagram
    actor User
    participant Studio as Studio (Generate)
    participant BFF as Next.js BFF
    participant Platform as SynaptixPlay API
    participant Gen as generation-api (Python)

    User->>Studio: brief + controls
    Studio->>BFF: POST /api/platform/generation/jobs (idempotency key)
    BFF->>Platform: POST /api/v1/music/generation/jobs
    Platform->>Platform: authorize, entitlements/credits, persist job
    Platform->>Gen: dispatch (retries on failure/timeout)
    Gen-->>Platform: proposal (tracks, clips, notes)
    Platform-->>Studio: SignalR update (polling fallback)
    User->>Studio: Apply
    Studio->>Studio: ApplyGeneratedArrangementEditorCommand → normal save/sync (flow 1)
```

Applying a proposal is an ordinary undoable edit, and an already-applied job cannot be applied twice.

## 3. Render jobs and export

```mermaid
sequenceDiagram
    actor User
    participant Studio as Studio (Render / export)
    participant BFF as Next.js BFF
    participant Worker as render-worker (HTTP API + poller)
    participant DB as PostgreSQL (render_jobs)
    participant Platform as SynaptixPlay API
    participant Store as MinIO (synaptix-assets/renders/*)

    User->>Studio: export (master or stems, format)
    Studio->>BFF: POST /api/platform/render-jobs
    BFF->>Worker: POST /render-jobs (manifest: revision + checksum)
    Worker->>DB: insert job (queued, idempotent)
    loop poller
        Worker->>DB: lease next queued job
        Worker->>Platform: GET /internal/music/projects/{id}/revisions/{rev} (X-Service-Token)
        Worker->>Worker: verify checksum, render WAV, derive MP3/OGG and preview
        Worker->>Store: upload artifacts + artifact-manifest.json
        Worker->>DB: completed (or retry with backoff, then dead_letter)
    end
    Studio->>BFF: poll job / request download link
    BFF->>Worker: GET /render-jobs/{id}/artifacts/{artifactId}/download-url
    Worker-->>Studio: presigned MinIO URL (short-lived)
```

Completed renders feed adaptive packages. Publication and delivery to games are described in `docs/plans/implementation/stage-13-execution-plan-v1.md`.

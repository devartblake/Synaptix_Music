-- Durable render-job control plane: job records and their append-only event log.
-- Job/event shapes must stay in sync with packages/render-contracts/src/render-job.ts.

CREATE TABLE IF NOT EXISTS render_jobs (
  job_id            UUID PRIMARY KEY,
  idempotency_key   TEXT NOT NULL UNIQUE,
  contract_version  TEXT NOT NULL,
  manifest          JSONB NOT NULL,
  status            TEXT NOT NULL CHECK (status IN ('queued', 'running', 'completed', 'failed', 'cancelled', 'dead_letter')),
  attempt           INTEGER NOT NULL DEFAULT 0 CHECK (attempt >= 0),
  max_attempts      INTEGER NOT NULL CHECK (max_attempts >= 1),
  submitted_at      TIMESTAMPTZ NOT NULL,
  updated_at        TIMESTAMPTZ NOT NULL,
  lease_owner_id    TEXT,
  lease_expires_at  TIMESTAMPTZ,
  next_attempt_at   TIMESTAMPTZ,
  result            JSONB,
  last_error        TEXT
);

-- Serves lease(): find the oldest queued job whose retry delay has elapsed.
CREATE INDEX IF NOT EXISTS render_jobs_lease_candidates_idx
  ON render_jobs (submitted_at, job_id)
  WHERE status = 'queued';

-- Serves reclaimExpiredLeases(): find running jobs whose worker lease has expired.
CREATE INDEX IF NOT EXISTS render_jobs_running_lease_idx
  ON render_jobs (lease_expires_at)
  WHERE status = 'running';

CREATE TABLE IF NOT EXISTS render_job_events (
  event_id      BIGSERIAL PRIMARY KEY,
  job_id        UUID NOT NULL REFERENCES render_jobs (job_id),
  type          TEXT NOT NULL,
  occurred_at   TIMESTAMPTZ NOT NULL,
  attempt       INTEGER NOT NULL,
  detail        TEXT
);

CREATE INDEX IF NOT EXISTS render_job_events_job_id_idx
  ON render_job_events (job_id, event_id);

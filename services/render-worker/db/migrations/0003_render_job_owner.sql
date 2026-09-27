-- Per-player render jobs: the studio's BFF passes the signed-in player's id, and every
-- player-facing read is scoped to it. Jobs submitted before this column existed (and jobs
-- from private callers such as certification tooling) have no owner and are visible only
-- to unscoped, private callers.
ALTER TABLE render_jobs ADD COLUMN IF NOT EXISTS owner_id text;
CREATE INDEX IF NOT EXISTS render_jobs_owner_submitted_idx
  ON render_jobs (owner_id, submitted_at);

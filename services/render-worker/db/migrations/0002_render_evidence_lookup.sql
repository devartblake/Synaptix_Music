-- Serves renderEvidence(): the SynaptixPlay backend verifies adaptive-package publication
-- against render records by render ID.
CREATE INDEX IF NOT EXISTS render_jobs_render_id_idx
  ON render_jobs ((manifest->>'renderId'));

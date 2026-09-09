CREATE TABLE IF NOT EXISTS securities_comparison_revisions (
  comparison_id TEXT NOT NULL REFERENCES securities_comparisons(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) <= 1048576),
  created_at TEXT NOT NULL,
  PRIMARY KEY (comparison_id, revision)
);
INSERT OR IGNORE INTO securities_comparison_revisions
  (comparison_id, revision, snapshot_json, created_at)
  SELECT id, revision, snapshot_json, updated_at FROM securities_comparisons;

CREATE TABLE IF NOT EXISTS securities_comparison_preparations (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  input_digest TEXT NOT NULL CHECK (length(input_digest) = 64),
  input_json TEXT NOT NULL CHECK (length(input_json) <= 24576),
  status TEXT NOT NULL CHECK (status IN ('preparing', 'prepared', 'analyzing', 'completed', 'failed', 'cancelled')),
  target_comparison_id TEXT REFERENCES securities_comparisons(id),
  expected_revision INTEGER CHECK (expected_revision >= 1),
  comparison_id TEXT REFERENCES securities_comparisons(id),
  revision INTEGER CHECK (revision >= 1),
  chat_job_id TEXT REFERENCES securities_comparison_jobs(id),
  source_result_json TEXT CHECK (length(source_result_json) <= 512000),
  source_receipt_json TEXT NOT NULL DEFAULT '[]' CHECK (length(source_receipt_json) <= 256000),
  source_receipt_revision INTEGER NOT NULL DEFAULT -1 CHECK (source_receipt_revision >= -1),
  error_code TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deadline TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS securities_comparison_one_active_refresh
  ON securities_comparison_preparations(target_comparison_id)
  WHERE target_comparison_id IS NOT NULL AND status IN ('preparing', 'prepared', 'analyzing');
CREATE INDEX IF NOT EXISTS securities_comparison_preparation_history
  ON securities_comparison_preparations(updated_at);

CREATE TABLE IF NOT EXISTS securities_comparisons (
  id TEXT PRIMARY KEY,
  revision INTEGER NOT NULL CHECK (revision >= 1),
  snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) <= 1048576),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS securities_comparison_jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  comparison_id TEXT NOT NULL REFERENCES securities_comparisons(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  question TEXT NOT NULL,
  locale TEXT NOT NULL CHECK (locale IN ('vi', 'en')),
  input_digest TEXT NOT NULL CHECK (length(input_digest) = 64),
  status TEXT NOT NULL CHECK (status IN ('running', 'completed', 'failed')),
  started_at TEXT NOT NULL,
  deadline TEXT NOT NULL,
  completed_at TEXT,
  result_json TEXT CHECK (length(result_json) <= 512000),
  receipt_json TEXT CHECK (length(receipt_json) <= 512000),
  error_code TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS securities_comparison_one_active_job
  ON securities_comparison_jobs(comparison_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS securities_comparison_chat_history
  ON securities_comparison_jobs(comparison_id, revision, started_at);

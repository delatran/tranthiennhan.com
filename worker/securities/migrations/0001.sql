CREATE TABLE IF NOT EXISTS securities_dossiers (
  id TEXT PRIMARY KEY,
  head_revision INTEGER NOT NULL CHECK (head_revision >= 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS securities_revisions (
  dossier_id TEXT NOT NULL REFERENCES securities_dossiers(id),
  revision INTEGER NOT NULL CHECK (revision >= 1),
  mutation_id TEXT NOT NULL UNIQUE,
  snapshot_json TEXT NOT NULL CHECK (length(snapshot_json) <= 1048576),
  created_at TEXT NOT NULL,
  PRIMARY KEY (dossier_id, revision)
);
CREATE TABLE IF NOT EXISTS securities_approvals (
  dossier_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  approved_at TEXT NOT NULL,
  request_id TEXT NOT NULL,
  PRIMARY KEY (dossier_id, revision),
  FOREIGN KEY (dossier_id, revision) REFERENCES securities_revisions(dossier_id, revision)
);
CREATE TABLE IF NOT EXISTS securities_requests (
  request_id TEXT PRIMARY KEY,
  fingerprint TEXT NOT NULL,
  result_kind TEXT NOT NULL,
  result_id TEXT NOT NULL,
  result_revision INTEGER,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS securities_jobs (
  id TEXT PRIMARY KEY,
  request_id TEXT NOT NULL UNIQUE,
  dossier_id TEXT NOT NULL,
  revision INTEGER NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('analysis','chat','refresh')),
  status TEXT NOT NULL CHECK (status IN ('running','completed','failed','cancelled','stale')),
  started_at TEXT NOT NULL,
  deadline TEXT NOT NULL,
  completed_at TEXT,
  result_json TEXT,
  error_code TEXT,
  receipt_json TEXT,
  FOREIGN KEY (dossier_id, revision) REFERENCES securities_revisions(dossier_id, revision)
);
CREATE UNIQUE INDEX IF NOT EXISTS securities_one_active_job ON securities_jobs(dossier_id) WHERE status = 'running';
CREATE INDEX IF NOT EXISTS securities_jobs_revision ON securities_jobs(dossier_id, revision, started_at);

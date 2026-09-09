CREATE TABLE IF NOT EXISTS securities_source_imports (
  job_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  summary_json TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS securities_source_datasets (
  company_id TEXT NOT NULL,
  period_id TEXT NOT NULL,
  comparison_period_id TEXT NOT NULL,
  version_hash TEXT NOT NULL,
  dataset_json TEXT NOT NULL,
  imported_at TEXT NOT NULL,
  PRIMARY KEY (company_id, period_id, comparison_period_id, version_hash)
);
CREATE INDEX IF NOT EXISTS securities_source_latest ON securities_source_datasets(company_id, imported_at DESC);

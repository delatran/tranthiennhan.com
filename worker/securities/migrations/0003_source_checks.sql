CREATE TABLE IF NOT EXISTS securities_source_checks (
  cache_key TEXT PRIMARY KEY,
  result_json TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

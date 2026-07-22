PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS jobs (
  id TEXT PRIMARY KEY NOT NULL,
  request_json TEXT NOT NULL,
  title TEXT,
  status TEXT NOT NULL,
  progress_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT,
  output_path TEXT,
  error_category TEXT,
  error_message TEXT,
  diagnostics_json TEXT NOT NULL DEFAULT '[]',
  queue_position INTEGER NOT NULL DEFAULT 0,
  in_queue INTEGER NOT NULL DEFAULT 1,
  revision INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS idx_jobs_status_position ON jobs(status, queue_position);

CREATE TABLE IF NOT EXISTS history (
  job_id TEXT PRIMARY KEY NOT NULL REFERENCES jobs(id) ON DELETE CASCADE,
  finished_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  singleton INTEGER PRIMARY KEY NOT NULL CHECK (singleton = 1),
  value_json TEXT NOT NULL,
  schema_version INTEGER NOT NULL DEFAULT 1,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dependencies (
  kind TEXT PRIMARY KEY NOT NULL,
  value_json TEXT NOT NULL,
  checked_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS github_users (
  github_user_id INTEGER PRIMARY KEY,
  login TEXT NOT NULL,
  display_name TEXT,
  avatar_url TEXT,
  access_token_ciphertext TEXT,
  refresh_token_ciphertext TEXT,
  access_token_expires_at INTEGER,
  refresh_token_expires_at INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS github_installations (
  installation_id INTEGER PRIMARY KEY,
  account_login TEXT NOT NULL,
  account_type TEXT NOT NULL,
  repository_selection TEXT NOT NULL DEFAULT 'selected',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS rehearsal_runs (
  id TEXT PRIMARY KEY,
  installation_id INTEGER NOT NULL REFERENCES github_installations(installation_id) ON DELETE CASCADE,
  repository_id INTEGER NOT NULL,
  repository_owner TEXT NOT NULL,
  repository_name TEXT NOT NULL,
  default_branch TEXT NOT NULL,
  pull_request_number INTEGER NOT NULL,
  pull_request_title TEXT NOT NULL,
  base_ref TEXT NOT NULL,
  head_ref TEXT NOT NULL,
  base_sha TEXT NOT NULL,
  head_sha TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued',
  workflow_run_id INTEGER,
  workflow_url TEXT,
  failure_reason TEXT,
  check_results TEXT NOT NULL DEFAULT '[]',
  impact TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(repository_id, pull_request_number, head_sha)
);

CREATE INDEX IF NOT EXISTS idx_rehearsal_runs_repository_created
  ON rehearsal_runs(repository_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_rehearsal_runs_status
  ON rehearsal_runs(status);

CREATE TABLE IF NOT EXISTS findings (
  id TEXT PRIMARY KEY,
  run_id TEXT NOT NULL REFERENCES rehearsal_runs(id) ON DELETE CASCADE,
  category TEXT NOT NULL,
  severity TEXT NOT NULL,
  confidence REAL NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL,
  file_path TEXT,
  line_start INTEGER,
  evidence TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_findings_run_created ON findings(run_id, created_at);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  delivery_id TEXT PRIMARY KEY,
  event_name TEXT NOT NULL,
  event_action TEXT,
  run_id TEXT REFERENCES rehearsal_runs(id) ON DELETE SET NULL,
  received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS app_users (
  uid TEXT PRIMARY KEY,
  email TEXT NOT NULL DEFAULT '',
  username TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT 'User',
  role TEXT NOT NULL DEFAULT 'operator',
  avatar TEXT NOT NULL DEFAULT 'US',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_settings (
  uid TEXT PRIMARY KEY REFERENCES app_users(uid) ON DELETE CASCADE,
  data JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_schedules (
  uid TEXT PRIMARY KEY REFERENCES app_users(uid) ON DELETE CASCADE,
  items JSONB NOT NULL DEFAULT '[]'::jsonb,
  is_paused BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS app_history (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL REFERENCES app_users(uid) ON DELETE CASCADE,
  description_text TEXT NOT NULL DEFAULT '',
  kategori TEXT NOT NULL DEFAULT '',
  slots JSONB NOT NULL DEFAULT '[]'::jsonb,
  result TEXT NOT NULL DEFAULT '',
  time TEXT NOT NULL DEFAULT '',
  saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS production_jobs (
  id TEXT PRIMARY KEY,
  uid TEXT NOT NULL,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  prompt TEXT NOT NULL,
  source TEXT NOT NULL DEFAULT 'manual',
  category TEXT NOT NULL DEFAULT '',
  scheduled_time TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'queued',
  progress DOUBLE PRECISION NOT NULL DEFAULT 0,
  message TEXT NOT NULL DEFAULT '',
  error JSONB,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  integration JSONB NOT NULL DEFAULT '{}'::jsonb,
  status_history JSONB NOT NULL DEFAULT '[]'::jsonb,
  final_video_url TEXT NOT NULL DEFAULT '',
  short_video_url TEXT NOT NULL DEFAULT '',
  thumbnail_url TEXT NOT NULL DEFAULT '',
  youtube_url TEXT NOT NULL DEFAULT '',
  external_job_id TEXT NOT NULL DEFAULT '',
  execution_id TEXT NOT NULL DEFAULT '',
  platform_results JSONB,
  outputs JSONB,
  current_stage TEXT NOT NULL DEFAULT '',
  current_node TEXT NOT NULL DEFAULT '',
  stage_label TEXT NOT NULL DEFAULT '',
  retry_triggered_at TIMESTAMPTZ,
  retry_child_job_id TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_production_jobs_uid_created_at
  ON production_jobs(uid, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_production_jobs_status_created_at
  ON production_jobs(status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_app_history_uid_saved_at
  ON app_history(uid, saved_at DESC);

CREATE DATABASE vidgen;

\connect vidgen;

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

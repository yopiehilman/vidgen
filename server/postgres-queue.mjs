import { Pool } from 'pg';

let pool = null;
let initPromise = null;

function getConnectionString() {
  return process.env.VIDGEN_POSTGRES_URL || process.env.DATABASE_URL || process.env.POSTGRES_URL || '';
}

export function isPostgresQueueEnabled() {
  return Boolean(
    getConnectionString() ||
    process.env.PGHOST ||
    process.env.VIDGEN_QUEUE_DB === 'postgres'
  );
}

export function getPostgresPool() {
  if (!isPostgresQueueEnabled()) {
    throw new Error('PostgreSQL queue backend belum dikonfigurasi.');
  }

  if (!pool) {
    const connectionString = getConnectionString();
    pool = new Pool(
      connectionString
        ? {
            connectionString,
            ssl: /true/i.test(String(process.env.PGSSLMODE || ''))
              ? { rejectUnauthorized: false }
              : undefined,
          }
        : {
            host: process.env.PGHOST || '127.0.0.1',
            port: Number(process.env.PGPORT || 5432),
            user: process.env.PGUSER || 'postgres',
            password: process.env.PGPASSWORD || '',
            database: process.env.PGDATABASE || 'vidgen',
            ssl: /true/i.test(String(process.env.PGSSLMODE || ''))
              ? { rejectUnauthorized: false }
              : undefined,
          },
    );
  }

  return pool;
}

export async function ensurePostgresQueueSchema() {
  if (!isPostgresQueueEnabled()) {
    return false;
  }

  if (!initPromise) {
    initPromise = (async () => {
      const db = getPostgresPool();
      await db.query(`
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
      `);
      return true;
    })();
  }

  return initPromise;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function toObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function rowToJob(row) {
  if (!row) {
    return null;
  }

  return {
    id: row.id,
    uid: row.uid,
    title: row.title,
    description: row.description || '',
    prompt: row.prompt,
    source: row.source || 'manual',
    category: row.category || '',
    scheduledTime: row.scheduled_time || '',
    status: row.status || 'queued',
    progress: Number(row.progress || 0),
    message: row.message || '',
    error: row.error || undefined,
    metadata: toObject(row.metadata),
    integration: toObject(row.integration),
    statusHistory: toArray(row.status_history),
    finalVideoUrl: row.final_video_url || '',
    shortVideoUrl: row.short_video_url || '',
    thumbnailUrl: row.thumbnail_url || '',
    youtubeUrl: row.youtube_url || '',
    externalJobId: row.external_job_id || '',
    executionId: row.execution_id || '',
    platformResults: row.platform_results || undefined,
    outputs: row.outputs || undefined,
    currentStage: row.current_stage || '',
    currentNode: row.current_node || '',
    stageLabel: row.stage_label || '',
    retryTriggeredAt: row.retry_triggered_at ? new Date(row.retry_triggered_at).toISOString() : '',
    retryChildJobId: row.retry_child_job_id || '',
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : '',
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : '',
  };
}

async function updateJobRecord(client, job) {
  const result = await client.query(
    `
      UPDATE production_jobs
      SET
        uid = $2,
        title = $3,
        description = $4,
        prompt = $5,
        source = $6,
        category = $7,
        scheduled_time = $8,
        status = $9,
        progress = $10,
        message = $11,
        error = $12,
        metadata = $13,
        integration = $14,
        status_history = $15,
        final_video_url = $16,
        short_video_url = $17,
        thumbnail_url = $18,
        youtube_url = $19,
        external_job_id = $20,
        execution_id = $21,
        platform_results = $22,
        outputs = $23,
        current_stage = $24,
        current_node = $25,
        stage_label = $26,
        retry_triggered_at = $27,
        retry_child_job_id = $28,
        updated_at = NOW()
      WHERE id = $1
      RETURNING *
    `,
    [
      job.id,
      job.uid,
      job.title,
      job.description || '',
      job.prompt,
      job.source || 'manual',
      job.category || '',
      job.scheduledTime || '',
      job.status || 'queued',
      Number(job.progress || 0),
      job.message || '',
      job.error || null,
      toObject(job.metadata),
      toObject(job.integration),
      toArray(job.statusHistory),
      job.finalVideoUrl || '',
      job.shortVideoUrl || '',
      job.thumbnailUrl || '',
      job.youtubeUrl || '',
      job.externalJobId || '',
      job.executionId || '',
      job.platformResults || null,
      job.outputs || null,
      job.currentStage || '',
      job.currentNode || '',
      job.stageLabel || '',
      job.retryTriggeredAt ? new Date(job.retryTriggeredAt) : null,
      job.retryChildJobId || '',
    ],
  );

  return rowToJob(result.rows[0]);
}

export async function insertProductionJob(job) {
  await ensurePostgresQueueSchema();
  const db = getPostgresPool();
  const result = await db.query(
    `
      INSERT INTO production_jobs (
        id, uid, title, description, prompt, source, category, scheduled_time, status,
        progress, message, error, metadata, integration, status_history,
        final_video_url, short_video_url, thumbnail_url, youtube_url, external_job_id,
        execution_id, platform_results, outputs, current_stage, current_node, stage_label,
        retry_triggered_at, retry_child_job_id
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9,
        $10, $11, $12, $13, $14, $15,
        $16, $17, $18, $19, $20,
        $21, $22, $23, $24, $25, $26,
        $27, $28
      )
      RETURNING *
    `,
    [
      job.id,
      job.uid,
      job.title,
      job.description || '',
      job.prompt,
      job.source || 'manual',
      job.category || '',
      job.scheduledTime || '',
      job.status || 'queued',
      Number(job.progress || 0),
      job.message || '',
      job.error || null,
      toObject(job.metadata),
      toObject(job.integration),
      toArray(job.statusHistory),
      job.finalVideoUrl || '',
      job.shortVideoUrl || '',
      job.thumbnailUrl || '',
      job.youtubeUrl || '',
      job.externalJobId || '',
      job.executionId || '',
      job.platformResults || null,
      job.outputs || null,
      job.currentStage || '',
      job.currentNode || '',
      job.stageLabel || '',
      job.retryTriggeredAt ? new Date(job.retryTriggeredAt) : null,
      job.retryChildJobId || '',
    ],
  );

  return rowToJob(result.rows[0]);
}

export async function getProductionJobById(jobId) {
  await ensurePostgresQueueSchema();
  const db = getPostgresPool();
  const result = await db.query(
    `SELECT * FROM production_jobs WHERE id = $1 LIMIT 1`,
    [jobId],
  );
  return rowToJob(result.rows[0] || null);
}

export async function listProductionJobsByUser(uid, limit = 250) {
  await ensurePostgresQueueSchema();
  const db = getPostgresPool();
  const result = await db.query(
    `
      SELECT *
      FROM production_jobs
      WHERE uid = $1
      ORDER BY created_at DESC
      LIMIT $2
    `,
    [uid, Math.max(1, Math.min(limit, 1000))],
  );
  return result.rows.map(rowToJob).filter(Boolean);
}

export async function updateProductionJob(jobId, updater) {
  await ensurePostgresQueueSchema();
  const client = await getPostgresPool().connect();
  try {
    await client.query('BEGIN');
    const current = await client.query(
      `SELECT * FROM production_jobs WHERE id = $1 LIMIT 1 FOR UPDATE`,
      [jobId],
    );
    if (current.rowCount === 0) {
      await client.query('ROLLBACK');
      return null;
    }

    const currentJob = rowToJob(current.rows[0]);
    const nextJob = await updater(currentJob);
    if (!nextJob) {
      await client.query('ROLLBACK');
      return currentJob;
    }

    const saved = await updateJobRecord(client, {
      ...currentJob,
      ...nextJob,
      id: currentJob.id,
      uid: nextJob.uid || currentJob.uid,
      statusHistory: toArray(nextJob.statusHistory ?? currentJob.statusHistory),
      metadata: toObject(nextJob.metadata ?? currentJob.metadata),
      integration: toObject(nextJob.integration ?? currentJob.integration),
    });
    await client.query('COMMIT');
    return saved;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listQueuedJobsForDispatch(limit = 100) {
  await ensurePostgresQueueSchema();
  const db = getPostgresPool();
  const result = await db.query(
    `
      SELECT *
      FROM production_jobs
      WHERE status = 'queued'
      ORDER BY created_at ASC
      LIMIT $1
    `,
    [Math.max(1, Math.min(limit, 500))],
  );
  return result.rows.map(rowToJob).filter(Boolean);
}

export async function prunePostgresQueue(retentionDays = 7) {
  await ensurePostgresQueueSchema();
  const db = getPostgresPool();
  const result = await db.query(
    `
      DELETE FROM production_jobs
      WHERE updated_at < NOW() - ($1::text || ' days')::interval
        AND status IN ('completed', 'failed')
    `,
    [String(Math.max(1, retentionDays))],
  );
  return {
    deletedQueue: Number(result.rowCount || 0),
  };
}

import express from 'express';
import dotenv from 'dotenv';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash, createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { createServer as createViteServer } from 'vite';
import { pruneOldDocs } from '../scripts/firestore_cleanup.mjs';
import {
  ensurePostgresQueueSchema,
  deleteAppHistoryByUser,
  getAppSchedules,
  getAppSettings,
  getPostgresPool,
  getAppUser,
  getProductionJobById,
  insertProductionJob,
  insertAppHistory,
  isPostgresQueueEnabled,
  listAppHistory,
  listProductionJobsByUser,
  listQueuedJobsForDispatch,
  prunePostgresQueue,
  setAppSchedules,
  setAppSettings,
  updateProductionJob,
  upsertAppUser,
} from './postgres-queue.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const distIndexHtml = path.join(distDir, 'index.html');

dotenv.config({ path: path.join(rootDir, '.env.local') });
dotenv.config({ path: path.join(rootDir, '.env') });

const isDevServer = process.argv.includes('--dev');
const port = Number(process.env.PORT || 3000);
const defaultModel = process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct';
const defaultOllamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';
const defaultOllamaTimeoutMs = Number(process.env.OLLAMA_TIMEOUT_MS || 300000);
const defaultGenerateNumPredict = Number(process.env.OLLAMA_GENERATE_NUM_PREDICT || 2400);
const defaultGenerateMaxWords = Number(process.env.OLLAMA_GENERATE_MAX_WORDS || 1800);
const defaultGenerateVideoPromptCount = Number(process.env.OLLAMA_GENERATE_VIDEO_PROMPTS || 10);
const defaultRenderLeadMinutes = Number(process.env.VIDGEN_RENDER_LEAD_MINUTES || 120);
const dispatchPollIntervalMs = Math.max(Number(process.env.VIDGEN_DISPATCH_POLL_MS || 60000), 15000);
const dispatchRetryMinutes = Math.max(Number(process.env.VIDGEN_DISPATCH_RETRY_MINUTES || 10), 1);
const dataRetentionDays = Math.max(Number(process.env.VIDGEN_RETENTION_DAYS || 7), 1);
const cleanupPollIntervalMs = Math.max(Number(process.env.VIDGEN_CLEANUP_POLL_MS || 3600000), 300000);
const sessionTtlDays = Math.max(Number(process.env.VIDGEN_SESSION_TTL_DAYS || 30), 1);

const ASPECT_RATIO_PRESETS = {
  '16:9': {
    ratio: '16:9',
    label: 'landscape',
    outputWidth: 1280,
    outputHeight: 720,
  },
  '9:16': {
    ratio: '9:16',
    label: 'portrait',
    outputWidth: 720,
    outputHeight: 1280,
  },
  '1:1': {
    ratio: '1:1',
    label: 'square',
    outputWidth: 1080,
    outputHeight: 1080,
  },
};

const STORY_DURATION_PRESETS = {
  short: {
    id: 'short',
    label: '1-2 menit',
    targetDurationSeconds: 90,
    sceneCount: 10,
    clipDuration: 9,
    targetWords: 230,
    maxWords: 320,
  },
  '3m': {
    id: '3m',
    label: '3 menit',
    targetDurationSeconds: 180,
    sceneCount: 15,
    clipDuration: 12,
    targetWords: 430,
    maxWords: 560,
  },
  '5m': {
    id: '5m',
    label: '5 menit',
    targetDurationSeconds: 300,
    sceneCount: 20,
    clipDuration: 15,
    targetWords: 720,
    maxWords: 900,
  },
  '10m': {
    id: '10m',
    label: '10 menit',
    targetDurationSeconds: 600,
    sceneCount: 32,
    clipDuration: 18,
    targetWords: 1450,
    maxWords: 1750,
  },
  '15m': {
    id: '15m',
    label: '15 menit',
    targetDurationSeconds: 900,
    sceneCount: 45,
    clipDuration: 20,
    targetWords: 2150,
    maxWords: 2600,
  },
};

function sendError(res, status, error, details) {
  res.status(status).json({
    error,
    ...(details ? { details } : {}),
  });
}

function usePostgresQueue() {
  return isPostgresQueueEnabled();
}

function useLocalAuth() {
  return usePostgresQueue() || getString(process.env.VIDGEN_AUTH_MODE).toLowerCase() === 'local';
}

function normalizeBaseUrl(url) {
  return getString(url).replace(/\/+$/, '');
}

function getOllamaBaseUrl(customBaseUrl) {
  return normalizeBaseUrl(customBaseUrl) || normalizeBaseUrl(defaultOllamaBaseUrl);
}

function getOllamaModelCandidates(customModel) {
  const primaryModel = getString(customModel) || getString(process.env.OLLAMA_MODEL) || defaultModel;
  const envFallbacks = getString(process.env.OLLAMA_MODEL_FALLBACKS)
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  return [...new Set([primaryModel, ...envFallbacks].filter(Boolean))];
}

async function callOllamaGenerate({
  baseUrl,
  model,
  prompt,
  temperature = 0.7,
  numPredict = 2048,
  format,
  timeoutMs = defaultOllamaTimeoutMs,
}) {
  const endpoint = new URL(`${baseUrl}/api/generate`);
  const requestBody = JSON.stringify({
    model,
    prompt,
    stream: false,
    ...(format ? { format } : {}),
    options: {
      temperature,
      num_predict: numPredict,
    },
  });

  const responsePayload = await new Promise((resolve, reject) => {
    const transport = endpoint.protocol === 'https:' ? https : http;
    const req = transport.request(
      {
        protocol: endpoint.protocol,
        hostname: endpoint.hostname,
        port: endpoint.port || (endpoint.protocol === 'https:' ? 443 : 80),
        path: `${endpoint.pathname}${endpoint.search}`,
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Content-Length': Buffer.byteLength(requestBody),
        },
      },
      (res) => {
        let raw = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          raw += chunk;
        });
        res.on('end', () => {
          resolve({
            statusCode: res.statusCode || 0,
            body: raw,
          });
        });
      },
    );

    req.setTimeout(timeoutMs, () => {
      req.destroy(new Error(`Request Ollama timeout setelah ${Math.round(timeoutMs / 1000)} detik.`));
    });

    req.on('error', (error) => {
      reject(error);
    });

    req.write(requestBody);
    req.end();
  });

  if (responsePayload.statusCode < 200 || responsePayload.statusCode >= 300) {
    throw new Error(`Ollama error ${responsePayload.statusCode}: ${responsePayload.body.slice(0, 300)}`);
  }

  let data;
  try {
    data = JSON.parse(responsePayload.body || '{}');
  } catch (error) {
    throw new Error(`Respons Ollama bukan JSON valid: ${error.message}`);
  }

  const text = getString(data?.response) || getString(data?.message?.content);
  if (!text) {
    throw new Error('Respons Ollama kosong.');
  }

  return text;
}

async function generateContentWithFailover(params, customModel, customBaseUrl) {
  const models = getOllamaModelCandidates(customModel);
  const baseUrl = getOllamaBaseUrl(customBaseUrl);
  let lastError;

  for (const modelName of models) {
    try {
      console.log(`[AI] Attempting Ollama generate with model: ${modelName}`);
      const text = await callOllamaGenerate({
        baseUrl,
        model: modelName,
        prompt: params.prompt,
        temperature: params.temperature ?? 0.7,
        numPredict: params.numPredict ?? 4096,
        format: params.format,
        timeoutMs: params.timeoutMs ?? defaultOllamaTimeoutMs,
      });
      console.log(`[AI] Successfully generated content using model: ${modelName}`);
      return { text, model: modelName };
    } catch (err) {
      lastError = err;
      const errMsg = err?.message || String(err);
      console.warn(`[AI Failover] Model ${modelName} failed. Error: ${errMsg.slice(0, 180)}`);
      continue;
    }
  }

  throw lastError || new Error('Semua model Ollama gagal dijalankan.');
}

function getString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getArray(value) {
  return Array.isArray(value) ? value : [];
}

function getAspectRatioPreset(input) {
  const ratio = getString(input);
  return ASPECT_RATIO_PRESETS[ratio] || ASPECT_RATIO_PRESETS['16:9'];
}

function getStoryDurationProfile(input) {
  const key = getString(input) || 'short';
  if (STORY_DURATION_PRESETS[key]) {
    return STORY_DURATION_PRESETS[key];
  }

  const seconds = Number(input);
  if (Number.isFinite(seconds) && seconds > 0) {
    if (seconds >= 780) return STORY_DURATION_PRESETS['15m'];
    if (seconds >= 480) return STORY_DURATION_PRESETS['10m'];
    if (seconds >= 240) return STORY_DURATION_PRESETS['5m'];
    if (seconds >= 135) return STORY_DURATION_PRESETS['3m'];
  }

  return STORY_DURATION_PRESETS.short;
}

function normalizeStoryboardScenes(scenes, fallbackPrompts = []) {
  const source = Array.isArray(scenes) ? scenes : [];
  const normalized = source
    .map((scene, index) => {
      if (typeof scene === 'string') {
        return {
          scene: index + 1,
          title: `Scene ${index + 1}`,
          narration: '',
          visual_prompt: getString(scene),
          duration_seconds: 10,
        };
      }

      if (!scene || typeof scene !== 'object') {
        return null;
      }

      return {
        scene: Number(scene.scene || scene.scene_number || scene.index || index + 1) || index + 1,
        title: getString(scene.title) || getString(scene.beat) || `Scene ${index + 1}`,
        chapter: getString(scene.chapter),
        narration: getString(scene.narration || scene.narasi || scene.voiceover),
        visual_prompt: getString(scene.visual_prompt || scene.visualPrompt || scene.prompt),
        duration_seconds: Math.max(Number(scene.duration_seconds || scene.duration || 10), 4),
      };
    })
    .filter((scene) => scene && (scene.narration || scene.visual_prompt));

  if (normalized.length > 0) {
    return normalized;
  }

  return getArray(fallbackPrompts)
    .map((prompt, index) => ({
      scene: index + 1,
      title: `Scene ${index + 1}`,
      chapter: '',
      narration: '',
      visual_prompt: getString(prompt),
      duration_seconds: 10,
    }))
    .filter((scene) => scene.visual_prompt);
}

function pad2(input) {
  return String(input).padStart(2, '0');
}

function formatLocalSchedule(date) {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

function normalizeScheduledTimeInput(value, source = '', now = new Date()) {
  const raw = getString(value);
  if (!raw) {
    return '';
  }

  if (source === 'schedule') {
    const hhmmOnly = raw.match(/^(\d{2}):(\d{2})$/);
    if (hhmmOnly) {
      const [, hh, mm] = hhmmOnly;
      const candidate = new Date(now);
      candidate.setHours(Number(hh), Number(mm), 0, 0);
      return formatLocalSchedule(candidate);
    }
  }

  return raw;
}

function parseScheduledTime(value, now = new Date()) {
  const raw = getString(value);
  if (!raw) {
    return null;
  }

  let parsed = null;

  const hhmmOnly = raw.match(/^(\d{2}):(\d{2})$/);
  if (hhmmOnly) {
    const [, hh, mm] = hhmmOnly;
    const candidate = new Date(now);
    candidate.setHours(Number(hh), Number(mm), 0, 0);
    if (candidate.getTime() <= now.getTime() + 30 * 1000) {
      candidate.setDate(candidate.getDate() + 1);
    }
    parsed = candidate;
  } else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}$/.test(raw)) {
    parsed = new Date(raw.replace(' ', 'T') + ':00');
  } else if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    parsed = new Date(`${raw}T00:00:00`);
  } else {
    parsed = new Date(raw);
  }

  if (!(parsed instanceof Date) || Number.isNaN(parsed.getTime())) {
    return null;
  }
  return parsed;
}

function buildDispatchPlan(scheduledTimeInput, leadMinutes = defaultRenderLeadMinutes, now = new Date()) {
  const scheduledUploadAt = parseScheduledTime(scheduledTimeInput, now);
  if (!scheduledUploadAt) {
    return {
      isScheduled: false,
      scheduledUploadAt: null,
      dispatchAt: now,
      normalizedScheduledTime: '',
    };
  }

  const dispatchAt = new Date(scheduledUploadAt.getTime() - Math.max(leadMinutes, 0) * 60 * 1000);
  if (dispatchAt.getTime() < now.getTime()) {
    dispatchAt.setTime(now.getTime());
  }

  return {
    isScheduled: true,
    scheduledUploadAt,
    dispatchAt,
    normalizedScheduledTime: formatLocalSchedule(scheduledUploadAt),
  };
}

function deepCloneJsonValue(value, fallback) {
  if (value === undefined) {
    return fallback;
  }

  try {
    return JSON.parse(JSON.stringify(value));
  } catch {
    return fallback;
  }
}

function safeIso(input) {
  if (!input) {
    return '';
  }
  const date = input instanceof Date ? input : new Date(input);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  return date.toISOString();
}

function getOrigin(req) {
  const forwardedProto = getString(req.headers['x-forwarded-proto']);
  const proto = forwardedProto || req.protocol || 'https';
  return `${proto}://${req.get('host')}`;
}

function getBearerToken(req) {
  const authHeader = getString(req.headers.authorization);
  if (!authHeader.startsWith('Bearer ')) {
    return '';
  }

  return authHeader.slice(7).trim();
}

function hashPassword(password, salt) {
  return scryptSync(password, salt, 64).toString('hex');
}

function hashSessionToken(token) {
  return createHash('sha256').update(token).digest('hex');
}

const PRIVATE_SETTINGS_KEYS = [
  'youtubeRefreshToken',
  'youtubeAccessToken',
  'youtubeTokenExpiresAt',
  'youtubeTokenScope',
];

function getYoutubeOAuthStateSecret() {
  return (
    getString(process.env.YOUTUBE_OAUTH_STATE_SECRET) ||
    getString(process.env.VIDGEN_CALLBACK_SECRET) ||
    getString(process.env.N8N_WEBHOOK_SECRET) ||
    getString(process.env.SESSION_SECRET)
  );
}

function getYoutubeOAuthConfig(req) {
  const appBaseUrl = normalizeBaseUrl(process.env.APP_BASE_URL) || getOrigin(req);
  return {
    clientId: getString(process.env.YOUTUBE_CLIENT_ID),
    clientSecret: getString(process.env.YOUTUBE_CLIENT_SECRET),
    redirectUri:
      getString(process.env.YOUTUBE_OAUTH_REDIRECT_URI) ||
      `${appBaseUrl}/api/integrations/youtube/callback`,
    appBaseUrl,
    scope: 'https://www.googleapis.com/auth/youtube.upload',
  };
}

function signYoutubeOAuthState(payload) {
  const secret = getYoutubeOAuthStateSecret();
  if (!secret) {
    throw new Error('Set YOUTUBE_OAUTH_STATE_SECRET atau VIDGEN_CALLBACK_SECRET untuk OAuth YouTube.');
  }

  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = createHmac('sha256', secret).update(encoded).digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyYoutubeOAuthState(state) {
  const secret = getYoutubeOAuthStateSecret();
  if (!secret) {
    throw new Error('OAuth state secret belum dikonfigurasi.');
  }

  const [encoded, signature] = getString(state).split('.');
  if (!encoded || !signature) {
    throw new Error('OAuth state tidak valid.');
  }

  const expected = createHmac('sha256', secret).update(encoded).digest('base64url');
  const actualBuffer = Buffer.from(signature);
  const expectedBuffer = Buffer.from(expected);
  if (actualBuffer.length !== expectedBuffer.length || !timingSafeEqual(actualBuffer, expectedBuffer)) {
    throw new Error('OAuth state signature tidak valid.');
  }

  const payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf8'));
  if (!payload?.uid || Number(payload.exp || 0) < Date.now()) {
    throw new Error('OAuth state sudah kedaluwarsa.');
  }
  return payload;
}

function sanitizeSettingsForClient(settings) {
  const source = settings && typeof settings === 'object' ? settings : {};
  const sanitized = { ...source };
  const youtubeConnected = Boolean(getString(source.youtubeRefreshToken));

  for (const key of PRIVATE_SETTINGS_KEYS) {
    delete sanitized[key];
  }

  return sanitizeObject({
    ...sanitized,
    youtubeConnected,
    youtubeTokenStatus: getString(source.youtubeTokenStatus) || (youtubeConnected ? 'connected' : 'not_connected'),
    youtubeAuthorizedAt: getString(source.youtubeAuthorizedAt),
    youtubeClientConfigured: Boolean(getString(process.env.YOUTUBE_CLIENT_ID) && getString(process.env.YOUTUBE_CLIENT_SECRET)),
  });
}

function mergePublicSettings(existingSettings, incomingSettings) {
  const existing = existingSettings && typeof existingSettings === 'object' ? existingSettings : {};
  const incoming = incomingSettings && typeof incomingSettings === 'object' ? incomingSettings : {};
  const next = { ...incoming };

  for (const key of PRIVATE_SETTINGS_KEYS) {
    delete next[key];
    if (existing[key] !== undefined) {
      next[key] = existing[key];
    }
  }

  if (existing.youtubeAuthorizedAt && !next.youtubeAuthorizedAt) {
    next.youtubeAuthorizedAt = existing.youtubeAuthorizedAt;
  }
  if (existing.youtubeTokenStatus && !next.youtubeTokenStatus) {
    next.youtubeTokenStatus = existing.youtubeTokenStatus;
  }

  return next;
}

async function getYoutubeSettingsForUser(uid) {
  if (!usePostgresQueue() || !uid) {
    return {};
  }

  try {
    return await getAppSettings(uid);
  } catch (error) {
    console.warn('[YouTube OAuth] Gagal membaca settings user:', error);
    return {};
  }
}

async function exchangeYoutubeAuthorizationCode({ code, req }) {
  const config = getYoutubeOAuthConfig(req);
  if (!config.clientId || !config.clientSecret) {
    throw new Error('YOUTUBE_CLIENT_ID dan YOUTUBE_CLIENT_SECRET wajib di-set.');
  }

  const body = new URLSearchParams({
    code,
    client_id: config.clientId,
    client_secret: config.clientSecret,
    redirect_uri: config.redirectUri,
    grant_type: 'authorization_code',
  });

  const response = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body,
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Google OAuth token exchange gagal (${response.status}): ${JSON.stringify(data).slice(0, 500)}`);
  }

  return data;
}

function createPasswordRecord(password) {
  const salt = randomBytes(16).toString('hex');
  return {
    salt,
    hash: hashPassword(password, salt),
  };
}

function verifyPassword(password, salt, expectedHash) {
  if (!password || !salt || !expectedHash) {
    return false;
  }

  const calculatedHash = hashPassword(password, salt);
  const expected = Buffer.from(expectedHash, 'hex');
  const actual = Buffer.from(calculatedHash, 'hex');
  if (expected.length !== actual.length) {
    return false;
  }
  return timingSafeEqual(expected, actual);
}

function getServiceAccount() {
  const inlineJson = getString(process.env.FIREBASE_SERVICE_ACCOUNT_JSON);
  if (inlineJson) {
    return JSON.parse(inlineJson);
  }

  const projectId = getString(process.env.FIREBASE_PROJECT_ID);
  const clientEmail = getString(process.env.FIREBASE_CLIENT_EMAIL);
  const privateKey = getString(process.env.FIREBASE_PRIVATE_KEY).replace(/\\n/g, '\n');

  if (projectId && clientEmail && privateKey) {
    return {
      projectId,
      clientEmail,
      privateKey,
    };
  }

  throw new Error(
    'Firebase Admin belum dikonfigurasi. Set FIREBASE_SERVICE_ACCOUNT_JSON atau FIREBASE_PROJECT_ID, FIREBASE_CLIENT_EMAIL, dan FIREBASE_PRIVATE_KEY.',
  );
}

function getAdminApp() {
  const existingApp = getApps()[0];
  if (existingApp) {
    return existingApp;
  }

  return initializeAdminApp({
    credential: cert(getServiceAccount()),
  });
}

function getAdminDb() {
  const databaseId = getString(process.env.FIRESTORE_DATABASE_ID);
  return databaseId ? getAdminFirestore(getAdminApp(), databaseId) : getAdminFirestore(getAdminApp());
}

async function requireAuthenticatedUser(req) {
  const token = getBearerToken(req);
  if (!token) {
    const error = new Error('Missing bearer token.');
    error.statusCode = 401;
    throw error;
  }

  if (useLocalAuth()) {
    await ensurePostgresQueueSchema();
    const db = getPostgresPool();
    const tokenHash = hashSessionToken(token);
    const result = await db.query(
      `
        SELECT
          s.id AS session_id,
          s.uid,
          s.expires_at,
          u.email,
          u.username,
          u.name,
          u.role,
          u.avatar
        FROM app_sessions s
        INNER JOIN app_users u ON u.uid = s.uid
        WHERE s.token_hash = $1
          AND s.expires_at > NOW()
        LIMIT 1
      `,
      [tokenHash],
    );

    const row = result.rows[0];
    if (!row) {
      const authError = new Error('Token autentikasi tidak valid.');
      authError.statusCode = 401;
      throw authError;
    }

    await db.query(
      `UPDATE app_sessions SET last_seen_at = NOW() WHERE id = $1`,
      [row.session_id],
    ).catch(() => {});

    return {
      uid: row.uid,
      email: row.email || '',
      username: row.username || '',
      name: row.name || 'User',
      role: row.role || 'operator',
      avatar: row.avatar || 'US',
      sessionId: row.session_id,
      authProvider: 'local',
    };
  }

  try {
    return await getAdminAuth(getAdminApp()).verifyIdToken(token);
  } catch (error) {
    const authError = new Error('Token autentikasi tidak valid.');
    authError.statusCode = 401;
    authError.cause = error;
    throw authError;
  }
}

async function ensureLocalAdminUser() {
  if (!useLocalAuth()) {
    return null;
  }

  await ensurePostgresQueueSchema();
  const db = getPostgresPool();
  const username = getString(process.env.VIDGEN_ADMIN_USERNAME) || 'admin';
  const password = getString(process.env.VIDGEN_ADMIN_PASSWORD) || 'admin123';
  const email = getString(process.env.VIDGEN_ADMIN_EMAIL) || 'admin@vidgen.ai';
  const result = await db.query(
    `
      SELECT uid, email, username, name, role, avatar, password_hash, password_salt
      FROM app_users
      WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($2)
      LIMIT 1
    `,
    [username, email],
  );

  const existing = result.rows[0];
  const passwordRecord = createPasswordRecord(password);

  if (!existing) {
    const uid = randomUUID();
    await db.query(
      `
        INSERT INTO app_users (
          uid, email, username, name, role, avatar,
          password_hash, password_salt, auth_provider, created_at, updated_at
        ) VALUES (
          $1, $2, $3, $4, $5, $6,
          $7, $8, 'local', NOW(), NOW()
        )
      `,
      [
        uid,
        email,
        username,
        'Administrator',
        'admin',
        'AD',
        passwordRecord.hash,
        passwordRecord.salt,
      ],
    );
    return {
      uid,
      email,
      username,
      name: 'Administrator',
      role: 'admin',
      avatar: 'AD',
    };
  }

  if (!getString(existing.password_hash) || !getString(existing.password_salt)) {
    await db.query(
      `
        UPDATE app_users
        SET
          password_hash = $2,
          password_salt = $3,
          auth_provider = 'local',
          updated_at = NOW()
        WHERE uid = $1
      `,
      [existing.uid, passwordRecord.hash, passwordRecord.salt],
    );
  }

  return {
    uid: existing.uid,
    email: existing.email || '',
    username: existing.username || username,
    name: existing.name || 'Administrator',
    role: existing.role || 'admin',
    avatar: existing.avatar || 'AD',
  };
}

function sanitizeObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

async function updateProductionJobStatus(jobId, payload) {
  if (usePostgresQueue()) {
    const historyEntry = sanitizeObject({
      status: payload.status,
      at: new Date().toISOString(),
      message: payload.message,
      progress: payload.progress,
      currentStage: payload.currentStage,
      currentNode: payload.currentNode,
      stageLabel: payload.stageLabel,
      executionId: payload.executionId,
      externalJobId: payload.externalJobId,
    });

    const updated = await updateProductionJob(jobId, (current) => {
      const nextHistory = [...(Array.isArray(current.statusHistory) ? current.statusHistory : []), historyEntry];
      const nextIntegration = sanitizeObject({
        ...(current.integration && typeof current.integration === 'object' ? current.integration : {}),
        provider: 'n8n',
        callbackReceivedAt: new Date().toISOString(),
        lastStatusCode: payload.status,
        lastNode: payload.currentNode,
        lastStage: payload.currentStage,
      });

      return {
        status: payload.status,
        progress: payload.progress,
        message: payload.message,
        error: payload.error,
        finalVideoUrl: payload.finalVideoUrl,
        shortVideoUrl: payload.shortVideoUrl,
        thumbnailUrl: payload.thumbnailUrl,
        youtubeUrl: payload.youtubeUrl,
        externalJobId: payload.externalJobId,
        executionId: payload.executionId,
        platformResults: payload.platformResults,
        outputs: payload.outputs,
        currentStage: payload.currentStage,
        currentNode: payload.currentNode,
        stageLabel: payload.stageLabel,
        statusHistory: nextHistory,
        integration: nextIntegration,
      };
    });

    return updated;
  }

  const db = getAdminDb();
  const docRef = db.collection('video_queue').doc(jobId);
  const historyEntry = sanitizeObject({
    status: payload.status,
    at: new Date().toISOString(),
    message: payload.message,
    progress: payload.progress,
    currentStage: payload.currentStage,
    currentNode: payload.currentNode,
    stageLabel: payload.stageLabel,
    executionId: payload.executionId,
    externalJobId: payload.externalJobId,
  });

  await docRef.set(
    sanitizeObject({
      status: payload.status,
      updatedAt: FieldValue.serverTimestamp(),
      progress: payload.progress,
      message: payload.message,
      error: payload.error,
      finalVideoUrl: payload.finalVideoUrl,
      shortVideoUrl: payload.shortVideoUrl,
      thumbnailUrl: payload.thumbnailUrl,
      youtubeUrl: payload.youtubeUrl,
      externalJobId: payload.externalJobId,
      executionId: payload.executionId,
      platformResults: payload.platformResults,
      outputs: payload.outputs,
      currentStage: payload.currentStage,
      currentNode: payload.currentNode,
      stageLabel: payload.stageLabel,
      integration: sanitizeObject({
        provider: 'n8n',
        callbackReceivedAt: new Date().toISOString(),
        lastStatusCode: payload.status,
        lastNode: payload.currentNode,
        lastStage: payload.currentStage,
      }),
      statusHistory: FieldValue.arrayUnion(historyEntry),
    }),
    { merge: true },
  );
}

function parseJsonResponse(rawText, fallbackMessage) {
  if (!rawText || typeof rawText !== 'string') {
    throw new Error(`${fallbackMessage}: Deskripsi respons kosong.`);
  }

  // Strip markdown code blocks if present
  let cleanText = rawText.trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```[a-z]*\n/i, '').replace(/\n```$/m, '').trim();
  }

  try {
    return JSON.parse(cleanText);
  } catch (error) {
    console.error('JSON parse error:', error);
    console.error('Raw text that failed to parse:', rawText);
    throw new Error(`${fallbackMessage}\n${error.message}`);
  }
}

function stripMarkdownJsonFence(rawText) {
  let cleanText = String(rawText || '').trim();
  if (cleanText.startsWith('```')) {
    cleanText = cleanText.replace(/^```[a-z]*\n/i, '').replace(/\n```$/m, '').trim();
  }
  return cleanText;
}

function decodeLooseJsonString(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  try {
    return JSON.parse(`"${text.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`);
  } catch {
    return text
      .replace(/\\"/g, '"')
      .replace(/\\n/g, '\n')
      .replace(/\\r/g, '')
      .replace(/\\t/g, '\t')
      .trim();
  }
}

function extractLooseJsonField(source, fieldName, nextFieldNames = []) {
  const text = String(source || '');
  const nextPattern = nextFieldNames.length
    ? `,\\s*"(?:${nextFieldNames.join('|')})"\\s*:`
    : '$';
  const regex = new RegExp(`"${fieldName}"\\s*:\\s*"([\\s\\S]*?)(?=${nextPattern})`, 'i');
  const match = text.match(regex);
  return decodeLooseJsonString(match?.[1] || '');
}

function extractLooseJsonArray(source, fieldName, nextFieldNames = []) {
  const text = String(source || '');
  const nextPattern = nextFieldNames.length
    ? `,\\s*"(?:${nextFieldNames.join('|')})"\\s*:`
    : '$';
  const regex = new RegExp(`"${fieldName}"\\s*:\\s*\\[([\\s\\S]*?)\\](?=\\s*${nextPattern})`, 'i');
  const match = text.match(regex);
  if (!match?.[1]) {
    return [];
  }

  const items = [];
  const itemRegex = /"((?:\\.|[^"\\])*)"/g;
  let itemMatch;
  while ((itemMatch = itemRegex.exec(match[1])) !== null) {
    const decoded = decodeLooseJsonString(itemMatch[1]);
    if (decoded) {
      items.push(decoded);
    }
  }
  return items;
}

function parseGeneratePayload(rawText, promptTitle = 'Video Menarik') {
  const cleanText = stripMarkdownJsonFence(rawText);
  try {
    return parseJsonResponse(cleanText, 'Respons generate tidak valid.');
  } catch {
    const fallback = {
      narasi: extractLooseJsonField(cleanText, 'narasi', ['video_prompts', 'judul', 'deskripsi', 'hashtags']) || cleanText.slice(0, 5000).trim(),
      video_prompts: extractLooseJsonArray(cleanText, 'video_prompts', ['judul', 'deskripsi', 'hashtags']),
      judul: extractLooseJsonField(cleanText, 'judul', ['deskripsi', 'hashtags']) || promptTitle,
      deskripsi: extractLooseJsonField(cleanText, 'deskripsi', ['hashtags']),
      hashtags: extractLooseJsonArray(cleanText, 'hashtags', []),
    };

    const hasMeaningfulContent =
      getString(fallback.narasi) ||
      getString(fallback.judul) ||
      fallback.video_prompts.length > 0 ||
      getString(fallback.deskripsi) ||
      fallback.hashtags.length > 0;

    if (!hasMeaningfulContent) {
      throw new Error('Respons generate tidak valid dan fallback parser tidak menemukan konten yang bisa dipakai.');
    }

    return fallback;
  }
}

function createFallbackVideoPrompts({
  topic,
  styles,
  mood,
  camera,
  category,
  aspectRatio,
  count = defaultGenerateVideoPromptCount,
}) {
  const styleText = styles.length ? styles.join(', ') : 'cinematic documentary';
  const moodText = getString(mood) || 'informatif dan emosional';
  const cameraText = getString(camera) || 'mixed cinematic coverage';
  const ratioText = getString(aspectRatio) || '16:9';
  const categoryText = getString(category) || 'konten edukatif';
  const totalPrompts = Math.max(6, Math.min(Number(count) || 8, 80));
  const sceneBlueprints = [
    'strong opening shot with a visually striking hero frame and immediate curiosity gap',
    'wide environmental establishing scene showing location, scale, and atmosphere',
    'medium narrative scene focusing on the main subject interacting with the environment',
    'detail-rich close-up sequence highlighting unique textures, objects, and emotional cues',
    'dynamic transition scene with depth, motion, and layered foreground-background composition',
    'dramatic reveal shot showing the most surprising or iconic visual element',
    'reflective cinematic scene that slows down the pacing and builds emotional weight',
    'high production-value closing scene with satisfying visual payoff and memorable composition',
    'bonus variation scene with alternate angle, richer depth, and stronger atmosphere',
    'final retention scene designed to keep viewer attention through the last seconds',
  ];

  return Array.from({ length: totalPrompts }, (_, index) => {
    const blueprint = sceneBlueprints[index % sceneBlueprints.length];
    return [
      `Scene ${index + 1} about ${topic}.`,
      `Main category context: ${categoryText}.`,
      `Visual style: ${styleText}.`,
      `Mood: ${moodText}.`,
      `Camera treatment: ${cameraText}.`,
      `Composition goal: ${blueprint}.`,
      `Show clear subject action, believable environment, layered depth, and cinematic storytelling progression.`,
      `Use intentional lens feel, lighting direction, color contrast, realistic textures, and premium visual detail.`,
      `Frame safely for aspect ratio ${ratioText} with the subject always readable and well-centered for social video.`,
      `No text, no subtitle, no caption, no logo, no watermark, no typography, no UI overlay.`,
    ].join(' ');
  });
}

function createFallbackStoryboard({
  topic,
  styles,
  mood,
  camera,
  category,
  aspectRatio,
  profile,
  characterAnchor = '',
  narrativeMode = 'single',
}) {
  const prompts = createFallbackVideoPrompts({
    topic,
    styles,
    mood,
    camera,
    category,
    aspectRatio,
    count: profile.sceneCount,
  });
  const chapterNames = narrativeMode === 'series'
    ? ['Cold open', 'Setup episode', 'Konflik berkembang', 'Twist episode', 'Cliffhanger']
    : ['Hook', 'Konteks', 'Konflik', 'Puncak', 'Resolusi'];
  const cleanTopic = getString(topic) || 'cerita utama';
  const cleanMood = getString(mood) || 'dramatis dan sinematik';
  const duration = Math.max(Math.round(profile.targetDurationSeconds / Math.max(profile.sceneCount, 1)), 8);

  return Array.from({ length: profile.sceneCount }, (_, index) => {
    const chapter = chapterNames[Math.min(Math.floor((index / profile.sceneCount) * chapterNames.length), chapterNames.length - 1)];
    return {
      scene: index + 1,
      chapter,
      title: `${chapter} ${index + 1}`,
      duration_seconds: duration,
      narration: [
        `Pada bagian ${index + 1}, cerita ${cleanTopic} bergerak melalui fase ${chapter.toLowerCase()}.`,
        `Narasi menjaga rasa ${cleanMood}, memberi detail konkret, dan menghubungkan adegan ini dengan adegan sebelum dan sesudahnya.`,
        `Bagian ini harus terasa seperti potongan cerita yang punya sebab akibat, bukan fakta lepas.`,
      ].join(' '),
      visual_prompt: [
        prompts[index % prompts.length],
        characterAnchor ? `Maintain exact character continuity: ${characterAnchor}.` : '',
        `This is storyboard scene ${index + 1} of ${profile.sceneCount}; visual continuity must match the previous and next scene.`,
      ].filter(Boolean).join(' '),
    };
  });
}

function createFallbackDescription({ title, topic, hashtags }) {
  const cleanTitle = getString(title) || getString(topic) || 'Video Menarik';
  const tagLine = hashtags.length ? `\n\n${hashtags.join(' ')}` : '';
  return `${cleanTitle} dibahas dengan pendekatan yang informatif, visual kuat, dan storytelling yang mudah diikuti dari awal sampai akhir. Video ini dirancang untuk memberi konteks, fakta penting, sudut pandang yang menarik, dan momen visual yang membuat penonton betah menonton lebih lama. Jika kamu suka konten seperti ini, dukung channel dengan subscribe, tinggalkan komentar, dan bagikan ke temanmu agar kami bisa terus membuat video berkualitas tinggi.${tagLine}`;
}

function createFallbackHashtags({ topic, category }) {
  const words = `${getString(topic)} ${getString(category)}`
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/gi, ' ')
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3)
    .slice(0, 5);

  const base = ['#videoedukasi', '#faktaunik', '#indonesia'];
  const dynamic = words.map((item) => `#${item}`);
  return [...new Set([...dynamic, ...base])].slice(0, 8);
}

function createFallbackNarration({ topic, category, mood }) {
  const cleanTopic = getString(topic) || 'topik menarik';
  const cleanCategory = getString(category) || 'umum';
  const cleanMood = getString(mood) || 'informatif dan emosional';
  return [
    `Video ini membahas ${cleanTopic} dari sudut pandang ${cleanCategory} dengan pendekatan ${cleanMood}.`,
    `Pembuka video langsung menyoroti alasan utama kenapa topik ini menarik, relevan, dan layak ditonton sampai selesai.`,
    `Setelah hook awal, narasi bergerak ke konteks utama, fakta penting, dinamika inti, dan penjelasan yang mudah dipahami penonton umum.`,
    `Bagian tengah video memperkuat cerita dengan detail yang lebih dalam, contoh konkret, dan penekanan pada elemen visual yang dramatis serta memikat.`,
    `Menjelang akhir, video memberi payoff yang kuat, merangkum poin penting, dan menutup dengan ajakan agar penonton menonton video lain di channel ini.`,
  ].join(' ');
}

function buildImmediateGenerateFallback({
  topic,
  category,
  styles,
  mood,
  camera,
  aspectRatio,
  profile = STORY_DURATION_PRESETS.short,
}) {
  const judul = getString(topic) || 'Video Menarik';
  const hashtags = createFallbackHashtags({ topic, category });
  const storyboard = createFallbackStoryboard({
    topic,
    category,
    styles,
    mood,
    camera,
    aspectRatio,
    profile,
  });
  return {
    narasi: storyboard.map((scene) => scene.narration).join('\n\n'),
    video_prompts: storyboard.map((scene) => scene.visual_prompt),
    storyboard,
    target_duration_seconds: profile.targetDurationSeconds,
    target_words: profile.targetWords,
    judul,
    deskripsi: createFallbackDescription({ title: judul, topic, hashtags }),
    hashtags,
    fallbackUsed: true,
  };
}

function normalizeSeriesPartsResponse(parsed) {
  if (Array.isArray(parsed)) {
    return parsed;
  }

  if (!parsed || typeof parsed !== 'object') {
    return null;
  }

  const candidates = [
    parsed.parts,
    parsed.items,
    parsed.episodes,
    parsed.series,
    parsed.data,
  ];

  for (const candidate of candidates) {
    if (Array.isArray(candidate)) {
      return candidate;
    }
  }

  return null;
}

function buildSeriesCharacterDefaults(topic, styles, mood, camera) {
  const topicText = getString(topic) || 'serial utama';
  const styleText = styles.length ? styles.join(', ') : 'cinematic documentary';
  return {
    character_name: 'Protagonis Utama',
    character_anchor: `Recurring main protagonist for ${topicText}, same face identity, same age range, same hairstyle, same skin tone, same facial proportions, same wardrobe language, same cinematic style ${styleText}.`,
    character_negative_prompt: 'different person, identity change, face swap, bad anatomy, extra fingers, extra limbs, blurry, low quality, text, caption, subtitle, logo, watermark, typography',
    visual_style: styleText,
    camera_style: getString(camera) || 'mixed cinematic coverage',
    mood: getString(mood) || 'informatif dan dramatis',
  };
}

async function getYouTubeMetadata(videoUrl) {
  try {
    const response = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(videoUrl)}&format=json`,
    );

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return {
      title: data.title || '',
      author: data.author_name || '',
    };
  } catch (error) {
    console.warn('Unable to fetch YouTube metadata:', error);
    return null;
  }
}

function getIntegrationSettings(jobData, overrides = {}, requestOrigin = '') {
  const integration = jobData?.integration && typeof jobData.integration === 'object' ? jobData.integration : {};
  const override = overrides && typeof overrides === 'object' ? overrides : {};
  const origin = getString(requestOrigin);
  const appBaseUrl =
    getString(override.appBaseUrl) ||
    getString(integration.appBaseUrl) ||
    origin ||
    getString(process.env.APP_BASE_URL);

  return {
    webhookUrl:
      getString(override.webhookUrl) ||
      getString(integration.webhookUrl) ||
      getString(process.env.N8N_WEBHOOK_URL),
    webhookSecret:
      getString(override.webhookSecret) ||
      getString(override.secret) ||
      getString(integration.webhookSecret) ||
      getString(process.env.N8N_WEBHOOK_SECRET),
    callbackUrl:
      getString(override.callbackUrl) ||
      getString(integration.callbackUrl) ||
      (origin ? `${origin}/api/integrations/n8n/callback` : ''),
    callbackSecret: getString(process.env.VIDGEN_CALLBACK_SECRET),
    appBaseUrl,
    hfToken:
      getString(override.hfToken) ||
      getString(integration.hfToken) ||
      getString(process.env.HUGGINGFACE_TOKEN),
    comfyApiUrl:
      getString(override.comfyApiUrl) ||
      getString(integration.comfyApiUrl) ||
      getString(process.env.COMFYUI_API_URL),
    comfyApiKey:
      getString(override.comfyApiKey) ||
      getString(integration.comfyApiKey) ||
      getString(process.env.COMFYUI_API_KEY),
    comfyWorkflowFile:
      getString(override.comfyWorkflowFile) ||
      getString(integration.comfyWorkflowFile) ||
      getString(process.env.COMFYUI_WORKFLOW_FILE),
    targetUploadAt: getString(integration.targetUploadAt),
    renderLeadMinutes: Number(integration.renderLeadMinutes || defaultRenderLeadMinutes),
  };
}

function getLatestStatusHistoryEntry(jobData) {
  const history = Array.isArray(jobData?.statusHistory) ? [...jobData.statusHistory] : [];
  return history
    .filter(Boolean)
    .sort((a, b) => Date.parse(b?.at || '') - Date.parse(a?.at || ''))[0] || null;
}

function isWaitingForUpload(jobData) {
  const latest = getLatestStatusHistoryEntry(jobData);
  const currentNode = getString(jobData?.currentNode) || getString(latest?.currentNode);
  return /wait until upload time/i.test(currentNode);
}

function buildWebhookPayloadFromJob(jobId, jobData) {
  const integration = getIntegrationSettings(jobData);
  const metadata = jobData.metadata && typeof jobData.metadata === 'object' ? jobData.metadata : {};
  const forceImmediateUpload = Boolean(metadata.forceImmediateUpload);
  return {
    jobId,
    uid: jobData.uid || '',
    title: getString(jobData.title) || 'Video tanpa judul',
    description: getString(jobData.description),
    prompt: getString(jobData.prompt),
    source: getString(jobData.source) || 'dashboard',
    category: getString(jobData.category) || 'Umum',
    scheduledTime: forceImmediateUpload ? '' : getString(jobData.scheduledTime),
    scheduledUploadAt: forceImmediateUpload ? '' : integration.targetUploadAt,
    callbackUrl: integration.callbackUrl,
    callbackSecret: integration.callbackSecret,
    metadata,
    appBaseUrl: integration.appBaseUrl,
    huggingfaceToken: integration.hfToken,
    comfyApiUrl: integration.comfyApiUrl,
    comfyApiKey: integration.comfyApiKey,
    comfyWorkflowFile: integration.comfyWorkflowFile,
    renderLeadMinutes: integration.renderLeadMinutes,
  };
}

async function createQueuedRetryJob({
  user,
  originalJobId,
  originalJobData,
  scheduledTimeInput,
  integrationOverride = {},
  requestOrigin = '',
  now = new Date(),
}) {
  if (usePostgresQueue()) {
    const source = getString(originalJobData?.source) || 'manual';
    const normalizedScheduledInput = normalizeScheduledTimeInput(scheduledTimeInput, source, now);
    const dispatchPlan = buildDispatchPlan(normalizedScheduledInput, defaultRenderLeadMinutes, now);
    const integrationSettings = getIntegrationSettings(originalJobData, integrationOverride, requestOrigin);
    const shouldDispatchViaWebhook = Boolean(integrationSettings.webhookUrl);
    const normalizedScheduledTime =
      dispatchPlan.normalizedScheduledTime ||
      normalizedScheduledInput ||
      getString(originalJobData?.scheduledTime);
    const forceImmediateUpload = isWaitingForUpload(originalJobData);
    const retryDispatchAtIso = shouldDispatchViaWebhook ? safeIso(now) : null;
    const retryTargetUploadAtIso =
      shouldDispatchViaWebhook && !forceImmediateUpload ? safeIso(dispatchPlan.scheduledUploadAt) : null;
    const retryCount = Number(originalJobData?.metadata?.retryCount || 0) + 1;
    const clonedMetadata = deepCloneJsonValue(originalJobData?.metadata, {});
    const nextMetadata = sanitizeObject({
      ...(clonedMetadata && typeof clonedMetadata === 'object' ? clonedMetadata : {}),
      retryOfJobId: originalJobId,
      retryCount,
      retriedFromStatus: getString(originalJobData?.status) || 'unknown',
      retriedFromNode: getString(originalJobData?.currentNode),
      retriedAt: now.toISOString(),
      forceImmediateUpload,
    });

    const createdJob = await insertProductionJob({
      id: randomUUID(),
      uid: user.uid,
      title: getString(originalJobData?.title) || 'Video tanpa judul',
      description: getString(originalJobData?.description),
      prompt: getString(originalJobData?.prompt),
      source,
      category: getString(originalJobData?.category) || 'Umum',
      scheduledTime: normalizedScheduledTime,
      status: shouldDispatchViaWebhook ? 'queued' : 'pending',
      progress: 0,
      metadata: nextMetadata,
      integration: sanitizeObject({
        provider: shouldDispatchViaWebhook ? 'n8n' : 'internal',
        webhookUrl: integrationSettings.webhookUrl || null,
        webhookSecret: shouldDispatchViaWebhook ? integrationSettings.webhookSecret : null,
        hfToken: shouldDispatchViaWebhook ? integrationSettings.hfToken : null,
        comfyApiUrl: shouldDispatchViaWebhook ? integrationSettings.comfyApiUrl : null,
        comfyApiKey: shouldDispatchViaWebhook ? integrationSettings.comfyApiKey : null,
        comfyWorkflowFile: shouldDispatchViaWebhook ? integrationSettings.comfyWorkflowFile : null,
        callbackUrl: shouldDispatchViaWebhook ? integrationSettings.callbackUrl : null,
        appBaseUrl: integrationSettings.appBaseUrl,
        dispatchMode: shouldDispatchViaWebhook
          ? ((dispatchPlan.isScheduled && !forceImmediateUpload) ? 'retry-scheduled-webhook' : 'retry-webhook')
          : 'disabled',
        dispatchStatus: shouldDispatchViaWebhook ? 'pending' : 'disabled',
        dispatchAt: retryDispatchAtIso,
        targetUploadAt: retryTargetUploadAtIso,
        renderLeadMinutes: integrationSettings.renderLeadMinutes || defaultRenderLeadMinutes,
        dispatchAttempts: 0,
        retriedFromJobId: originalJobId,
      }),
      statusHistory: [
        {
          status: shouldDispatchViaWebhook ? 'queued' : 'pending',
          at: now.toISOString(),
          message: shouldDispatchViaWebhook
            ? `Retry job dibuat dari ${originalJobId} dengan jadwal upload ${normalizedScheduledTime || '(unspecified)'}.`
            : 'Retry job dibuat di antrean internal.',
          stageLabel: 'Retry dijadwalkan',
        },
      ],
    });

    await updateProductionJob(originalJobId, (current) => ({
      retryTriggeredAt: now.toISOString(),
      retryChildJobId: createdJob.id,
      statusHistory: [
        ...(Array.isArray(current.statusHistory) ? current.statusHistory : []),
        {
          status: getString(originalJobData?.status) || 'processing',
          at: now.toISOString(),
          message: `Retry baru dibuat sebagai job ${createdJob.id} dengan jadwal ${normalizedScheduledTime || '(unspecified)'}.`,
          stageLabel: 'Retry dibuat dari dashboard',
          currentNode: getString(originalJobData?.currentNode),
        },
      ],
    }));

    if (shouldDispatchViaWebhook) {
      (async () => {
        try {
          await processDispatchForDoc(createdJob.id);
        } catch (err) {
          console.error('[Dispatch] Immediate retry attempt gagal:', err);
        }
      })();
    }

    return {
      jobId: createdJob.id,
      status: createdJob.status,
      scheduledTime: normalizedScheduledTime,
    };
  }

  const db = getAdminDb();
  const source = getString(originalJobData?.source) || 'manual';
  const normalizedScheduledInput = normalizeScheduledTimeInput(scheduledTimeInput, source, now);
  const dispatchPlan = buildDispatchPlan(normalizedScheduledInput, defaultRenderLeadMinutes, now);
  const integrationSettings = getIntegrationSettings(originalJobData, integrationOverride, requestOrigin);
  const shouldDispatchViaWebhook = Boolean(integrationSettings.webhookUrl);
  const normalizedScheduledTime = dispatchPlan.normalizedScheduledTime || normalizedScheduledInput || getString(originalJobData?.scheduledTime);
  const forceImmediateUpload = isWaitingForUpload(originalJobData);
  const retryDispatchAtIso = shouldDispatchViaWebhook ? safeIso(now) : null;
  const retryTargetUploadAtIso =
    shouldDispatchViaWebhook && !forceImmediateUpload ? safeIso(dispatchPlan.scheduledUploadAt) : null;
  const retryCount = Number(originalJobData?.metadata?.retryCount || 0) + 1;
  const clonedMetadata = deepCloneJsonValue(originalJobData?.metadata, {});
  const nextMetadata = sanitizeObject({
    ...(clonedMetadata && typeof clonedMetadata === 'object' ? clonedMetadata : {}),
    retryOfJobId: originalJobId,
    retryCount,
    retriedFromStatus: getString(originalJobData?.status) || 'unknown',
    retriedFromNode: getString(originalJobData?.currentNode),
    retriedAt: now.toISOString(),
    forceImmediateUpload,
  });

  const jobRef = db.collection('video_queue').doc();
  const baseJob = {
    uid: user.uid,
    title: getString(originalJobData?.title) || 'Video tanpa judul',
    description: getString(originalJobData?.description),
    prompt: getString(originalJobData?.prompt),
    source,
    category: getString(originalJobData?.category) || 'Umum',
    scheduledTime: normalizedScheduledTime,
    status: shouldDispatchViaWebhook ? 'queued' : 'pending',
    createdAt: FieldValue.serverTimestamp(),
    updatedAt: FieldValue.serverTimestamp(),
    metadata: nextMetadata,
    integration: sanitizeObject({
      provider: shouldDispatchViaWebhook ? 'n8n' : 'internal',
      webhookUrl: integrationSettings.webhookUrl || null,
      webhookSecret: shouldDispatchViaWebhook ? integrationSettings.webhookSecret : null,
      hfToken: shouldDispatchViaWebhook ? integrationSettings.hfToken : null,
      comfyApiUrl: shouldDispatchViaWebhook ? integrationSettings.comfyApiUrl : null,
      comfyApiKey: shouldDispatchViaWebhook ? integrationSettings.comfyApiKey : null,
      comfyWorkflowFile: shouldDispatchViaWebhook ? integrationSettings.comfyWorkflowFile : null,
      callbackUrl: shouldDispatchViaWebhook ? integrationSettings.callbackUrl : null,
      appBaseUrl: integrationSettings.appBaseUrl,
      dispatchMode: shouldDispatchViaWebhook
        ? ((dispatchPlan.isScheduled && !forceImmediateUpload) ? 'retry-scheduled-webhook' : 'retry-webhook')
        : 'disabled',
      dispatchStatus: shouldDispatchViaWebhook ? 'pending' : 'disabled',
      dispatchAt: retryDispatchAtIso,
      targetUploadAt: retryTargetUploadAtIso,
      renderLeadMinutes: integrationSettings.renderLeadMinutes || defaultRenderLeadMinutes,
      dispatchAttempts: 0,
      retriedFromJobId: originalJobId,
    }),
    statusHistory: [
      {
        status: shouldDispatchViaWebhook ? 'queued' : 'pending',
        at: now.toISOString(),
        message: shouldDispatchViaWebhook
          ? `Retry job dibuat dari ${originalJobId} dengan jadwal upload ${normalizedScheduledTime || '(unspecified)'}.`
          : 'Retry job dibuat di antrean internal.',
        stageLabel: 'Retry dijadwalkan',
      },
    ],
  };

  await jobRef.set(baseJob);

  await db.collection('video_queue').doc(originalJobId).set(
    {
      updatedAt: FieldValue.serverTimestamp(),
      retryTriggeredAt: now.toISOString(),
      retryChildJobId: jobRef.id,
      statusHistory: FieldValue.arrayUnion({
        status: getString(originalJobData?.status) || 'processing',
        at: now.toISOString(),
        message: `Retry baru dibuat sebagai job ${jobRef.id} dengan jadwal ${normalizedScheduledTime || '(unspecified)'}.`,
        stageLabel: 'Retry dibuat dari dashboard',
        currentNode: getString(originalJobData?.currentNode),
      }),
    },
    { merge: true },
  );

  if (shouldDispatchViaWebhook) {
    (async () => {
      try {
        await processDispatchForDoc(jobRef);
      } catch (err) {
        console.error('[Dispatch] Immediate retry attempt gagal:', err);
      }
    })();
  }

  return {
    jobId: jobRef.id,
    status: baseJob.status,
    scheduledTime: normalizedScheduledTime,
  };
}

async function dispatchJobToN8n(jobId, jobData) {
  const integration = getIntegrationSettings(jobData);
  if (!integration.webhookUrl) {
    throw new Error('Webhook URL tidak tersedia untuk dispatch.');
  }

  const payload = buildWebhookPayloadFromJob(jobId, jobData);
  const youtubeSettings = await getYoutubeSettingsForUser(jobData.uid);
  const youtubeRefreshToken = getString(youtubeSettings.youtubeRefreshToken);
  if (youtubeRefreshToken) {
    payload.youtubeClientId = getString(process.env.YOUTUBE_CLIENT_ID);
    payload.youtubeClientSecret = getString(process.env.YOUTUBE_CLIENT_SECRET);
    payload.youtubeRefreshToken = youtubeRefreshToken;
    payload.youtubePrivacyStatus =
      getString(youtubeSettings.youtubePrivacyStatus) ||
      getString(process.env.YOUTUBE_PRIVACY_STATUS) ||
      'private';
  }

  const response = await fetch(integration.webhookUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${integration.webhookSecret}`,
      'x-vidgen-webhook-secret': integration.webhookSecret,
    },
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Dispatch gagal (${response.status}): ${text.slice(0, 250)}`);
  }
}

function safeCompareSecret(actual, expected) {
  if (!actual || !expected) {
    return false;
  }

  const actualBuffer = Buffer.from(String(actual));
  const expectedBuffer = Buffer.from(String(expected));
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

function getN8nWorkerSecret() {
  return (
    getString(process.env.VIDGEN_WORKER_SECRET) ||
    getString(process.env.VIDGEN_CALLBACK_SECRET) ||
    getString(process.env.N8N_WEBHOOK_SECRET)
  );
}

function verifyN8nWorkerRequest(req) {
  const expected = getN8nWorkerSecret();
  const provided =
    getString(req.headers['x-vidgen-worker-secret']) ||
    getString(req.headers['x-vidgen-callback-secret']) ||
    getString(req.body?.callbackSecret) ||
    getString(req.body?.data?.callbackSecret);

  return safeCompareSecret(provided, expected);
}

function decodeBase64Utf8(value) {
  const raw = getString(value);
  if (!raw) {
    return '';
  }
  return Buffer.from(raw, 'base64').toString('utf8');
}

function assertNonEmptyWorkerPath(value, label) {
  const resolved = getString(value);
  if (!resolved) {
    throw new Error(`${label} kosong.`);
  }
  if (resolved.includes('\0') || /(^|[\\/])\.\.([\\/]|$)/.test(resolved)) {
    throw new Error(`${label} tidak aman.`);
  }
  return resolved;
}

function assertSafeWorkerJobDir(value) {
  const jobDir = assertNonEmptyWorkerPath(value, 'jobDir');
  const normalized = jobDir.replace(/\\/g, '/');
  if (!/\/vidgen_[A-Za-z0-9._-]+$/.test(normalized)) {
    throw new Error(`jobDir tidak aman: ${jobDir}`);
  }
  return jobDir;
}

function getScriptPath(fileName) {
  const scriptPath = path.join(rootDir, 'scripts', fileName);
  if (!fs.existsSync(scriptPath)) {
    throw new Error(`Script tidak ditemukan: ${scriptPath}`);
  }
  return scriptPath;
}

function appendLimited(current, chunk, limit = 1024 * 1024) {
  const next = current + chunk;
  if (next.length <= limit) {
    return next;
  }
  return `${next.slice(0, Math.floor(limit / 2))}\n...[output truncated]...\n${next.slice(-Math.floor(limit / 2))}`;
}

function runWorkerCommand(command, args = [], options = {}) {
  const timeoutMs = Number(options.timeoutMs || 30 * 60 * 1000);
  const env = {
    ...process.env,
    ...(options.env || {}),
  };

  return new Promise((resolve) => {
    let stdout = '';
    let stderr = '';
    let timedOut = false;

    const child = spawn(command, args, {
      cwd: options.cwd || rootDir,
      env,
      windowsHide: true,
      shell: false,
    });

    const timeout = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
      setTimeout(() => {
        if (!child.killed) {
          child.kill('SIGKILL');
        }
      }, 5000).unref();
    }, timeoutMs);

    child.stdout?.on('data', (chunk) => {
      stdout = appendLimited(stdout, chunk.toString());
    });

    child.stderr?.on('data', (chunk) => {
      stderr = appendLimited(stderr, chunk.toString());
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      resolve({
        exitCode: 127,
        stdout,
        stderr: appendLimited(stderr, error.message),
        timedOut: false,
      });
    });

    child.on('close', (code) => {
      clearTimeout(timeout);
      resolve({
        exitCode: timedOut ? 124 : Number(code || 0),
        stdout,
        stderr: timedOut ? appendLimited(stderr, `Command timeout after ${timeoutMs}ms`) : stderr,
        timedOut,
      });
    });
  });
}

async function commandExists(command) {
  if (process.platform === 'win32') {
    const result = await runWorkerCommand('where.exe', [command], { timeoutMs: 10000 });
    return result.exitCode === 0;
  }

  const result = await runWorkerCommand('sh', ['-lc', `command -v ${command}`], { timeoutMs: 10000 });
  return result.exitCode === 0;
}

async function probeMediaDuration(filePath) {
  const result = await runWorkerCommand(
    'ffprobe',
    ['-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', filePath],
    { timeoutMs: 30000 },
  );
  const value = parseFloat(getString(result.stdout));
  return Number.isFinite(value) ? value : 0;
}

async function countGeneratedClips(clipsDir) {
  try {
    const entries = await fs.promises.readdir(clipsDir);
    return entries.filter((entry) => /^clip_.*\.mp4$/i.test(entry)).length;
  } catch {
    return 0;
  }
}

function sendWorkerResult(res, result) {
  const status = Number(result.exitCode || 0) === 0 ? 200 : 500;
  return res.status(status).json({
    ok: status === 200,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: Number(result.exitCode || 0),
    ...(result.timedOut ? { timedOut: true } : {}),
  });
}

async function runN8nWorkerOperation(operation, data) {
  const payload = data && typeof data === 'object' ? data : {};
  const jobDir = assertSafeWorkerJobDir(payload.jobDir);

  if (operation === 'preflight') {
    const publicDir = assertNonEmptyWorkerPath(payload.publicDir, 'publicDir');
    await fs.promises.mkdir(path.join(jobDir, 'clips'), { recursive: true });
    await fs.promises.mkdir(publicDir, { recursive: true });

    const requiredCommands = ['ffmpeg', 'ffprobe', 'python3', 'edge-tts'];
    const missing = [];
    for (const command of requiredCommands) {
      if (!(await commandExists(command))) {
        missing.push(command);
      }
    }

    if (missing.length) {
      return {
        exitCode: 1,
        stdout: '',
        stderr: `[PREFLIGHT ERROR] dependency tidak ditemukan: ${missing.join(', ')}`,
      };
    }

    return {
      exitCode: 0,
      stdout: `PREFLIGHT_OK\nDIRS_OK\nJOB_DIR:${jobDir}\nPUBLIC_DIR:${publicDir}\n`,
      stderr: '',
    };
  }

  if (operation === 'tts') {
    const narasiPath = assertNonEmptyWorkerPath(payload.narasiPath, 'narasiPath');
    const narasiTxtPath = assertNonEmptyWorkerPath(payload.narasiTxtPath, 'narasiTxtPath');
    const ttsVoice = getString(payload.ttsVoice) || 'id-ID-ArdiNeural';
    const narasi = decodeBase64Utf8(payload.narasiB64);
    await fs.promises.mkdir(jobDir, { recursive: true });
    await fs.promises.writeFile(narasiTxtPath, narasi, 'utf8');

    const result = await runWorkerCommand(
      'edge-tts',
      ['--file', narasiTxtPath, '--voice', ttsVoice, '--write-media', narasiPath],
      { timeoutMs: 10 * 60 * 1000 },
    );

    if (result.exitCode !== 0) {
      return result;
    }

    const duration = await probeMediaDuration(narasiPath);
    return {
      exitCode: 0,
      stdout: `${result.stdout || ''}\nTTS_OK\nAUDIO_PATH:${narasiPath}\nAUDIO_DURATION:${duration}\n`,
      stderr: result.stderr || '',
    };
  }

  if (operation === 'subtitles') {
    const narasiTxtPath = assertNonEmptyWorkerPath(payload.narasiTxtPath, 'narasiTxtPath');
    const outputPath = path.join(jobDir, 'subs.srt');
    return runWorkerCommand(
      'python3',
      [getScriptPath('generate_subtitles.py'), narasiTxtPath, String(Number(payload.audio_duration || 0)), outputPath],
      { timeoutMs: 2 * 60 * 1000 },
    );
  }

  if (operation === 'generate_clips') {
    const clipsDir = assertNonEmptyWorkerPath(payload.clipsDir, 'clipsDir');
    const jobId = getString(payload.jobId) || path.basename(jobDir).replace(/^vidgen_/, '');
    const promptsFile = path.join(jobDir, `vidgen_${jobId}_prompts.json`);
    const promptsJson = decodeBase64Utf8(payload.promptsB64);
    const characterAnchor = decodeBase64Utf8(payload.characterAnchorB64);
    const negativePrompt = decodeBase64Utf8(payload.negativePromptB64);
    await fs.promises.mkdir(clipsDir, { recursive: true });
    await fs.promises.writeFile(promptsFile, promptsJson, 'utf8');

    const env = {
      HUGGINGFACE_TOKEN: getString(payload.huggingfaceToken) || getString(process.env.HUGGINGFACE_TOKEN),
      COMFYUI_API_URL: getString(payload.comfyApiUrl) || getString(process.env.COMFYUI_API_URL),
      COMFYUI_API_KEY: getString(payload.comfyApiKey) || getString(process.env.COMFYUI_API_KEY),
      COMFYUI_WORKFLOW_FILE: getString(payload.comfyWorkflowFile) || getString(process.env.COMFYUI_WORKFLOW_FILE),
      VIDEO_MODEL_URL: getString(payload.videoModelUrl) || getString(process.env.VIDEO_MODEL_URL),
      REPLICATE_API_TOKEN: getString(process.env.REPLICATE_API_TOKEN),
      REPLICATE_MODEL: getString(process.env.REPLICATE_MODEL) || 'black-forest-labs/flux-schnell',
      VIDGEN_OUTPUT_WIDTH: String(Number(payload.outputWidth || 1280)),
      VIDGEN_OUTPUT_HEIGHT: String(Number(payload.outputHeight || 720)),
      VIDGEN_GEN_WIDTH: String(Number(payload.genWidth || 768)),
      VIDGEN_GEN_HEIGHT: String(Number(payload.genHeight || 432)),
    };

    const result = await runWorkerCommand(
      'python3',
      [
        getScriptPath('generate_clips.py'),
        '--clips-dir',
        clipsDir,
        '--prompts-file',
        promptsFile,
        '--hf-token',
        env.HUGGINGFACE_TOKEN || '',
        '--clip-duration',
        String(Number(payload.clipDuration || 8)),
        '--seed-base',
        String(Number(payload.characterSeed || 0)),
        '--character-anchor',
        characterAnchor,
        '--negative-prompt',
        negativePrompt,
        '--reference-image-url',
        getString(payload.characterRefImageUrl),
        '--consistency-strength',
        String(Number(payload.consistencyStrength ?? 0.8)),
      ],
      { env, timeoutMs: 90 * 60 * 1000 },
    );

    if (result.exitCode !== 0) {
      return result;
    }

    const clipCount = await countGeneratedClips(clipsDir);
    return {
      ...result,
      stdout: `${result.stdout || ''}\nCLIPS_GENERATED:${clipCount}\nCLIPS_DIR:${clipsDir}\nCLIPS_OK\n`,
    };
  }

  if (operation === 'assemble_video') {
    const env = {
      VIDGEN_OUTPUT_WIDTH: String(Number(payload.outputWidth || 1280)),
      VIDGEN_OUTPUT_HEIGHT: String(Number(payload.outputHeight || 720)),
    };

    return runWorkerCommand(
      'python3',
      [
        getScriptPath('assemble_video.py'),
        '--job-dir',
        jobDir,
        '--clips-dir',
        assertNonEmptyWorkerPath(payload.clipsDir, 'clipsDir'),
        '--filelist',
        assertNonEmptyWorkerPath(payload.filelistPath, 'filelistPath'),
        '--audio',
        assertNonEmptyWorkerPath(payload.audio_path || payload.narasiPath, 'audio'),
        '--raw',
        assertNonEmptyWorkerPath(payload.rawVideoPath, 'rawVideoPath'),
        '--final',
        assertNonEmptyWorkerPath(payload.finalVideoPath, 'finalVideoPath'),
        '--short',
        assertNonEmptyWorkerPath(payload.shortVideoPath, 'shortVideoPath'),
        '--thumb',
        assertNonEmptyWorkerPath(payload.thumbPath, 'thumbPath'),
        '--srt',
        path.join(jobDir, 'subs.srt'),
        '--burn-subtitles',
        '--output-width',
        String(Number(payload.outputWidth || 1280)),
        '--output-height',
        String(Number(payload.outputHeight || 720)),
      ],
      { env, timeoutMs: 60 * 60 * 1000 },
    );
  }

  if (operation === 'publish_files') {
    const publicDir = assertNonEmptyWorkerPath(payload.publicDir, 'publicDir');
    const finalVideoPath = assertNonEmptyWorkerPath(payload.finalVideoPath, 'finalVideoPath');
    const shortVideoPath = assertNonEmptyWorkerPath(payload.shortVideoPath, 'shortVideoPath');
    const thumbPath = getString(payload.thumbPath);
    await fs.promises.mkdir(publicDir, { recursive: true });
    await fs.promises.copyFile(finalVideoPath, path.join(publicDir, 'final.mp4'));
    await fs.promises.copyFile(shortVideoPath, path.join(publicDir, 'short.mp4'));
    if (thumbPath && fs.existsSync(thumbPath)) {
      await fs.promises.copyFile(thumbPath, path.join(publicDir, 'thumb.jpg'));
    }

    if (process.platform !== 'win32') {
      await runWorkerCommand('chmod', ['-R', '755', publicDir], { timeoutMs: 30000 });
    }

    return {
      exitCode: 0,
      stdout: `PUBLIC_OK\nPUBLIC_FINAL:${payload.finalVideoUrl || ''}\nPUBLIC_SHORT:${payload.shortVideoUrl || ''}\n`,
      stderr: '',
    };
  }

  if (operation === 'upload_youtube') {
    const env = {
      YOUTUBE_CLIENT_ID: decodeBase64Utf8(payload.youtubeClientIdB64) || getString(process.env.YOUTUBE_CLIENT_ID),
      YOUTUBE_CLIENT_SECRET: decodeBase64Utf8(payload.youtubeClientSecretB64) || getString(process.env.YOUTUBE_CLIENT_SECRET),
      YOUTUBE_REFRESH_TOKEN: decodeBase64Utf8(payload.youtubeRefreshTokenB64) || getString(process.env.YOUTUBE_REFRESH_TOKEN),
      YOUTUBE_PRIVACY_STATUS: getString(payload.youtubePrivacyStatus) || getString(process.env.YOUTUBE_PRIVACY_STATUS) || 'private',
    };

    const tags = Array.isArray(payload.tags) ? payload.tags.join(',') : getString(payload.tags);
    const result = await runWorkerCommand(
      'python3',
      [
        getScriptPath('upload_platforms.py'),
        '--platforms',
        'youtube',
        '--final-video',
        assertNonEmptyWorkerPath(payload.finalVideoPath, 'finalVideoPath'),
        '--short-video',
        assertNonEmptyWorkerPath(payload.shortVideoPath, 'shortVideoPath'),
        '--thumb',
        getString(payload.thumbPath),
        '--title-yt',
        getString(payload.judul) || getString(payload.title) || 'Video',
        '--desc-yt',
        getString(payload.deskripsi),
        '--yt-category',
        getString(payload.youtubeCategory) || '27',
        '--tags',
        tags,
      ],
      { env, timeoutMs: 60 * 60 * 1000 },
    );

    const credentialMarkers = [
      `[UPLOAD] YOUTUBE_CLIENT_ID loaded: ${env.YOUTUBE_CLIENT_ID ? 'yes' : 'no'}`,
      `[UPLOAD] YOUTUBE_CLIENT_SECRET loaded: ${env.YOUTUBE_CLIENT_SECRET ? 'yes' : 'no'}`,
      `[UPLOAD] YOUTUBE_REFRESH_TOKEN loaded: ${env.YOUTUBE_REFRESH_TOKEN ? 'yes' : 'no'}`,
    ].join('\n');

    return {
      ...result,
      stdout: `${credentialMarkers}\n${result.stdout || ''}`,
    };
  }

  if (operation === 'cleanup') {
    await fs.promises.rm(jobDir, { recursive: true, force: true });
    return {
      exitCode: 0,
      stdout: 'CLEANUP_OK\n',
      stderr: '',
    };
  }

  return {
    exitCode: 1,
    stdout: '',
    stderr: `Operasi worker tidak dikenal: ${operation}`,
  };
}

async function claimDueJobForDispatch(jobRefOrId) {
  if (usePostgresQueue()) {
    const jobId = typeof jobRefOrId === 'string' ? jobRefOrId : String(jobRefOrId?.id || '');
    if (!jobId) {
      return { claimed: false, data: null };
    }

    const claimed = await updateProductionJob(jobId, (current) => {
      const integration = current.integration && typeof current.integration === 'object' ? current.integration : {};
      const status = getString(current.status);
      const dispatchStatus = getString(integration.dispatchStatus);
      const dispatchAt = parseScheduledTime(getString(integration.dispatchAt));

      if (status !== 'queued' || dispatchStatus !== 'pending') {
        return null;
      }

      if (dispatchAt && dispatchAt.getTime() > Date.now()) {
        return null;
      }

      return {
        integration: sanitizeObject({
          ...integration,
          dispatchStatus: 'dispatching',
          dispatchLockAt: new Date().toISOString(),
          dispatchAttempts: Number(integration.dispatchAttempts || 0) + 1,
        }),
      };
    });

    if (!claimed) {
      return { claimed: false, data: null };
    }

    const integration = claimed.integration && typeof claimed.integration === 'object' ? claimed.integration : {};
    if (getString(claimed.status) !== 'queued' || getString(integration.dispatchStatus) !== 'dispatching') {
      return { claimed: false, data: null };
    }

    return { claimed: true, data: claimed };
  }

  const db = getAdminDb();
  const docRef = typeof jobRefOrId === 'string'
    ? db.collection('video_queue').doc(jobRefOrId)
    : jobRefOrId;

  if (!docRef?.id) {
    return { claimed: false, data: null };
  }

  return db.runTransaction(async (tx) => {
    const snapshot = await tx.get(docRef);
    if (!snapshot.exists) {
      return { claimed: false, data: null };
    }

    const data = snapshot.data() || {};
    const integration = data.integration && typeof data.integration === 'object' ? data.integration : {};
    const status = getString(data.status);
    const dispatchStatus = getString(integration.dispatchStatus);
    const dispatchAt = parseScheduledTime(getString(integration.dispatchAt));

    if (status !== 'queued' || dispatchStatus !== 'pending') {
      return { claimed: false, data: null };
    }

    if (dispatchAt && dispatchAt.getTime() > Date.now()) {
      return { claimed: false, data: null };
    }

    tx.set(
      docRef,
      {
        updatedAt: FieldValue.serverTimestamp(),
        integration: sanitizeObject({
          ...integration,
          dispatchStatus: 'dispatching',
          dispatchLockAt: new Date().toISOString(),
          dispatchAttempts: Number(integration.dispatchAttempts || 0) + 1,
        }),
      },
      { merge: true },
    );

    return { claimed: true, data };
  });
}

async function processDispatchForDoc(docRefOrId) {
  const claimed = await claimDueJobForDispatch(docRefOrId);
  if (!claimed.claimed || !claimed.data) {
    return false;
  }

  const jobData = claimed.data;
  const integration = jobData.integration && typeof jobData.integration === 'object' ? jobData.integration : {};
  const attempts = Number(integration.dispatchAttempts || 1);
  const jobId = typeof docRefOrId === 'string' ? docRefOrId : docRefOrId.id;

  try {
    await dispatchJobToN8n(jobId, jobData);
    if (usePostgresQueue()) {
      await updateProductionJob(jobId, (current) => ({
        integration: sanitizeObject({
          ...(current.integration && typeof current.integration === 'object' ? current.integration : {}),
          dispatchStatus: 'sent',
          dispatchLockAt: null,
          dispatchedAt: new Date().toISOString(),
          dispatchError: null,
        }),
        statusHistory: [
          ...(Array.isArray(current.statusHistory) ? current.statusHistory : []),
          {
            status: 'queued',
            at: new Date().toISOString(),
            message: 'Job berhasil dikirim ke n8n.',
          },
        ],
      }));
    } else {
      await docRefOrId.set(
        {
          updatedAt: FieldValue.serverTimestamp(),
          integration: sanitizeObject({
            ...integration,
            dispatchStatus: 'sent',
            dispatchLockAt: null,
            dispatchedAt: new Date().toISOString(),
            dispatchError: null,
          }),
          statusHistory: FieldValue.arrayUnion({
            status: 'queued',
            at: new Date().toISOString(),
            message: 'Job berhasil dikirim ke n8n.',
          }),
        },
        { merge: true },
      );
    }
    return true;
  } catch (error) {
    const retryAt = new Date(Date.now() + dispatchRetryMinutes * 60 * 1000);
    if (usePostgresQueue()) {
      await updateProductionJob(jobId, (current) => ({
        integration: sanitizeObject({
          ...(current.integration && typeof current.integration === 'object' ? current.integration : {}),
          dispatchStatus: 'pending',
          dispatchLockAt: null,
          dispatchAt: safeIso(retryAt),
          dispatchError: getString(error?.message || String(error)).slice(0, 400),
        }),
        statusHistory: [
          ...(Array.isArray(current.statusHistory) ? current.statusHistory : []),
          {
            status: 'queued',
            at: new Date().toISOString(),
            message: `Dispatch ke n8n gagal (attempt ${attempts}). Retry ${dispatchRetryMinutes} menit lagi.`,
          },
        ],
      }));
    } else {
      await docRefOrId.set(
        {
          updatedAt: FieldValue.serverTimestamp(),
          integration: sanitizeObject({
            ...integration,
            dispatchStatus: 'pending',
            dispatchLockAt: null,
            dispatchAt: safeIso(retryAt),
            dispatchError: getString(error?.message || String(error)).slice(0, 400),
          }),
          statusHistory: FieldValue.arrayUnion({
            status: 'queued',
            at: new Date().toISOString(),
            message: `Dispatch ke n8n gagal (attempt ${attempts}). Retry ${dispatchRetryMinutes} menit lagi.`,
          }),
        },
        { merge: true },
      );
    }
    console.error(`[Dispatch] Gagal job ${jobId}:`, error);
    return false;
  }
}

let dispatchLoopBusy = false;

async function dispatchDueQueuedJobs() {
  if (dispatchLoopBusy) {
    return;
  }
  dispatchLoopBusy = true;
  try {
    if (usePostgresQueue()) {
      const jobs = await listQueuedJobsForDispatch(100);
      for (const job of jobs) {
        const integration = job.integration && typeof job.integration === 'object' ? job.integration : {};
        if (getString(integration.provider) !== 'n8n') {
          continue;
        }
        if (getString(integration.dispatchStatus) !== 'pending') {
          continue;
        }
        const dispatchAt = parseScheduledTime(getString(integration.dispatchAt));
        if (dispatchAt && dispatchAt.getTime() > Date.now()) {
          continue;
        }
        await processDispatchForDoc(job.id);
      }
      return;
    }

    const db = getAdminDb();
    const snapshot = await db.collection('video_queue').where('status', '==', 'queued').limit(50).get();
    if (snapshot.empty) {
      return;
    }

    for (const doc of snapshot.docs) {
      const data = doc.data() || {};
      const integration = data.integration && typeof data.integration === 'object' ? data.integration : {};
      if (getString(integration.provider) !== 'n8n') {
        continue;
      }
      if (getString(integration.dispatchStatus) !== 'pending') {
        continue;
      }
      const dispatchAt = parseScheduledTime(getString(integration.dispatchAt));
      if (dispatchAt && dispatchAt.getTime() > Date.now()) {
        continue;
      }
      await processDispatchForDoc(doc.ref);
    }
  } catch (error) {
    console.error('[Dispatch Scheduler] Loop error:', error);
  } finally {
    dispatchLoopBusy = false;
  }
}

async function cleanupExpiredData() {
  try {
    if (usePostgresQueue()) {
      const result = await prunePostgresQueue(dataRetentionDays);
      if (result.deletedQueue > 0) {
        console.log(
          `[Cleanup] Deleted old postgres queue rows. queue=${result.deletedQueue}, retentionDays=${dataRetentionDays}`,
        );
      }
    }

    if (usePostgresQueue() && useLocalAuth()) {
      return;
    }

    const result = await pruneOldDocs(dataRetentionDays);
    if (result.deletedHistory > 0 || result.deletedQueue > 0) {
      console.log(
        `[Cleanup] Deleted old docs. history=${result.deletedHistory}, video_queue=${result.deletedQueue}, retentionDays=${result.retentionDays}`,
      );
    }
  } catch (error) {
    console.error('[Cleanup] Failed to prune old Firestore data:', error);
  }
}

function createApiRouter() {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      model: defaultModel,
      queueBackend: usePostgresQueue() ? 'postgres' : 'firestore',
    });
  });

  router.get('/integrations/n8n/health', (_req, res) => {
    res.json({
      ok: true,
      queueBackend: usePostgresQueue() ? 'postgres' : 'firestore',
      authBackend: useLocalAuth() ? 'postgres' : 'firebase',
      webhookConfigured: Boolean(getString(process.env.N8N_WEBHOOK_URL)),
      callbackSecretConfigured: Boolean(getString(process.env.VIDGEN_CALLBACK_SECRET)),
      workerApiConfigured: Boolean(getN8nWorkerSecret()),
      firestoreDatabaseId: getString(process.env.FIRESTORE_DATABASE_ID) || '(default)',
      firebaseAdminConfigured:
        Boolean(getString(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) ||
        (Boolean(getString(process.env.FIREBASE_PROJECT_ID)) &&
          Boolean(getString(process.env.FIREBASE_CLIENT_EMAIL)) &&
          Boolean(getString(process.env.FIREBASE_PRIVATE_KEY))),
    });
  });

  router.post('/integrations/n8n/worker', async (req, res) => {
    if (!verifyN8nWorkerRequest(req)) {
      return sendError(res, 401, 'Unauthorized', 'x-vidgen-worker-secret tidak valid.');
    }

    const operation = getString(req.body?.operation);
    const data = req.body?.data && typeof req.body.data === 'object' ? req.body.data : {};

    try {
      const result = await runN8nWorkerOperation(operation, data);
      return sendWorkerResult(res, result);
    } catch (error) {
      console.error('[n8n worker] Operation failed:', operation, error);
      return res.status(500).json({
        ok: false,
        stdout: '',
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: 1,
      });
    }
  });

  router.post('/auth/login', async (req, res) => {
    const username = getString(req.body?.username);
    const password = getString(req.body?.password);

    if (!username || !password) {
      return sendError(res, 400, 'Username dan password wajib diisi.');
    }

    try {
      if (!useLocalAuth()) {
        return sendError(res, 503, 'Mode auth lokal belum aktif di server.');
      }

      await ensureLocalAdminUser();
      const db = getPostgresPool();
      const result = await db.query(
        `
          SELECT uid, email, username, name, role, avatar, password_hash, password_salt
          FROM app_users
          WHERE LOWER(username) = LOWER($1) OR LOWER(email) = LOWER($1)
          LIMIT 1
        `,
        [username],
      );

      const row = result.rows[0];
      if (!row || !verifyPassword(password, row.password_salt || '', row.password_hash || '')) {
        return sendError(res, 401, 'Unauthorized', 'Username atau password salah.');
      }

      const rawToken = randomBytes(32).toString('hex');
      const tokenHash = hashSessionToken(rawToken);
      const sessionId = randomUUID();
      const expiresAt = new Date(Date.now() + sessionTtlDays * 24 * 60 * 60 * 1000);

      await db.query(
        `
          INSERT INTO app_sessions (id, uid, token_hash, user_agent, expires_at, created_at, last_seen_at)
          VALUES ($1, $2, $3, $4, $5, NOW(), NOW())
        `,
        [sessionId, row.uid, tokenHash, getString(req.headers['user-agent']), expiresAt],
      );

      await db.query(
        `UPDATE app_users SET last_login_at = NOW(), updated_at = NOW() WHERE uid = $1`,
        [row.uid],
      ).catch(() => {});

      return res.json({
        ok: true,
        token: rawToken,
        expiresAt: expiresAt.toISOString(),
        user: {
          username: row.username || username,
          name: row.name || 'User',
          role: row.role || 'operator',
          avatar: row.avatar || 'US',
        },
        backend: 'postgres',
      });
    } catch (error) {
      console.error('[Auth Login] Error:', error);
      return sendError(res, 500, 'Gagal login.', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/auth/me', async (req, res) => {
    try {
      const user = await requireAuthenticatedUser(req);
      return res.json({
        ok: true,
        user: {
          username: user.username || user.email?.split('@')[0] || 'user',
          name: user.name || 'User',
          role: user.role || 'operator',
          avatar: user.avatar || (user.name || user.email || 'U').slice(0, 2).toUpperCase(),
        },
        backend: useLocalAuth() ? 'postgres' : 'firebase',
      });
    } catch (error) {
      return sendError(res, error.statusCode || 401, 'Unauthorized', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/auth/logout', async (req, res) => {
    const token = getBearerToken(req);
    if (!token) {
      return res.json({ ok: true });
    }

    try {
      if (useLocalAuth()) {
        await ensurePostgresQueueSchema();
        await getPostgresPool().query(
          `DELETE FROM app_sessions WHERE token_hash = $1`,
          [hashSessionToken(token)],
        );
      }
      return res.json({ ok: true });
    } catch (error) {
      return sendError(res, 500, 'Gagal logout.', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/app-bootstrap', async (req, res) => {
    let user;

    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(
        res,
        error.statusCode || 401,
        'Unauthorized',
        error instanceof Error ? error.message : String(error),
      );
    }

    try {
      if (!usePostgresQueue()) {
        return res.json({
          ok: true,
          backend: 'firestore',
          profile: {
            uid: user.uid,
            email: user.email || '',
            username: getString(req.body?.profile?.username) || (user.email?.split('@')[0] || 'user'),
            name: getString(req.body?.profile?.name) || user.name || 'User',
            role: 'operator',
            avatar: getString(req.body?.profile?.avatar) || (user.name || user.email || 'U').slice(0, 2).toUpperCase(),
          },
          settings: {},
          history: [],
          schedules: { items: [], isPaused: false },
        });
      }

      const profilePayload = {
        uid: user.uid,
        email: user.email || '',
        username: getString(req.body?.profile?.username) || (user.email?.split('@')[0] || 'user'),
        name: getString(req.body?.profile?.name) || user.name || 'User',
        role: getString(req.body?.profile?.role) || 'operator',
        avatar: getString(req.body?.profile?.avatar) || (user.name || user.email || 'U').slice(0, 2).toUpperCase(),
      };

      const profile = await upsertAppUser(profilePayload);
      const settings = await getAppSettings(user.uid);
      const history = await listAppHistory(user.uid, 50);
      const schedules = await getAppSchedules(user.uid);

      return res.json({
        ok: true,
        backend: 'postgres',
        profile,
        settings: sanitizeSettingsForClient(settings),
        history,
        schedules,
      });
    } catch (error) {
      console.error('[App Bootstrap] Error:', error);
      return sendError(
        res,
        500,
        'Gagal bootstrap data aplikasi.',
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  router.get('/settings', async (req, res) => {
    let user;
    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(res, error.statusCode || 401, 'Unauthorized', error instanceof Error ? error.message : String(error));
    }

    try {
      return res.json({
        ok: true,
        settings: usePostgresQueue() ? sanitizeSettingsForClient(await getAppSettings(user.uid)) : {},
      });
    } catch (error) {
      return sendError(res, 500, 'Gagal mengambil settings.', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/settings', async (req, res) => {
    let user;
    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(res, error.statusCode || 401, 'Unauthorized', error instanceof Error ? error.message : String(error));
    }

    try {
      if (!usePostgresQueue()) {
        return res.json({ ok: true, settings: sanitizeSettingsForClient(req.body || {}) });
      }
      const existingSettings = await getAppSettings(user.uid);
      const settings = await setAppSettings(
        user.uid,
        mergePublicSettings(existingSettings, req.body && typeof req.body === 'object' ? req.body : {}),
      );
      return res.json({ ok: true, settings: sanitizeSettingsForClient(settings) });
    } catch (error) {
      return sendError(res, 500, 'Gagal menyimpan settings.', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/integrations/youtube/status', async (req, res) => {
    let user;
    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(res, error.statusCode || 401, 'Unauthorized', error instanceof Error ? error.message : String(error));
    }

    try {
      const config = getYoutubeOAuthConfig(req);
      const settings = await getYoutubeSettingsForUser(user.uid);
      return res.json({
        ok: true,
        configured: Boolean(config.clientId && config.clientSecret),
        redirectUri: config.redirectUri,
        youtube: {
          connected: Boolean(getString(settings.youtubeRefreshToken)),
          tokenStatus: getString(settings.youtubeTokenStatus) || (getString(settings.youtubeRefreshToken) ? 'connected' : 'not_connected'),
          authorizedAt: getString(settings.youtubeAuthorizedAt),
          scope: getString(settings.youtubeTokenScope),
          privacyStatus: getString(settings.youtubePrivacyStatus) || getString(process.env.YOUTUBE_PRIVACY_STATUS) || 'private',
        },
      });
    } catch (error) {
      return sendError(res, 500, 'Gagal membaca status YouTube.', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/integrations/youtube/connect', async (req, res) => {
    let user;
    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(res, error.statusCode || 401, 'Unauthorized', error instanceof Error ? error.message : String(error));
    }

    if (!usePostgresQueue()) {
      return sendError(res, 503, 'Connect YouTube membutuhkan PostgreSQL settings backend.');
    }

    try {
      const config = getYoutubeOAuthConfig(req);
      if (!config.clientId || !config.clientSecret) {
        return sendError(
          res,
          400,
          'YOUTUBE_CLIENT_ID dan YOUTUBE_CLIENT_SECRET wajib di-set di server app.',
        );
      }

      const state = signYoutubeOAuthState({
        uid: user.uid,
        nonce: randomBytes(16).toString('hex'),
        exp: Date.now() + 15 * 60 * 1000,
      });
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', config.clientId);
      authUrl.searchParams.set('redirect_uri', config.redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', config.scope);
      authUrl.searchParams.set('access_type', 'offline');
      authUrl.searchParams.set('prompt', 'consent');
      authUrl.searchParams.set('include_granted_scopes', 'false');
      authUrl.searchParams.set('state', state);

      return res.json({
        ok: true,
        authUrl: authUrl.toString(),
        redirectUri: config.redirectUri,
      });
    } catch (error) {
      return sendError(res, 500, 'Gagal membuat URL OAuth YouTube.', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/integrations/youtube/disconnect', async (req, res) => {
    let user;
    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(res, error.statusCode || 401, 'Unauthorized', error instanceof Error ? error.message : String(error));
    }

    if (!usePostgresQueue()) {
      return sendError(res, 503, 'Disconnect YouTube membutuhkan PostgreSQL settings backend.');
    }

    try {
      const settings = await getAppSettings(user.uid);
      const nextSettings = { ...(settings && typeof settings === 'object' ? settings : {}) };
      for (const key of PRIVATE_SETTINGS_KEYS) {
        delete nextSettings[key];
      }
      nextSettings.youtubeTokenStatus = 'not_connected';
      nextSettings.youtubeAuthorizedAt = '';
      const saved = await setAppSettings(user.uid, nextSettings);
      return res.json({ ok: true, settings: sanitizeSettingsForClient(saved) });
    } catch (error) {
      return sendError(res, 500, 'Gagal memutus koneksi YouTube.', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/integrations/youtube/callback', async (req, res) => {
    const config = getYoutubeOAuthConfig(req);
    const redirectToSettings = (status, detail = '') => {
      const redirectUrl = new URL(config.appBaseUrl || getOrigin(req));
      redirectUrl.searchParams.set('youtube', status);
      if (detail) {
        redirectUrl.searchParams.set('youtube_detail', detail.slice(0, 180));
      }
      return res.redirect(302, redirectUrl.toString());
    };

    if (req.query?.error) {
      return redirectToSettings('error', getString(req.query.error_description || req.query.error));
    }

    try {
      if (!usePostgresQueue()) {
        return redirectToSettings('error', 'PostgreSQL settings backend belum aktif.');
      }

      const statePayload = verifyYoutubeOAuthState(req.query?.state);
      const code = getString(req.query?.code);
      if (!code) {
        throw new Error('Authorization code tidak dikirim oleh Google.');
      }

      const tokenData = await exchangeYoutubeAuthorizationCode({ code, req });
      const refreshToken = getString(tokenData.refresh_token);
      if (!refreshToken) {
        throw new Error('Google tidak mengembalikan refresh_token. Ulangi connect dengan prompt consent.');
      }

      const existingSettings = await getAppSettings(statePayload.uid);
      const saved = await setAppSettings(statePayload.uid, {
        ...(existingSettings && typeof existingSettings === 'object' ? existingSettings : {}),
        youtubeRefreshToken: refreshToken,
        youtubeAccessToken: getString(tokenData.access_token),
        youtubeTokenExpiresAt: tokenData.expires_in
          ? new Date(Date.now() + Number(tokenData.expires_in) * 1000).toISOString()
          : '',
        youtubeTokenScope: getString(tokenData.scope),
        youtubeTokenStatus: 'connected',
        youtubeAuthorizedAt: new Date().toISOString(),
      });

      console.log('[YouTube OAuth] Connected account for uid:', statePayload.uid, {
        scope: getString(saved.youtubeTokenScope),
      });
      return redirectToSettings('connected');
    } catch (error) {
      console.error('[YouTube OAuth] Callback failed:', error);
      return redirectToSettings('error', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/history', async (req, res) => {
    let user;
    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(res, error.statusCode || 401, 'Unauthorized', error instanceof Error ? error.message : String(error));
    }

    try {
      return res.json({
        ok: true,
        history: usePostgresQueue() ? await listAppHistory(user.uid, 50) : [],
      });
    } catch (error) {
      return sendError(res, 500, 'Gagal mengambil history.', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/history', async (req, res) => {
    let user;
    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(res, error.statusCode || 401, 'Unauthorized', error instanceof Error ? error.message : String(error));
    }

    try {
      if (!usePostgresQueue()) {
        return res.json({ ok: true });
      }
      const item = await insertAppHistory({
        id: randomUUID(),
        uid: user.uid,
        desc: getString(req.body?.desc),
        kategori: getString(req.body?.kategori),
        slots: Array.isArray(req.body?.slots) ? req.body.slots : [],
        result: getString(req.body?.result),
        time: getString(req.body?.time),
        savedAt: getString(req.body?.savedAt) || new Date().toISOString(),
      });
      return res.status(201).json({ ok: true, item });
    } catch (error) {
      return sendError(res, 500, 'Gagal menyimpan history.', error instanceof Error ? error.message : String(error));
    }
  });

  router.delete('/history', async (req, res) => {
    let user;
    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(res, error.statusCode || 401, 'Unauthorized', error instanceof Error ? error.message : String(error));
    }

    try {
      const deleted = usePostgresQueue() ? await deleteAppHistoryByUser(user.uid) : 0;
      return res.json({ ok: true, deleted });
    } catch (error) {
      return sendError(res, 500, 'Gagal menghapus history.', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/schedules', async (req, res) => {
    let user;
    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(res, error.statusCode || 401, 'Unauthorized', error instanceof Error ? error.message : String(error));
    }

    try {
      return res.json({
        ok: true,
        schedules: usePostgresQueue() ? await getAppSchedules(user.uid) : { items: [], isPaused: false },
      });
    } catch (error) {
      return sendError(res, 500, 'Gagal mengambil schedules.', error instanceof Error ? error.message : String(error));
    }
  });

  router.post('/schedules', async (req, res) => {
    let user;
    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(res, error.statusCode || 401, 'Unauthorized', error instanceof Error ? error.message : String(error));
    }

    try {
      if (!usePostgresQueue()) {
        return res.json({ ok: true, schedules: { items: Array.isArray(req.body?.items) ? req.body.items : [], isPaused: Boolean(req.body?.isPaused) } });
      }
      const schedules = await setAppSchedules(
        user.uid,
        Array.isArray(req.body?.items) ? req.body.items : [],
        Boolean(req.body?.isPaused),
      );
      return res.json({ ok: true, schedules });
    } catch (error) {
      return sendError(res, 500, 'Gagal menyimpan schedules.', error instanceof Error ? error.message : String(error));
    }
  });

  router.get('/production-jobs', async (req, res) => {
    let user;

    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(
        res,
        error.statusCode || 401,
        'Unauthorized',
        error instanceof Error ? error.message : String(error),
      );
    }

    try {
      if (usePostgresQueue()) {
        const jobs = await listProductionJobsByUser(user.uid, 300);
        return res.json({
          ok: true,
          jobs,
          backend: 'postgres',
        });
      }

      const snapshot = await getAdminDb()
        .collection('video_queue')
        .where('uid', '==', user.uid)
        .limit(300)
        .get();
      const jobs = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      }));
      return res.json({
        ok: true,
        jobs,
        backend: 'firestore',
      });
    } catch (error) {
      console.error('[Production Queue] Gagal mengambil daftar job:', error);
      return sendError(
        res,
        500,
        'Gagal mengambil daftar job antrean produksi.',
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  router.post('/production-jobs', async (req, res) => {
    let user;

    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(
        res,
        error.statusCode || 401,
        'Unauthorized',
        error instanceof Error ? error.message : String(error),
      );
    }

    try {
      const jobsRaw = Array.isArray(req.body?.jobs) ? req.body.jobs : [req.body];
      const results = [];
      const db = usePostgresQueue() ? null : getAdminDb();

      for (const jobData of jobsRaw) {
        const title = getString(jobData?.title) || 'Video tanpa judul';
        const description = getString(jobData?.description);
        const prompt = getString(jobData?.prompt);
        const source = getString(jobData?.source) || 'manual';
        const category = getString(jobData?.category);
        const scheduledTime = getString(jobData?.scheduledTime);
        const metadata = jobData?.metadata && typeof jobData.metadata === 'object' ? jobData.metadata : {};
        const forceImmediateUpload = Boolean(metadata.forceImmediateUpload) || source === 'clipper';
        const normalizedScheduledInput = forceImmediateUpload
          ? ''
          : normalizeScheduledTimeInput(scheduledTime, source, new Date());
        const integration = jobData?.integration && typeof jobData.integration === 'object' ? jobData.integration : {};

        const webhookUrl = getString(integration.webhookUrl) || getString(process.env.N8N_WEBHOOK_URL);
        const webhookSecret = getString(integration.secret) || getString(process.env.N8N_WEBHOOK_SECRET);
        const hfToken = getString(integration.hfToken) || getString(process.env.HUGGINGFACE_TOKEN);
        const comfyApiUrl = getString(integration.comfyApiUrl) || getString(process.env.COMFYUI_API_URL);
        const comfyApiKey = getString(integration.comfyApiKey) || getString(process.env.COMFYUI_API_KEY);
        const comfyWorkflowFile = getString(integration.comfyWorkflowFile) || getString(process.env.COMFYUI_WORKFLOW_FILE);

        if (!prompt) continue;

        const callbackUrl = `${getOrigin(req)}/api/integrations/n8n/callback`;
        const now = new Date();
        const dispatchPlan = buildDispatchPlan(normalizedScheduledInput, defaultRenderLeadMinutes, now);
        const shouldDispatchViaWebhook = Boolean(webhookUrl);
        const normalizedScheduledTime = forceImmediateUpload
          ? formatLocalSchedule(now)
          : (dispatchPlan.normalizedScheduledTime || normalizedScheduledInput || scheduledTime);

        const baseJob = {
          id: usePostgresQueue() ? randomUUID() : '',
          uid: user.uid,
          title,
          description,
          prompt,
          source,
          category,
          scheduledTime: normalizedScheduledTime,
          status: shouldDispatchViaWebhook ? 'queued' : 'pending',
          createdAt: FieldValue.serverTimestamp(),
          updatedAt: FieldValue.serverTimestamp(),
          metadata,
          integration: sanitizeObject({
            provider: shouldDispatchViaWebhook ? 'n8n' : 'internal',
            webhookUrl: webhookUrl || null,
            webhookSecret: shouldDispatchViaWebhook ? webhookSecret : null,
            hfToken: shouldDispatchViaWebhook ? hfToken : null,
            comfyApiUrl: shouldDispatchViaWebhook ? comfyApiUrl : null,
            comfyApiKey: shouldDispatchViaWebhook ? comfyApiKey : null,
            comfyWorkflowFile: shouldDispatchViaWebhook ? comfyWorkflowFile : null,
            callbackUrl: shouldDispatchViaWebhook ? callbackUrl : null,
            appBaseUrl: getOrigin(req),
            dispatchMode: shouldDispatchViaWebhook
              ? ((dispatchPlan.isScheduled && !forceImmediateUpload) ? 'scheduled-webhook' : 'webhook')
              : 'disabled',
            dispatchStatus: shouldDispatchViaWebhook ? 'pending' : 'disabled',
            dispatchAt: shouldDispatchViaWebhook ? safeIso(dispatchPlan.dispatchAt) : null,
            targetUploadAt: shouldDispatchViaWebhook && !forceImmediateUpload ? safeIso(dispatchPlan.scheduledUploadAt) : null,
            renderLeadMinutes: defaultRenderLeadMinutes,
            dispatchAttempts: 0,
          }),
          statusHistory: [
            {
              status: shouldDispatchViaWebhook ? 'queued' : 'pending',
              at: new Date().toISOString(),
              message: shouldDispatchViaWebhook
                ? ((dispatchPlan.isScheduled && !forceImmediateUpload)
                  ? `Job dijadwalkan upload ${normalizedScheduledTime || '(unspecified)'} dan akan mulai diproses sekitar ${formatLocalSchedule(dispatchPlan.dispatchAt)}.`
                  : 'Job disimpan dan akan langsung diproses ke n8n.')
                : 'Job disimpan ke antrean internal.',
            },
          ],
        };

        let createdJobId = '';
        let dispatchTarget = null;
        if (usePostgresQueue()) {
          const createdJob = await insertProductionJob(baseJob);
          createdJobId = createdJob.id;
          dispatchTarget = createdJob.id;
        } else {
          const jobRef = db.collection('video_queue').doc();
          createdJobId = jobRef.id;
          dispatchTarget = jobRef;
          await jobRef.set({
            ...baseJob,
            id: undefined,
          });
        }

        if (shouldDispatchViaWebhook) {
          // Immediate attempt for due jobs; scheduled jobs will be handled by polling loop.
          (async () => {
            try {
              await processDispatchForDoc(dispatchTarget);
            } catch (err) {
              console.error('[Dispatch] Immediate attempt gagal:', err);
            }
          })();
        }

        results.push({ jobId: createdJobId, title, status: baseJob.status });
      }

      if (results.length === 0) {
        return sendError(
          res,
          400,
          'Tidak ada job valid yang bisa dimasukkan ke antrean.',
          'Pastikan setiap job memiliki prompt/narasi yang terisi.',
        );
      }

      return res.status(202).json({
        ok: true,
        count: results.length,
        jobs: results,
        message: `Berhasil menambahkan ${results.length} job ke antrean.`
      });
    } catch (error) {
      console.error('[Production Queue] Gagal membuat job:', error);
      return sendError(
        res,
        500,
        'Gagal membuat job antrean produksi.',
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  router.post('/production-jobs/:jobId/retry', async (req, res) => {
    let user;

    try {
      user = await requireAuthenticatedUser(req);
    } catch (error) {
      return sendError(
        res,
        error.statusCode || 401,
        'Unauthorized',
        error instanceof Error ? error.message : String(error),
      );
    }

    const originalJobId = getString(req.params?.jobId);
    const scheduledTime = getString(req.body?.scheduledTime);
    const integrationOverride =
      req.body?.integration && typeof req.body.integration === 'object' ? req.body.integration : {};

    if (!originalJobId) {
      return sendError(res, 400, 'jobId wajib ada di URL.');
    }

    if (!scheduledTime) {
      return sendError(res, 400, 'scheduledTime wajib dikirim.');
    }

    try {
      let originalJobData = null;
      if (usePostgresQueue()) {
        originalJobData = await getProductionJobById(originalJobId);
      } else {
        const originalRef = getAdminDb().collection('video_queue').doc(originalJobId);
        const snapshot = await originalRef.get();
        if (snapshot.exists) {
          originalJobData = snapshot.data() || {};
        }
      }

      if (!originalJobData) {
        return sendError(res, 404, 'Job asal tidak ditemukan.');
      }

      if (getString(originalJobData.uid) !== user.uid) {
        return sendError(res, 403, 'Anda tidak berhak me-retry job ini.');
      }

      const retryJob = await createQueuedRetryJob({
        user,
        originalJobId,
        originalJobData,
        scheduledTimeInput: scheduledTime,
        integrationOverride,
        requestOrigin: getOrigin(req),
      });

      return res.status(202).json({
        ok: true,
        jobId: retryJob.jobId,
        status: retryJob.status,
        scheduledTime: retryJob.scheduledTime,
        message: `Retry job berhasil dibuat dengan jadwal ${retryJob.scheduledTime}.`,
      });
    } catch (error) {
      console.error('[Retry Job] Error:', error);
      return sendError(
        res,
        500,
        'Gagal membuat retry job.',
        error instanceof Error ? error.message : String(error),
      );
    }
  });


  router.post('/integrations/n8n/callback', async (req, res) => {
    const expectedSecret = getString(process.env.VIDGEN_CALLBACK_SECRET);
    const receivedSecret =
      getString(req.headers['x-vidgen-callback-secret']) ||
      getString(req.headers['x-vidgen-secret']);

    if (expectedSecret && receivedSecret !== expectedSecret) {
      return sendError(res, 401, 'Callback secret tidak valid.');
    }

    const jobId = getString(req.body?.jobId);
    const status = getString(req.body?.status) || 'processing';

    if (!jobId) {
      return sendError(res, 400, 'jobId wajib dikirim pada callback.');
    }

    try {
      if (usePostgresQueue()) {
        const existingJob = await getProductionJobById(jobId);
        if (!existingJob) {
          return sendError(res, 404, 'Job tidak ditemukan.');
        }
      } else {
        const snapshot = await getAdminDb().collection('video_queue').doc(jobId).get();
        if (!snapshot.exists) {
          return sendError(res, 404, 'Job tidak ditemukan.');
        }
      }

      await updateProductionJobStatus(jobId, {
        status,
        progress: req.body?.progress,
        message: getString(req.body?.message),
        error: req.body?.error,
        finalVideoUrl: getString(req.body?.finalVideoUrl),
        shortVideoUrl: getString(req.body?.shortVideoUrl),
        thumbnailUrl: getString(req.body?.thumbnailUrl),
        youtubeUrl: getString(req.body?.youtubeUrl),
        externalJobId: getString(req.body?.externalJobId),
        executionId: getString(req.body?.executionId),
        currentStage: getString(req.body?.currentStage),
        currentNode: getString(req.body?.currentNode || req.body?.nodeName),
        stageLabel: getString(req.body?.stageLabel || req.body?.statusLabel),
        platformResults:
          req.body?.platformResults && typeof req.body.platformResults === 'object'
            ? req.body.platformResults
            : undefined,
        outputs:
          req.body?.outputs && typeof req.body.outputs === 'object' ? req.body.outputs : undefined,
      });

      return res.json({
        ok: true,
        jobId,
        status,
      });
    } catch (error) {
      console.error('N8N callback failed:', error);
      return sendError(
        res,
        500,
        'Gagal memperbarui status job dari n8n.',
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  router.get('/health', (req, res) => {
    res.json({
      status: 'ok',
      version: '1.2.0',
      timestamp: new Date().toISOString(),
      model: process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct',
      ollamaBaseUrl: getOllamaBaseUrl(),
      ollamaTimeoutMs: defaultOllamaTimeoutMs,
      queueBackend: usePostgresQueue() ? 'postgres' : 'firestore',
    });
  });

  router.post('/generate', async (req, res) => {
    const startedAt = Date.now();
    const {
      desc,
      selectedStyles,
      selectedCats,
      mood,
      camera,
      aspectRatio,
      isSeries,
      targetDuration,
      targetDurationSeconds,
      ollamaBaseUrl,
      ollamaModel,
      geminiModel, // backward compatibility
    } = req.body || {};
    const modelToUse = getString(ollamaModel) || getString(geminiModel) || defaultModel;
    const baseUrlToUse = getString(ollamaBaseUrl) || defaultOllamaBaseUrl;
    let finalDesc = getString(desc);
    const styles = getArray(selectedStyles);
    const cats = getArray(selectedCats);
    const aspectPreset = getAspectRatioPreset(aspectRatio);
    const durationProfile = getStoryDurationProfile(getString(targetDuration) || targetDurationSeconds);
    console.log('[Generate] Incoming request', {
      isSeries: Boolean(isSeries),
      descLength: finalDesc.length,
      stylesCount: styles.length,
      catsCount: cats.length,
      slotsCount: Array.isArray(req.body?.slots) ? req.body.slots.length : 0,
      modelToUse,
      baseUrlToUse,
      aspectRatio: aspectPreset.ratio,
      duration: durationProfile.id,
      targetDurationSeconds: durationProfile.targetDurationSeconds,
      userAgent: getString(req.headers['user-agent']).slice(0, 160),
    });

    // 1. Auto-Topic if description is empty
    if (!finalDesc) {
      const primaryCat = getString(cats[0]) || 'Umum';
      try {
        const topicGen = await generateContentWithFailover({
          prompt: `Kamu adalah trend spesialis YouTube. Berikan 1 ide topik video viral yang sangat menarik untuk kategori: ${primaryCat}. Balas hanya dengan nama topiknya saja dalam 1 kalimat pendek.`,
          temperature: 0.7,
          numPredict: 128,
        }, modelToUse, baseUrlToUse);
        finalDesc = getString(topicGen.text) || `Fakta menarik tentang ${primaryCat}`;
        console.log(`[Auto-Topic] Generated: ${finalDesc}`);
      } catch (err) {
        console.error('[Auto-Topic] Failed:', err);
        finalDesc = `Konten menarik tentang ${primaryCat}`;
      }
    }

    if (isSeries) {
      // 2. Series Mode Logic
      try {
        const seriesDefaults = buildSeriesCharacterDefaults(finalDesc, styles, mood, camera);
        const response = await generateContentWithFailover({
          prompt: `Kamu adalah showrunner YouTube Indonesia untuk serial video panjang.
Pecah topik menjadi serial maksimal 15 part (utamakan jumlah part seefisien mungkin namun tetap runtut).
Tujuan utama: setiap part harus terasa sebagai episode dari dunia, karakter, dan identitas visual yang sama.

Topik utama: ${finalDesc}
Style visual: ${styles.join(', ') || 'cinematic documentary'}
Mood: ${mood || 'informatif dan dramatis'}
Camera preference: ${camera || 'mixed cinematic coverage'}
Aspect ratio target: ${aspectPreset.ratio} (${aspectPreset.outputWidth}x${aspectPreset.outputHeight}, ${aspectPreset.label})
Target durasi per episode: ${durationProfile.label} (${durationProfile.targetDurationSeconds} detik)
Target narasi per episode: sekitar ${durationProfile.targetWords}-${durationProfile.maxWords} kata
Target storyboard per episode: tepat ${durationProfile.sceneCount} scene, tiap scene sekitar ${durationProfile.clipDuration} detik
Character default name: ${seriesDefaults.character_name}
Character default anchor: ${seriesDefaults.character_anchor}
Character negative prompt: ${seriesDefaults.character_negative_prompt}

Aturan WAJIB untuk setiap part:
1) Judul harus ada format [Part X] dan mengandung hook kuat.
2) Narasi harus detail, storytelling jelas, sekitar ${durationProfile.targetWords}-${durationProfile.maxWords} kata per part.
3) Narasi part 1 harus punya hook 20-30 detik pertama yang kuat.
4) Part selain terakhir WAJIB ditutup dengan kalimat persis: "Bersambung ke part selanjutnya".
5) Part terakhir WAJIB ditutup dengan kata persis: "Tamat".
6) video_prompts harus dalam bahasa Inggris, detail sinematik, karakter konsisten, tanpa text/logo/watermark.
6b) Komposisi shot wajib disesuaikan untuk rasio ${aspectPreset.ratio} agar framing tidak terpotong.
7) Buat tepat ${durationProfile.sceneCount} item storyboard per part. Tiap storyboard wajib punya narasi scene dan visual_prompt.
7b) video_prompts wajib berisi visual_prompt dari setiap storyboard, urut persis sama.
8) Deskripsi YouTube per part 120-220 kata + hashtag relevan.
9) Setiap part harus menjadi kelanjutan langsung dari part sebelumnya, bukan topik baru yang lepas.
10) Pertahankan protagonis utama, konflik, tone, dan worldbuilding yang sama dari part ke part.
11) Awal part 2 dan seterusnya harus terasa menyambung dari cliffhanger atau perkembangan part sebelumnya.
12) Progres cerita harus maju terus sampai penutup akhir, bukan mengulang premis yang sama.
13) Setiap part WAJIB mengulang field karakter dan visual berikut agar generator video konsisten:
   - character_name
   - character_anchor
   - character_negative_prompt
   - visual_style
   - camera_style
   - mood
   - continuity_notes
14) character_anchor harus sangat detail: usia, bentuk wajah, gaya rambut, skin tone, wardrobe, aura, dan gaya visual.
15) continuity_notes harus menjelaskan kaitan episode ini dengan episode sebelumnya dan apa yang harus tetap konsisten secara visual.
16) Jangan pernah mengubah identitas karakter utama antar part.

Balas HANYA JSON array valid, tanpa teks lain:
[
  {
    "part": 1,
    "judul": "[Part 1] ...",
    "narasi": "...",
    "character_name": "${seriesDefaults.character_name}",
    "character_anchor": "${seriesDefaults.character_anchor}",
    "character_negative_prompt": "${seriesDefaults.character_negative_prompt}",
    "visual_style": "${seriesDefaults.visual_style}",
    "camera_style": "${seriesDefaults.camera_style}",
    "mood": "${seriesDefaults.mood}",
    "continuity_notes": "catatan kontinuitas karakter, worldbuilding, wardrobe, dan progression cerita",
    "storyboard": [
      {
        "scene": 1,
        "chapter": "Hook",
        "title": "nama beat adegan",
        "duration_seconds": ${durationProfile.clipDuration},
        "narration": "narasi khusus scene ini dalam bahasa Indonesia",
        "visual_prompt": "English cinematic visual prompt for this exact narration beat, no text/logo/watermark"
      }
    ],
    "video_prompts": ["...", "..."],
    "deskripsi": "..."
  }
]`,
          temperature: 0.8,
          numPredict: Math.max(defaultGenerateNumPredict, durationProfile.targetDurationSeconds >= 600 ? 16384 : 8192),
          format: 'json',
        }, modelToUse, baseUrlToUse);

        const parsedSeries = parseJsonResponse(response.text, 'Respons serial tidak valid.');
        const parts = normalizeSeriesPartsResponse(parsedSeries);
        if (!Array.isArray(parts)) {
          throw new Error('Format serial harus berupa JSON array.');
        }
        const normalizedParts = parts.map((part, index) => ({
          ...part,
          part: Number(part?.part) || index + 1,
          character_name: getString(part?.character_name) || seriesDefaults.character_name,
          character_anchor: getString(part?.character_anchor) || seriesDefaults.character_anchor,
          character_negative_prompt: getString(part?.character_negative_prompt) || seriesDefaults.character_negative_prompt,
          visual_style: getString(part?.visual_style) || seriesDefaults.visual_style,
          camera_style: getString(part?.camera_style) || seriesDefaults.camera_style,
          mood: getString(part?.mood) || seriesDefaults.mood,
          continuity_notes: getString(part?.continuity_notes),
        })).map((part) => {
          const storyboard = normalizeStoryboardScenes(part.storyboard || part.scenes, part.video_prompts);
          const fallbackStoryboard = storyboard.length > 0
            ? storyboard
            : createFallbackStoryboard({
                topic: `${finalDesc} ${part.judul || ''}`,
                category: getString(cats[0]) || 'Serial',
                styles,
                mood: part.mood,
                camera: part.camera_style,
                aspectRatio: aspectPreset.ratio,
                profile: durationProfile,
                characterAnchor: part.character_anchor,
                narrativeMode: 'series',
              });
          return {
            ...part,
            storyboard: fallbackStoryboard,
            video_prompts: fallbackStoryboard.map((scene) => scene.visual_prompt),
            target_duration_seconds: durationProfile.targetDurationSeconds,
            target_words: durationProfile.targetWords,
          };
        });
        console.log(`[Generate] Series success in ${Date.now() - startedAt}ms with ${normalizedParts.length} parts.`);
        return res.json({ isSeries: true, parts: normalizedParts, topic: finalDesc, durationProfile });
      } catch (error) {
        console.error('Series generate failed:', error);
        return sendError(
          res,
          500,
          'Gagal membuat serial video.',
          error instanceof Error ? error.message : String(error),
        );
      }
    }

    // 3. Normal Mode (Original logic improved)
    const slots = getArray(req.body?.slots);
    const scheduleText = slots.length
      ? slots
          .map((slot, index) => {
            const time = getString(slot?.time) || '--:--';
            const label = getString(slot?.label) || `Slot ${index + 1}`;
            return `${time} (${label})`;
          })
          .join('\n')
      : 'Belum ada slot terjadwal';

    const primaryCategory = getString(cats[0]) || 'Konten utama';

    try {
      const response = await generateContentWithFailover({
        prompt: `Kamu adalah creative director YouTube Indonesia untuk video long-form berkualitas tinggi.
Tugasmu: membuat paket produksi konten yang sangat detail dan siap dipakai generator video AI.

Jadwal upload:
${scheduleText}

Input user:
Topik: ${finalDesc}
Kategori utama: ${primaryCategory}
Style: ${styles.length ? styles.join(', ') : 'cinematic documentary'}
Mood: ${mood || 'informatif dan emosional'}
Camera preference: ${camera || 'mixed cinematic coverage'}
Target aspect ratio: ${aspectPreset.ratio} (${aspectPreset.outputWidth}x${aspectPreset.outputHeight}, ${aspectPreset.label})
Target durasi video: ${durationProfile.label} (${durationProfile.targetDurationSeconds} detik)
Target narasi: sekitar ${durationProfile.targetWords}-${durationProfile.maxWords} kata
Target storyboard: tepat ${durationProfile.sceneCount} scene, tiap scene sekitar ${durationProfile.clipDuration} detik

Aturan WAJIB:
- Bahasa Indonesia untuk narasi, judul, deskripsi, hashtag.
- VIDEO PROMPTS wajib bahasa Inggris.
- Narasi harus sekitar ${durationProfile.targetWords}-${durationProfile.maxWords} kata, dengan ritme storytelling yang jelas.
- Narasi harus punya: hook awal kuat, setup dunia/lokasi, konflik/inti bahasan, escalating reveal, payoff, closing CTA.
- Buat tepat ${durationProfile.sceneCount} item storyboard yang mengikuti urutan narasi.
- Tiap storyboard wajib punya: scene, chapter, title, duration_seconds, narration, visual_prompt.
- video_prompts wajib berisi visual_prompt dari storyboard, urut persis sama.
- Tiap visual_prompt minimal 40 kata dan wajib memuat:
  a) subject/action
  b) environment/time
  c) camera movement/lens/composition
  d) lighting/color mood
  e) visual style cue sesuai style user
  f) mood cue sesuai mood user
  g) negative hints: no text, no logo, no watermark
- Judul YouTube harus hook kuat (curiosity gap), bukan clickbait bohong.
- Deskripsi YouTube 160-260 kata + 8-15 hashtag relevan.
- Output harus kaya detail, tidak boleh generik/singkat.
- Semua prompt visual harus mengunci framing sesuai rasio ${aspectPreset.ratio}.
- Setiap video prompt wajib menyebut style user: ${styles.length ? styles.join(', ') : 'cinematic documentary'}.
- Setiap video prompt wajib menyebut camera preference: ${camera || 'mixed cinematic coverage'}.
- Setiap video prompt wajib menyebut mood: ${mood || 'informatif dan emosional'}.
- Jangan tulis text overlay, caption, subtitle, logo, watermark, UI, tipografi, atau meta instruction di prompt visual.
- Jangan tulis catatan di luar format output.

Format output PERSIS:
{
  "narasi": "isi narasi lengkap",
  "storyboard": [
    {
      "scene": 1,
      "chapter": "Hook",
      "title": "nama beat adegan",
      "duration_seconds": ${durationProfile.clipDuration},
      "narration": "narasi khusus scene ini dalam bahasa Indonesia",
      "visual_prompt": "English cinematic visual prompt for this exact narration beat, no text/logo/watermark"
    }
  ],
  "video_prompts": ["prompt 1", "prompt 2"],
  "judul": "judul youtube",
  "deskripsi": "deskripsi youtube",
  "hashtags": ["#tag1", "#tag2"]
}`,
        temperature: 0.62,
        numPredict: Math.max(defaultGenerateNumPredict, durationProfile.targetDurationSeconds >= 600 ? 16384 : 8192),
        timeoutMs: Math.min(defaultOllamaTimeoutMs, durationProfile.targetDurationSeconds >= 600 ? 180000 : 90000),
        format: 'json',
      }, modelToUse, baseUrlToUse);

      const parsed = parseGeneratePayload(response.text, finalDesc || 'Video Menarik');
      const storyboard = normalizeStoryboardScenes(parsed.storyboard || parsed.scenes, parsed.video_prompts);
      const fallbackStoryboard = storyboard.length > 0
        ? storyboard
        : createFallbackStoryboard({
            topic: finalDesc || parsed.judul || 'Video Menarik',
            styles,
            mood,
            camera,
            category: primaryCategory,
            aspectRatio: aspectPreset.ratio,
            profile: durationProfile,
          });
      const normalizedParsed = {
        ...parsed,
        narasi: getString(parsed.narasi) || fallbackStoryboard.map((scene) => scene.narration).join('\n\n'),
        storyboard: fallbackStoryboard,
        video_prompts: fallbackStoryboard.map((scene) => scene.visual_prompt),
        target_duration_seconds: durationProfile.targetDurationSeconds,
        target_words: durationProfile.targetWords,
        hashtags: Array.isArray(parsed.hashtags) && parsed.hashtags.length > 0
          ? parsed.hashtags
          : createFallbackHashtags({
              topic: finalDesc || parsed.judul || 'Video Menarik',
              category: primaryCategory,
            }),
      };
      normalizedParsed.deskripsi = getString(parsed.deskripsi) || createFallbackDescription({
        title: parsed.judul || finalDesc,
        topic: finalDesc,
        hashtags: normalizedParsed.hashtags,
      });

      const text = JSON.stringify(normalizedParsed, null, 2);
      if (!getString(text)) {
        throw new Error('Respons Ollama kosong.');
      }

      console.log(`[Generate] Normal success in ${Date.now() - startedAt}ms with response length ${text.length}.`);
      return res.json({ text });
    } catch (error) {
      console.error('Generate failed:', error);
      const fallbackPayload = buildImmediateGenerateFallback({
        topic: finalDesc || 'Video Menarik',
        category: primaryCategory,
        styles,
        mood,
        camera,
        aspectRatio: aspectPreset.ratio,
        profile: durationProfile,
      });
      console.warn('[Generate] Mengembalikan fallback prompt karena generate utama gagal/timeout.');
      return res.json({
        text: fallbackPayload,
        topic: finalDesc,
        warning: error instanceof Error ? error.message : String(error),
      });
    }
  });

  router.post('/trends', async (req, res) => {
    const { ollamaBaseUrl, ollamaModel, geminiModel } = req.body || {};
    const modelToUse = getString(ollamaModel) || getString(geminiModel) || defaultModel;
    const baseUrlToUse = getString(ollamaBaseUrl) || defaultOllamaBaseUrl;

    try {
      const response = await generateContentWithFailover({
        prompt: `Kamu adalah social media trend analyst untuk pasar Indonesia.
Buat rekomendasi tren konten yang realistis dan relevan berdasarkan pola umum audiens Indonesia.
Fokus pada kombinasi topik dari Google Search & YouTube yang biasanya naik untuk short-form.

Balas hanya dalam JSON valid dengan struktur:
{
  "trends": [
    {
      "rank": 1,
      "topik": "nama topik",
      "source": "google/youtube",
      "platform": "youtube/tiktok/instagram/semua",
      "kategori": "kategori",
      "alasan": "kenapa sedang naik",
      "potensi_viral": 95,
      "emoji": "fire",
      "url": "optional link info"
    }
  ],
  "ide_video": [
    {
      "judul": "judul video",
      "kategori": "kategori",
      "hook": "hook pembuka",
      "estimasi_views": "10K-50K"
    }
  ],
  "ringkasan": "ringkasan satu paragraf"
}
Pastikan output mentah berupa JSON object valid tanpa teks tambahan.`,
        temperature: 0.7,
        numPredict: 1800,
        format: 'json',
      }, modelToUse, baseUrlToUse);

      return res.json(parseJsonResponse(response.text, 'Respons trends tidak valid.'));
    } catch (error) {
      console.error('Trends failed:', error);
      return sendError(
        res,
        500,
        'Gagal mengambil trends terbaru.',
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  router.post('/clipper', async (req, res) => {
    const { url, duration, targetPlatform, ollamaBaseUrl, ollamaModel, geminiModel } = req.body || {};
    if (!url) return sendError(res, 400, 'URL video wajib diisi.');

    const modelToUse = getString(ollamaModel) || getString(geminiModel) || defaultModel;
    const baseUrlToUse = getString(ollamaBaseUrl) || defaultOllamaBaseUrl;
    const dur = duration || '30';
    const platform = targetPlatform || 'tiktok';

    try {
      const metadata = await getYouTubeMetadata(url);

      const response = await generateContentWithFailover({
        prompt: `Kamu adalah editor short-form video dan viral strategist.
Analisis video sumber berikut untuk dijadikan klip ${dur} detik di ${platform}.

URL video:
${url}

Metadata yang berhasil diambil:
Judul: ${metadata?.title || 'Tidak tersedia'}
Channel: ${metadata?.author || 'Tidak tersedia'}

Balas hanya dalam JSON valid:
{
  "skor_total": 85,
  "momen": [
    {
      "timestamp": "00:45 - 01:15",
      "judul": "momen utama",
      "hook": "hook narasi pendek yang viral",
      "thumbnail_prompt": "deskripsi gambar untuk thumbnail",
      "pilihan_judul": ["Judul 1", "Judul 2"],
      "alasan": "mengapa momen ini kuat untuk short-form",
      "skor": 90,
      "copyright_status": "safe"
    }
  ],
  "teknik": ["teknik editing 1"],
  "caption": ["caption 1"]
}

Jika metadata terbatas, jujurkan asumsi singkat di alasan dan tetap berikan rekomendasi yang berguna.
Pastikan output mentah berupa JSON object valid tanpa teks tambahan.`,
        temperature: 0.6,
        numPredict: 2200,
        format: 'json',
      }, modelToUse, baseUrlToUse);

      return res.json(parseJsonResponse(response.text, 'Respons clipper tidak valid.'));
    } catch (error) {
      console.error('Clipper failed:', error);
      return sendError(
        res,
        500,
        'Gagal menganalisis video untuk clipping.',
        error instanceof Error ? error.message : String(error),
      );
    }
  });

  return router;
}

async function startServer() {
  if (usePostgresQueue()) {
    await ensurePostgresQueueSchema();
    console.log('[Queue] PostgreSQL queue backend aktif.');
  } else {
    console.log('[Queue] Firestore queue backend aktif.');
  }

  if (useLocalAuth()) {
    const adminUser = await ensureLocalAdminUser();
    console.log(`[Auth] Local auth PostgreSQL aktif${adminUser ? ` untuk user ${adminUser.username}` : ''}.`);
  }

  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '10mb' }));
  app.get('/health', (_req, res) => {
    res.json({
      status: 'ok',
      version: '1.2.0',
      timestamp: new Date().toISOString(),
      model: process.env.OLLAMA_MODEL || 'qwen2.5:7b-instruct',
      ollamaBaseUrl: getOllamaBaseUrl(),
      ollamaTimeoutMs: defaultOllamaTimeoutMs,
      queueBackend: usePostgresQueue() ? 'postgres' : 'firestore',
      authBackend: useLocalAuth() ? 'postgres' : 'firebase',
    });
  });
  const publicOutputDir = getString(process.env.VIDGEN_PUBLIC_OUTPUT_DIR) || '/var/www/vidgen-tmp';
  app.use('/vidgen-tmp', express.static(publicOutputDir));
  app.use('/api', createApiRouter());

  if (isDevServer) {
    const vite = await createViteServer({
      root: rootDir,
      appType: 'spa',
      server: {
        middlewareMode: true,
      },
    });

    app.use(vite.middlewares);
  } else if (fs.existsSync(distIndexHtml)) {
    app.use(express.static(distDir));
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }

      return res.sendFile(distIndexHtml);
    });
  } else {
    const vite = await createViteServer({
      root: rootDir,
      appType: 'spa',
      server: {
        middlewareMode: true,
      },
    });

    app.use(vite.middlewares);
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`VidGen server listening on http://localhost:${port}`);
  });

  // Poll queued jobs and dispatch them to n8n when dispatchAt time is reached.
  setInterval(() => {
    dispatchDueQueuedJobs().catch((error) => {
      console.error('[Dispatch Scheduler] Unhandled error:', error);
    });
  }, dispatchPollIntervalMs);

  setInterval(() => {
    cleanupExpiredData().catch((error) => {
      console.error('[Cleanup Scheduler] Unhandled error:', error);
    });
  }, cleanupPollIntervalMs);

  // Kick off one cycle on startup.
  dispatchDueQueuedJobs().catch((error) => {
    console.error('[Dispatch Scheduler] Initial run error:', error);
  });
  cleanupExpiredData().catch((error) => {
    console.error('[Cleanup Scheduler] Initial run error:', error);
  });
}

startServer().catch((error) => {
  console.error('Unable to start server:', error);
  process.exit(1);
});

import express from 'express';
import dotenv from 'dotenv';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { randomBytes, randomUUID, scryptSync, timingSafeEqual, createHash } from 'node:crypto';
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
  const totalPrompts = Math.max(6, Math.min(Number(count) || 8, 12));
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
}) {
  const judul = getString(topic) || 'Video Menarik';
  const hashtags = createFallbackHashtags({ topic, category });
  return {
    narasi: createFallbackNarration({ topic, category, mood }),
    video_prompts: createFallbackVideoPrompts({
      topic,
      category,
      styles,
      mood,
      camera,
      aspectRatio,
      count: defaultGenerateVideoPromptCount,
    }),
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

function getIntegrationSettings(jobData) {
  const integration = jobData?.integration && typeof jobData.integration === 'object' ? jobData.integration : {};
  return {
    webhookUrl: getString(integration.webhookUrl) || getString(process.env.N8N_WEBHOOK_URL),
    webhookSecret: getString(integration.webhookSecret) || getString(process.env.N8N_WEBHOOK_SECRET),
    callbackUrl: getString(integration.callbackUrl),
    callbackSecret: getString(process.env.VIDGEN_CALLBACK_SECRET),
    appBaseUrl: getString(integration.appBaseUrl) || getString(process.env.APP_BASE_URL),
    hfToken: getString(integration.hfToken) || getString(process.env.HUGGINGFACE_TOKEN),
    comfyApiUrl: getString(integration.comfyApiUrl) || getString(process.env.COMFYUI_API_URL),
    comfyApiKey: getString(integration.comfyApiKey) || getString(process.env.COMFYUI_API_KEY),
    comfyWorkflowFile: getString(integration.comfyWorkflowFile) || getString(process.env.COMFYUI_WORKFLOW_FILE),
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
  now = new Date(),
}) {
  if (usePostgresQueue()) {
    const source = getString(originalJobData?.source) || 'manual';
    const normalizedScheduledInput = normalizeScheduledTimeInput(scheduledTimeInput, source, now);
    const dispatchPlan = buildDispatchPlan(normalizedScheduledInput, defaultRenderLeadMinutes, now);
    const integrationSettings = getIntegrationSettings(originalJobData);
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
  const integrationSettings = getIntegrationSettings(originalJobData);
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
      firestoreDatabaseId: getString(process.env.FIRESTORE_DATABASE_ID) || '(default)',
      firebaseAdminConfigured:
        Boolean(getString(process.env.FIREBASE_SERVICE_ACCOUNT_JSON)) ||
        (Boolean(getString(process.env.FIREBASE_PROJECT_ID)) &&
          Boolean(getString(process.env.FIREBASE_CLIENT_EMAIL)) &&
          Boolean(getString(process.env.FIREBASE_PRIVATE_KEY))),
    });
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
        settings,
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
        settings: usePostgresQueue() ? await getAppSettings(user.uid) : {},
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
        return res.json({ ok: true, settings: req.body || {} });
      }
      const settings = await setAppSettings(user.uid, req.body && typeof req.body === 'object' ? req.body : {});
      return res.json({ ok: true, settings });
    } catch (error) {
      return sendError(res, 500, 'Gagal menyimpan settings.', error instanceof Error ? error.message : String(error));
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
    console.log('[Generate] Incoming request', {
      isSeries: Boolean(isSeries),
      descLength: finalDesc.length,
      stylesCount: styles.length,
      catsCount: cats.length,
      slotsCount: Array.isArray(req.body?.slots) ? req.body.slots.length : 0,
      modelToUse,
      baseUrlToUse,
      aspectRatio: aspectPreset.ratio,
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
Character default name: ${seriesDefaults.character_name}
Character default anchor: ${seriesDefaults.character_anchor}
Character negative prompt: ${seriesDefaults.character_negative_prompt}

Aturan WAJIB untuk setiap part:
1) Judul harus ada format [Part X] dan mengandung hook kuat.
2) Narasi harus detail, storytelling jelas, minimal 700 kata per part.
3) Narasi part 1 harus punya hook 20-30 detik pertama yang kuat.
4) Part selain terakhir WAJIB ditutup dengan kalimat persis: "Bersambung ke part selanjutnya".
5) Part terakhir WAJIB ditutup dengan kata persis: "Tamat".
6) video_prompts harus dalam bahasa Inggris, detail sinematik, karakter konsisten, tanpa text/logo/watermark.
6b) Komposisi shot wajib disesuaikan untuk rasio ${aspectPreset.ratio} agar framing tidak terpotong.
7) Buat 8-12 video_prompts per part. Tiap prompt minimal 35 kata.
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
    "video_prompts": ["...", "..."],
    "deskripsi": "..."
  }
]`,
          temperature: 0.8,
          numPredict: Math.max(defaultGenerateNumPredict, 8192),
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
        }));
        console.log(`[Generate] Series success in ${Date.now() - startedAt}ms with ${normalizedParts.length} parts.`);
        return res.json({ isSeries: true, parts: normalizedParts, topic: finalDesc });
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

Aturan WAJIB:
- Bahasa Indonesia untuk narasi, judul, deskripsi, hashtag.
- VIDEO PROMPTS wajib bahasa Inggris.
- Narasi minimal 900 kata, maksimal ${defaultGenerateMaxWords} kata.
- Narasi harus punya: hook awal kuat, konflik/inti bahasan, payoff, closing CTA.
- Buat tepat ${defaultGenerateVideoPromptCount} video prompts.
- Tiap video prompt minimal 40 kata dan wajib memuat:
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
  "video_prompts": ["prompt 1", "prompt 2"],
  "judul": "judul youtube",
  "deskripsi": "deskripsi youtube",
  "hashtags": ["#tag1", "#tag2"]
}`,
        temperature: 0.62,
        numPredict: defaultGenerateNumPredict,
        timeoutMs: Math.min(defaultOllamaTimeoutMs, 45000),
        format: 'json',
      }, modelToUse, baseUrlToUse);

      const parsed = parseGeneratePayload(response.text, finalDesc || 'Video Menarik');
      const normalizedParsed = {
        ...parsed,
        video_prompts: Array.isArray(parsed.video_prompts) && parsed.video_prompts.length > 0
          ? parsed.video_prompts
          : createFallbackVideoPrompts({
              topic: finalDesc || parsed.judul || 'Video Menarik',
              styles,
              mood,
              camera,
              category: primaryCategory,
              aspectRatio: aspectPreset.ratio,
            }),
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
  app.use(express.json({ limit: '1mb' }));
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

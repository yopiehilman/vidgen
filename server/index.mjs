import express from 'express';
import dotenv from 'dotenv';
import fs from 'node:fs';
import http from 'node:http';
import https from 'node:https';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { cert, getApps, initializeApp as initializeAdminApp } from 'firebase-admin/app';
import { getAuth as getAdminAuth } from 'firebase-admin/auth';
import { FieldValue, getFirestore as getAdminFirestore } from 'firebase-admin/firestore';
import { createServer as createViteServer } from 'vite';

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

  try {
    return await getAdminAuth(getAdminApp()).verifyIdToken(token);
  } catch (error) {
    const authError = new Error('Token autentikasi tidak valid.');
    authError.statusCode = 401;
    authError.cause = error;
    throw authError;
  }
}

function sanitizeObject(input) {
  return Object.fromEntries(
    Object.entries(input).filter(([, value]) => value !== undefined),
  );
}

async function updateProductionJobStatus(jobId, payload) {
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
  const db = getAdminDb();
  const source = getString(originalJobData?.source) || 'manual';
  const normalizedScheduledInput = normalizeScheduledTimeInput(scheduledTimeInput, source, now);
  const dispatchPlan = buildDispatchPlan(normalizedScheduledInput, defaultRenderLeadMinutes, now);
  const integrationSettings = getIntegrationSettings(originalJobData);
  const shouldDispatchViaWebhook = Boolean(integrationSettings.webhookUrl);
  const normalizedScheduledTime = dispatchPlan.normalizedScheduledTime || normalizedScheduledInput || getString(originalJobData?.scheduledTime);
  const retryCount = Number(originalJobData?.metadata?.retryCount || 0) + 1;
  const forceImmediateUpload = isWaitingForUpload(originalJobData);
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
        ? ((dispatchPlan.isScheduled && !forceImmediateUpload) ? 'scheduled-webhook' : 'webhook')
        : 'disabled',
      dispatchStatus: shouldDispatchViaWebhook ? 'pending' : 'disabled',
      dispatchAt: shouldDispatchViaWebhook ? safeIso(dispatchPlan.dispatchAt) : null,
      targetUploadAt: shouldDispatchViaWebhook && !forceImmediateUpload ? safeIso(dispatchPlan.scheduledUploadAt) : null,
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

async function claimDueJobForDispatch(docRef) {
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

async function processDispatchForDoc(docRef) {
  const claimed = await claimDueJobForDispatch(docRef);
  if (!claimed.claimed || !claimed.data) {
    return false;
  }

  const jobData = claimed.data;
  const integration = jobData.integration && typeof jobData.integration === 'object' ? jobData.integration : {};
  const attempts = Number(integration.dispatchAttempts || 1);

  try {
    await dispatchJobToN8n(docRef.id, jobData);
    await docRef.set(
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
    return true;
  } catch (error) {
    const retryAt = new Date(Date.now() + dispatchRetryMinutes * 60 * 1000);
    await docRef.set(
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
    console.error(`[Dispatch] Gagal job ${docRef.id}:`, error);
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

function createApiRouter() {
  const router = express.Router();

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      model: defaultModel,
    });
  });

  router.get('/integrations/n8n/health', (_req, res) => {
    res.json({
      ok: true,
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

    const jobsRaw = Array.isArray(req.body?.jobs) ? req.body.jobs : [req.body];
    const results = [];
    const db = getAdminDb();

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

      const jobRef = db.collection('video_queue').doc();
      const callbackUrl = `${getOrigin(req)}/api/integrations/n8n/callback`;
      const now = new Date();
      const dispatchPlan = buildDispatchPlan(normalizedScheduledInput, defaultRenderLeadMinutes, now);
      const shouldDispatchViaWebhook = Boolean(webhookUrl);
      const normalizedScheduledTime = forceImmediateUpload
        ? formatLocalSchedule(now)
        : (dispatchPlan.normalizedScheduledTime || normalizedScheduledInput || scheduledTime);

      const baseJob = {
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

      await jobRef.set(baseJob);

      if (shouldDispatchViaWebhook) {
        // Immediate attempt for due jobs; scheduled jobs will be handled by polling loop.
        (async () => {
          try {
            await processDispatchForDoc(jobRef);
          } catch (err) {
            console.error('[Dispatch] Immediate attempt gagal:', err);
          }
        })();
      }

      results.push({ jobId: jobRef.id, title, status: baseJob.status });
    }

    return res.status(202).json({
      ok: true,
      count: results.length,
      jobs: results,
      message: `Berhasil menambahkan ${results.length} job ke antrean.`
    });
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
      const originalRef = getAdminDb().collection('video_queue').doc(originalJobId);
      const snapshot = await originalRef.get();

      if (!snapshot.exists) {
        return sendError(res, 404, 'Job asal tidak ditemukan.');
      }

      const originalJobData = snapshot.data() || {};
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
      const snapshot = await getAdminDb().collection('video_queue').doc(jobId).get();
      if (!snapshot.exists) {
        return sendError(res, 404, 'Job tidak ditemukan.');
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
        const response = await generateContentWithFailover({
          prompt: `Kamu adalah showrunner YouTube Indonesia untuk serial video panjang.
Pecah topik menjadi serial maksimal 15 part (utamakan jumlah part seefisien mungkin namun tetap runtut).

Topik utama: ${finalDesc}
Style visual: ${styles.join(', ') || 'cinematic documentary'}
Mood: ${mood || 'informatif dan dramatis'}
Aspect ratio target: ${aspectPreset.ratio} (${aspectPreset.outputWidth}x${aspectPreset.outputHeight}, ${aspectPreset.label})

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

Balas HANYA JSON array valid, tanpa teks lain:
[
  {
    "part": 1,
    "judul": "[Part 1] ...",
    "narasi": "...",
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
        console.log(`[Generate] Series success in ${Date.now() - startedAt}ms with ${parts.length} parts.`);
        return res.json({ isSeries: true, parts, topic: finalDesc });
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
Tugasmu: membuat paket produksi konten yang sangat detail dan siap dipakai generator video.

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
  e) continuity character cue
  f) negative hints: no text, no logo, no watermark
- Judul YouTube harus hook kuat (curiosity gap), bukan clickbait bohong.
- Deskripsi YouTube 160-260 kata + 8-15 hashtag relevan.
- Output harus kaya detail, tidak boleh generik/singkat.
- Semua prompt visual harus mengunci framing sesuai rasio ${aspectPreset.ratio}.
- Jangan tulis catatan di luar format output.

Format output PERSIS:
1. NARASI HOOK
2. VIDEO PROMPTS
3. JUDUL YOUTUBE
4. DESKRIPSI YOUTUBE
5. HASHTAG`,
        temperature: 0.62,
        numPredict: defaultGenerateNumPredict,
      }, modelToUse, baseUrlToUse);

      const text = getString(response.text);
      if (!text) {
        throw new Error('Respons Ollama kosong.');
      }

      console.log(`[Generate] Normal success in ${Date.now() - startedAt}ms with response length ${text.length}.`);
      return res.json({ text });
    } catch (error) {
      console.error('Generate failed:', error);
      return sendError(
        res,
        500,
        'Gagal menghasilkan prompt video.',
        error instanceof Error ? error.message : String(error),
      );
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
  const app = express();
  app.disable('x-powered-by');
  app.set('trust proxy', true);
  app.use(express.json({ limit: '1mb' }));
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

  // Kick off one cycle on startup.
  dispatchDueQueuedJobs().catch((error) => {
    console.error('[Dispatch Scheduler] Initial run error:', error);
  });
}

startServer().catch((error) => {
  console.error('Unable to start server:', error);
  process.exit(1);
});

import express from 'express';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
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
const defaultModel = process.env.GEMINI_MODEL || 'gemini-1.5-flash';

function sendError(res, status, error, details) {
  res.status(status).json({
    error,
    ...(details ? { details } : {}),
  });
}

function getAiClient() {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new Error('GEMINI_API_KEY belum di-set di environment server.');
  }

  return new GoogleGenAI({ apiKey });
}

async function generateContentWithFailover(ai, params, customModel) {
  const models = [
    customModel,
    process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    'gemini-1.5-pro',
    'gemini-1.0-pro'
  ];
  
  // Remove duplicates and respect the primary choice
  const uniqueModels = [...new Set(models)].filter(Boolean);
  
  let lastError;
  for (const modelName of uniqueModels) {
    try {
      console.log(`[AI] Attempting generateContent with model: ${modelName}`);
      const response = await ai.models.generateContent({
        model: modelName,
        contents: params.contents,
        config: {
          ...(params.config || {}),
          ...(params.tools ? { tools: params.tools } : {}),
        }
      });
      return response;
    } catch (err) {
      lastError = err;
      const errMsg = err?.message || String(err);
      
      // If it's a quota error (429) or certain server errors, try next model
      if (errMsg.includes('429') || errMsg.includes('QUOTA') || errMsg.includes('exhausted') || errMsg.includes('500')) {
        console.warn(`[AI Failover] Model ${modelName} failed, trying next... Error: ${errMsg.slice(0, 100)}`);
        continue;
      }
      
      // For other errors (like invalid prompt), throw immediately
      throw err;
    }
  }
  
  throw lastError;
}

function getString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getArray(value) {
  return Array.isArray(value) ? value : [];
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
  return getAdminFirestore(getAdminApp());
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
      integration: sanitizeObject({
        provider: 'n8n',
        callbackReceivedAt: new Date().toISOString(),
        lastStatusCode: payload.status,
      }),
      statusHistory: FieldValue.arrayUnion(
        sanitizeObject({
          status: payload.status,
          at: new Date().toISOString(),
          message: payload.message,
        }),
      ),
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
    const callbackSecret = getString(process.env.VIDGEN_CALLBACK_SECRET);

    for (const jobData of jobsRaw) {
      const title = getString(jobData?.title) || 'Video tanpa judul';
      const description = getString(jobData?.description);
      const prompt = getString(jobData?.prompt);
      const source = getString(jobData?.source) || 'manual';
      const category = getString(jobData?.category);
      const scheduledTime = getString(jobData?.scheduledTime);
      const metadata = jobData?.metadata && typeof jobData.metadata === 'object' ? jobData.metadata : {};
      const integration = jobData?.integration && typeof jobData.integration === 'object' ? jobData.integration : {};
      
      const webhookUrl = getString(integration.webhookUrl) || getString(process.env.N8N_WEBHOOK_URL);
      const webhookSecret = getString(integration.secret) || getString(process.env.N8N_WEBHOOK_SECRET);

      if (!prompt) continue;

      const jobRef = db.collection('video_queue').doc();
      const callbackUrl = `${getOrigin(req)}/api/integrations/n8n/callback`;

      const baseJob = {
        uid: user.uid,
        title,
        description,
        prompt,
        source,
        category,
        scheduledTime,
        status: webhookUrl ? 'queued' : 'pending',
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        metadata,
        integration: sanitizeObject({
          provider: webhookUrl ? 'n8n' : 'internal',
          webhookUrl: webhookUrl || null,
          callbackUrl: webhookUrl ? callbackUrl : null,
          dispatchMode: webhookUrl ? 'webhook' : 'disabled',
        }),
        statusHistory: [
          {
            status: webhookUrl ? 'queued' : 'pending',
            at: new Date().toISOString(),
            message: webhookUrl ? 'Job disimpan dan menunggu dispatch ke n8n.' : 'Job disimpan ke antrean internal.',
          },
        ],
      };

      await jobRef.set(baseJob);

      if (webhookUrl) {
        // Dispatch logic in background to not block the response
        (async () => {
          try {
            const webhookPayload = {
              jobId: jobRef.id,
              uid: user.uid,
              title,
              description,
              prompt,
              source,
              category,
              scheduledTime,
              callbackUrl,
              callbackSecret,
              metadata,
              appBaseUrl: getOrigin(req),
              huggingfaceToken: getString(process.env.HUGGINGFACE_TOKEN)
            };

            await fetch(webhookUrl, {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${webhookSecret}`,
                'x-vidgen-webhook-secret': webhookSecret
              },
              body: JSON.stringify(webhookPayload)
            });
          } catch (err) {
            console.error('[Dispatch] Gagal:', err);
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
      version: '1.1.0',
      timestamp: new Date().toISOString(),
      model: process.env.GEMINI_MODEL || 'gemini-1.5-flash',
    });
  });

  router.post('/generate', async (req, res) => {
    const { desc, selectedStyles, selectedCats, mood, camera, isSeries, geminiApiKey, geminiModel } = req.body;
    const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : getAiClient();
    const modelToUse = geminiModel || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    let finalDesc = getString(desc);
    const styles = getArray(selectedStyles);
    const cats = getArray(selectedCats);

    // 1. Auto-Topic if description is empty
    if (!finalDesc) {
      const primaryCat = getString(cats[0]) || 'Umum';
      try {
        const topicGen = await generateContentWithFailover(ai, {
          contents: `Kamu adalah trend spesialis YouTube. Berikan 1 ide topik video viral yang sangat menarik untuk kategori: ${primaryCat}. Balas hanya dengan nama topiknya saja dalam 1 kalimat pendek.`,
        }, modelToUse);
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
        const response = await generateContentWithFailover(ai, {
          contents: `Pecah cerita/topik berikut menjadi serial video (maksimal 15 part, tapi buat seefisien mungkin).
Setiap part harus memiliki alur yang jelas.
Setiap part (kecuali yang terakhir) WAJIB diakhiri dengan kalimat narasi "Bersambung ke part selanjutnya".
Part terakhir WAJIB diakhiri dengan kata "Tamat".
Setiap judul harus menyertakan "[Part X]".

Topik: ${finalDesc}
Style: ${styles.join(', ')}
Mood: ${mood}

Balas HANYA dengan JSON array:
[
  {
    "part": 1,
    "judul": "...",
    "narasi": "...",
    "video_prompts": ["...", "..."],
    "deskripsi": "..."
  }
]`,
          config: {
            responseMimeType: 'application/json',
          },
        }, modelToUse);

        const parts = JSON.parse(getString(response.text) || '[]');
        return res.json({ isSeries: true, parts, topic: finalDesc });
      } catch (error) {
        console.error('Series generate failed:', error);
        return sendError(res, 500, 'Gagal membuat serial video.', error.message);
      }
    }

    // 3. Normal Mode (Original logic improved)
    const slots = getArray(req.body?.slots);
    const scheduleText = slots.length
      ? slots
          .map((slot, index) => {
            const time = getString(slot?.time) || '--:--';
            const label = getString(slot?.label) || `Slot ${index + 1}`;
            const category = getString(cats[index]) || 'Kategori belum dipilih';
            return `${time} (${label}): ${category}`;
          })
          .join('\n')
      : 'Belum ada slot terjadwal';

    const primaryCategory = getString(cats[0]) || 'Konten utama';

    try {
      const response = await generateContentWithFailover(ai, {
        contents: `Kamu adalah expert content strategist YouTube Indonesia dan video prompt engineer.
Tugasmu adalah membuat paket konten siap produksi untuk video utama hari ini.

Jadwal upload hari ini:
${scheduleText}

Fokus kategori utama:
${primaryCategory}

Format output:
1. NARASI HOOK
2. VIDEO PROMPTS
3. JUDUL YOUTUBE (3 pilihan)
4. DESKRIPSI YOUTUBE
5. HASHTAG
6. CATATAN PRODUKSI SINGKAT

Input user:
Topik: ${finalDesc}
Style: ${styles.length ? styles.join(', ') : 'Auto'}
Mood: ${mood || 'Auto'}
Camera: ${camera || 'Auto'}

Gunakan Bahasa Indonesia untuk semua bagian kecuali video prompts yang harus berbahasa Inggris.
Pastikan hasil langsung usable, spesifik, dan tidak terlalu generik.`,
      }, modelToUse);

      const text = getString(response.text);
      if (!text) {
        throw new Error('Respons Gemini kosong.');
      }

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
    const { geminiApiKey, geminiModel } = req.body;
    const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : getAiClient();
    const modelToUse = geminiModel || process.env.GEMINI_MODEL || 'gemini-1.5-flash';

    try {
      const response = await generateContentWithFailover(ai, {
        contents: `Kamu adalah social media trend analyst untuk pasar Indonesia.
Gunakan grounding pencarian Google untuk merangkum tren yang paling relevan dari DUA SUMBER UTAMA:
1. Google Trends Indonesia (Apa yang sedang dicari orang)
2. YouTube Trending Indonesia (Video apa yang sedang populer)

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
}`,
        config: {
          responseMimeType: 'text/plain',
        },
        tools: [{ googleSearch: {} }],
      }, modelToUse);

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
    const { url, duration, targetPlatform, geminiApiKey, geminiModel } = req.body;
    if (!url) return sendError(res, 400, 'URL video wajib diisi.');

    const ai = geminiApiKey ? new GoogleGenAI({ apiKey: geminiApiKey }) : getAiClient();
    const modelToUse = geminiModel || process.env.GEMINI_MODEL || 'gemini-1.5-flash';
    const dur = duration || '30';
    const platform = targetPlatform || 'tiktok';

    try {
      const metadata = await getYouTubeMetadata(url);

      const response = await generateContentWithFailover(ai, {
        contents: `Kamu adalah editor short-form video dan viral strategist.
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

Jika metadata terbatas, jujurkan asumsi singkat di alasan dan tetap berikan rekomendasi yang berguna.`,
        config: {
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              skor_total: { type: Type.NUMBER },
              momen: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    timestamp: { type: Type.STRING },
                    judul: { type: Type.STRING },
                    hook: { type: Type.STRING },
                    thumbnail_prompt: { type: Type.STRING },
                    pilihan_judul: {
                      type: Type.ARRAY,
                      items: { type: Type.STRING },
                    },
                    alasan: { type: Type.STRING },
                    skor: { type: Type.NUMBER },
                    copyright_status: {
                      type: Type.STRING,
                      enum: ['safe', 'warning', 'danger'],
                    },
                  },
                },
              },
              teknik: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
              caption: {
                type: Type.ARRAY,
                items: { type: Type.STRING },
              },
            },
          },
        },
      }, modelToUse);

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
}

startServer().catch((error) => {
  console.error('Unable to start server:', error);
  process.exit(1);
});

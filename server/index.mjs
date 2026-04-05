import express from 'express';
import dotenv from 'dotenv';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GoogleGenAI, Type } from '@google/genai';
import { createServer as createViteServer } from 'vite';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const distIndexHtml = path.join(distDir, 'index.html');

dotenv.config({ path: path.join(rootDir, '.env.local') });
dotenv.config({ path: path.join(rootDir, '.env') });

const isDevServer = process.argv.includes('--dev');
const port = Number(process.env.PORT || 3000);
const defaultModel = process.env.GEMINI_MODEL || 'gemini-2.5-flash';

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

function getString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function getArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseJsonResponse(rawText, fallbackMessage) {
  try {
    return JSON.parse(rawText);
  } catch (error) {
    console.error('JSON parse error:', error);
    throw new Error(`${fallbackMessage}\n${rawText}`);
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

  router.post('/generate', async (req, res) => {
    const desc = getString(req.body?.desc);
    const selectedStyles = getArray(req.body?.selectedStyles);
    const selectedCats = getArray(req.body?.selectedCats);
    const mood = getString(req.body?.mood);
    const camera = getString(req.body?.camera);
    const slots = getArray(req.body?.slots);

    if (!desc) {
      return sendError(res, 400, 'Deskripsi video wajib diisi.');
    }

    const ai = getAiClient();
    const scheduleText = slots.length
      ? slots
          .map((slot, index) => {
            const time = getString(slot?.time) || '--:--';
            const label = getString(slot?.label) || `Slot ${index + 1}`;
            const category = getString(selectedCats[index]) || 'Kategori belum dipilih';
            return `${time} (${label}): ${category}`;
          })
          .join('\n')
      : 'Belum ada slot terjadwal';

    const primaryCategory = getString(selectedCats[0]) || 'Konten utama';

    try {
      const response = await ai.models.generateContent({
        model: defaultModel,
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
Topik: ${desc}
Style: ${selectedStyles.length ? selectedStyles.join(', ') : 'Auto'}
Mood: ${mood || 'Auto'}
Camera: ${camera || 'Auto'}

Gunakan Bahasa Indonesia untuk semua bagian kecuali video prompts yang harus berbahasa Inggris.
Pastikan hasil langsung usable, spesifik, dan tidak terlalu generik.`,
      });

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
    const platform = getString(req.body?.platform) || 'all';
    const category = getString(req.body?.category) || 'semua';
    const ai = getAiClient();

    try {
      const response = await ai.models.generateContent({
        model: defaultModel,
        contents: `Kamu adalah social media trend analyst untuk pasar Indonesia.
Gunakan grounding pencarian Google untuk merangkum tren yang paling relevan saat ini.

Platform: ${platform}
Kategori: ${category}

Balas hanya dalam JSON valid dengan struktur:
{
  "trends": [
    {
      "rank": 1,
      "topik": "nama topik",
      "platform": "youtube/tiktok/instagram/semua",
      "kategori": "kategori",
      "alasan": "kenapa sedang naik",
      "potensi_viral": 95,
      "emoji": "fire"
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
          tools: [{ googleSearch: {} }],
          responseMimeType: 'application/json',
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              trends: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    rank: { type: Type.NUMBER },
                    topik: { type: Type.STRING },
                    platform: { type: Type.STRING },
                    kategori: { type: Type.STRING },
                    alasan: { type: Type.STRING },
                    potensi_viral: { type: Type.NUMBER },
                    emoji: { type: Type.STRING },
                  },
                },
              },
              ide_video: {
                type: Type.ARRAY,
                items: {
                  type: Type.OBJECT,
                  properties: {
                    judul: { type: Type.STRING },
                    kategori: { type: Type.STRING },
                    hook: { type: Type.STRING },
                    estimasi_views: { type: Type.STRING },
                  },
                },
              },
              ringkasan: { type: Type.STRING },
            },
          },
        },
      });

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
    const url = getString(req.body?.url);
    const duration = getString(req.body?.duration) || '30';
    const targetPlatform = getString(req.body?.targetPlatform) || 'tiktok';

    if (!url) {
      return sendError(res, 400, 'URL video wajib diisi.');
    }

    const ai = getAiClient();
    const metadata = await getYouTubeMetadata(url);

    try {
      const response = await ai.models.generateContent({
        model: defaultModel,
        contents: `Kamu adalah editor short-form video dan viral strategist.
Analisis video sumber berikut untuk dijadikan klip ${duration} detik di ${targetPlatform}.

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
      });

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

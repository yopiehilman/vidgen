# Integrasi VidGen <-> n8n

Flow yang dipakai sekarang:

1. Dashboard VidGen membuat job produksi lewat `POST /api/production-jobs`
2. Server VidGen menyimpan job ke Firestore `video_queue`
3. Server VidGen melempar payload job ke webhook n8n
4. n8n memproses job
5. n8n callback ke `POST /api/integrations/n8n/callback`
6. Status queue di dashboard ikut berubah menjadi `queued`, `processing`, `completed`, atau `failed`

## Endpoint yang dipakai

- Submit job dari app ke server:
  - `POST https://automation.maksitech.id/api/production-jobs`
- Health check integrasi:
  - `GET https://automation.maksitech.id/api/integrations/n8n/health`
- Callback status dari n8n:
  - `POST https://automation.maksitech.id/api/integrations/n8n/callback`

## Environment VidGen server

Isi `.env` atau `.env.local` di server app:

```env
OLLAMA_BASE_URL=http://localhost:11434
OLLAMA_MODEL=qwen2.5:7b-instruct
HUGGINGFACE_TOKEN=hf_xxx
N8N_WEBHOOK_URL=https://n8n.maksitech.id/webhook/vidgen-production
N8N_WEBHOOK_SECRET=isi-secret-yang-sama-dengan-node-webhook-di-n8n
VIDGEN_CALLBACK_SECRET=isi-secret-random-untuk-callback-dari-n8n

FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Atau pakai satu variabel:

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"project_id":"...","client_email":"...","private_key":"-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"}
```

## Setting di dashboard VidGen

Masuk ke menu `Settings` lalu isi:

- `Webhook n8n`: `https://n8n.maksitech.id/webhook/vidgen-production`
- `Base URL n8n`: `https://n8n.maksitech.id`
- `Secret Webhook n8n`: opsional, boleh dikosongkan jika sudah di-set di environment server app

## Payload dari server VidGen ke n8n

Contoh body yang diterima webhook n8n:

```json
{
  "jobId": "abc123",
  "uid": "firebase-user-id",
  "title": "Fakta unik tentang AI",
  "description": "Prompt siap produksi dari halaman generate.",
  "prompt": "Isi prompt produksi lengkap...",
  "source": "generate",
  "category": "Teknologi & AI",
  "scheduledTime": "18:00",
  "metadata": {
    "styles": ["cinematic", "sci-fi"],
    "categories": ["Teknologi & AI"],
    "mood": "epic dan dramatis",
    "camera": "wide establishing shot"
  },
  "callbackUrl": "https://automation.maksitech.id/api/integrations/n8n/callback",
  "callbackSecret": "secret-callback",
  "appBaseUrl": "https://automation.maksitech.id",
  "huggingfaceToken": "hf_xxx"
}
```

## Payload callback dari n8n ke VidGen

Minimal:

```json
{
  "jobId": "abc123",
  "status": "processing",
  "message": "Sedang menjalankan workflow produksi."
}
```

Contoh selesai:

```json
{
  "jobId": "abc123",
  "status": "completed",
  "message": "Workflow selesai.",
  "finalVideoUrl": "https://cdn.example.com/final.mp4",
  "shortVideoUrl": "https://cdn.example.com/short.mp4",
  "thumbnailUrl": "https://cdn.example.com/thumb.jpg",
  "youtubeUrl": "https://youtube.com/watch?v=xxxx",
  "outputs": {
    "productionPrompt": "hasil prompt akhir dari workflow"
  }
}
```

Header callback:

```text
x-vidgen-callback-secret: <VIDGEN_CALLBACK_SECRET>
```

## File workflow n8n

Workflow import-ready ada di:

- `n8n/vidgen-omnichannel-v4.json`
- `n8n/vidgen-youtube-native-v5.json`
- `n8n/renderer-payload-spec.md`

Workflow ini fokus pada alur yang cocok dengan app saat ini:

1. terima job dari dashboard VidGen
2. callback status `processing`
3. generate konten via node `Ollama: Generate Konten`
4. buat audio TTS, generate klip, assembly FFmpeg
5. callback status `completed` dengan URL output video

## Workflow YouTube

File `n8n/vidgen-youtube-native-v5.json` menambahkan langkah:

1. generate narasi + prompt visual menggunakan Ollama
2. generate video clips lewat script Python/HuggingFace
3. assembly final video + short preview + thumbnail
4. callback ke VidGen dengan URL output

Sebelum dipakai:

1. Import workflow ke n8n
2. Pastikan node webhook path tetap `vidgen-production`
3. Pastikan worker n8n punya akses ke binary `ffmpeg`, `ffprobe`, `python3`, dan `edge-tts`
4. Jika pakai Ollama di host lain, set `OLLAMA_BASE_URL` di environment n8n/server app

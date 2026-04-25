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
REPLICATE_API_TOKEN=r8_xxx
REPLICATE_MODEL=lightricks/ltx-video
REPLICATE_USD_PER_SECOND=0.000975
REPLICATE_ESTIMATED_SECONDS_PER_RUN=22
REPLICATE_ESTIMATED_USD_PER_RUN=0.021
VIDGEN_USD_TO_IDR=17000
HUGGINGFACE_TOKEN=hf_xxx
COMFYUI_API_URL=https://cloud.comfy.org
COMFYUI_API_KEY=your_comfy_key
COMFYUI_WORKFLOW_FILE=/opt/vidgen/workflows/comfy_video_api.json
VIDEO_MODEL_URL=http://localhost:8188/render
N8N_WEBHOOK_URL=https://n8n.maksitech.id/webhook/vidgen-production
N8N_WEBHOOK_SECRET=isi-secret-yang-sama-dengan-node-webhook-di-n8n
VIDGEN_CALLBACK_SECRET=isi-secret-random-untuk-callback-dari-n8n
VIDGEN_QUEUE_DB=postgres
VIDGEN_POSTGRES_URL=postgresql://postgres:password@127.0.0.1:5432/vidgen

FIREBASE_PROJECT_ID=...
FIREBASE_CLIENT_EMAIL=...
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"
```

Catatan:
- Jalur `generate -> queue -> dispatch n8n -> callback` direkomendasikan memakai PostgreSQL agar tidak terblokir quota Firestore.
- n8n self-hosted resmi mendukung PostgreSQL. Dukungan MySQL/MariaDB di n8n v1.x sudah deprecated, jadi PostgreSQL adalah pilihan yang disarankan.
- Jika `VIDGEN_POSTGRES_URL` belum diisi, server masih fallback ke Firestore untuk queue.

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
4. buat audio TTS, generate klip via engine visual, assembly FFmpeg
5. callback status `completed` dengan URL output video

## Workflow YouTube

File `n8n/vidgen-youtube-native-v5.json` menambahkan langkah:

1. generate narasi + prompt visual menggunakan Ollama
2. generate video clips lewat engine visual yang benar-benar menghasilkan frame
3. assembly final video + short preview + thumbnail
4. callback ke VidGen dengan URL output

Penting:
- `Ollama` tidak membuat frame gambar/video.
- `ffmpeg` tidak membuat video generatif dari prompt.
- Agar workflow valid, Anda butuh minimal satu engine visual:
  - `REPLICATE_API_TOKEN` untuk Replicate, default model `lightricks/ltx-video`,
  - `COMFYUI_API_URL` + `COMFYUI_WORKFLOW_FILE` untuk ComfyUI API / Comfy Cloud,
  - `VIDEO_MODEL_URL` ke service lokal seperti ComfyUI/Wan/LTX wrapper, atau
  - `HUGGINGFACE_TOKEN` untuk endpoint video inference.
- Script sekarang fail-fast secara default jika engine visual tidak tersedia, agar tidak menghasilkan video hitam/blank yang terlihat sukses.

Untuk mode `ComfyUI API`:
- `COMFYUI_API_URL=https://cloud.comfy.org` jika memakai Comfy Cloud.
- `COMFYUI_API_KEY` wajib untuk Comfy Cloud, opsional untuk ComfyUI lokal.
- `COMFYUI_WORKFLOW_FILE` harus menunjuk ke file workflow JSON dalam format API.
- Workflow bisa mengembalikan video langsung, atau image yang nanti akan dibungkus menjadi clip video oleh script.
- Placeholder yang didukung untuk workflow ada di `n8n/comfyui-api-workflow-template.md`.

Troubleshooting cepat video hitam / blank:
- Buka log node `Generate Video Clips`.
- Cari baris `ENGINE_STATUS:` untuk melihat apakah `replicate`, `comfy`, `local`, atau `hf` benar-benar aktif saat runtime.
- Cari baris `CLIPS_SUMMARY:`. Jika `success=0`, berarti tidak ada klip valid yang berhasil dibuat.
- Jika log menunjukkan semua engine `0`, set minimal satu dari `REPLICATE_API_TOKEN`, `COMFYUI_API_URL`, `VIDEO_MODEL_URL`, atau `HUGGINGFACE_TOKEN` di environment n8n/container.
- Pastikan `VIDGEN_ALLOW_VISUAL_FALLBACK=false` dan `VIDGEN_ALLOW_BLACK_VIDEO_FALLBACK=false` di production agar job gagal terang-terangan, bukan upload video palsu.

Estimasi billing Replicate:
- `lightricks/ltx-video` di Replicate tercatat sekitar `$0.021/run`; karena VidGen membuat satu prediction per clip, default 8 clip kira-kira `$0.168/video`.
- Dengan kurs contoh `VIDGEN_USD_TO_IDR=17000`, default 8 clip kira-kira `Rp2.856/video`; 4 clip `Rp1.428`, 12 clip `Rp4.284`.
- Script menulis marker `REPLICATE_BILLING_ESTIMATE`, `REPLICATE_BILLING_CLIP`, dan `REPLICATE_BILLING_SUMMARY` di log node `Generate Video Clips`.
- Jika response Replicate punya `metrics.predict_time`, estimasi memakai runtime aktual x `REPLICATE_USD_PER_SECOND`; kalau tidak ada, memakai `REPLICATE_ESTIMATED_USD_PER_RUN`.

Sebelum dipakai:

1. Import workflow ke n8n
2. Pastikan node webhook path tetap `vidgen-production`
3. Pastikan worker n8n punya akses ke binary `ffmpeg`, `ffprobe`, `python3`, dan `edge-tts`
4. Jika pakai Ollama di host lain, set `OLLAMA_BASE_URL` di environment n8n/server app

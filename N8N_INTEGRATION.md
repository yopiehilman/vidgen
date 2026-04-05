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
GEMINI_API_KEY=...
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
  "submittedAt": "2026-04-05T00:00:00.000Z"
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

- `n8n/vidgen-production-workflow.json`
- `n8n/vidgen-production-youtube-workflow.json`
- `n8n/vidgen-error-handler-workflow.json`
- `n8n/renderer-payload-spec.md`
- `n8n/renderer-request-example.json`

Workflow ini fokus pada alur yang cocok dengan app saat ini:

1. terima job dari dashboard VidGen
2. callback status `processing`
3. panggil `automation.maksitech.id/api/generate` untuk merapikan paket prompt produksi
4. jika `metadata.renderWebhookUrl` ada, kirim paket produksi ke renderer eksternal
5. callback status `completed`

## Render webhook opsional

Kalau Anda sudah punya service renderer video sendiri, kirim URL-nya di metadata job:

```json
{
  "metadata": {
    "renderWebhookUrl": "https://renderer.example.com/webhook/render"
  }
}
```

Service renderer diharapkan mengembalikan JSON seperti ini:

```json
{
  "finalVideoUrl": "https://cdn.example.com/final.mp4",
  "shortVideoUrl": "https://cdn.example.com/short.mp4",
  "thumbnailUrl": "https://cdn.example.com/thumb.jpg",
  "youtubeUrl": "https://youtube.com/watch?v=xxxx"
}
```

## Workflow YouTube

File `n8n/vidgen-production-youtube-workflow.json` menambahkan langkah:

1. render video lewat `metadata.renderWebhookUrl`
2. download hasil video ke `/files/vidgen/<jobId>.mp4`
3. upload ke node `YouTube Upload`
4. callback ke VidGen dengan `youtubeUrl`

Sebelum dipakai:

1. Import workflow ke n8n
2. Buka node `YouTube Upload`
3. Pilih credential YouTube OAuth2 Anda secara manual
4. Pastikan container n8n punya akses tulis ke `/files`

## Workflow Error Handler

File `n8n/vidgen-error-handler-workflow.json` dipakai sebagai `Error Workflow` di n8n.

Opsional env di n8n:

```env
VIDGEN_ERROR_WEBHOOK_URL=https://your-alert-endpoint.example.com/webhook/errors
```

Setelah import:

1. Buka workflow utama yang dipakai
2. Masuk ke `Workflow Settings`
3. Pilih `Error Workflow`
4. Arahkan ke `VidGen Error Handler`

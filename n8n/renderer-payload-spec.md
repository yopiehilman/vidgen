# Renderer Payload Spec

Dokumen ini menjelaskan format payload standar agar service renderer video Anda bisa dipanggil dari workflow n8n VidGen.

## Request dari n8n ke renderer

Method:

```text
POST
```

Header:

```text
Content-Type: application/json
```

Body:

```json
{
  "jobId": "vidgen-job-id",
  "title": "Judul video final untuk publish",
  "topic": "Topik asli dari user",
  "category": "Teknologi & AI",
  "prompt": "Paket prompt/naskah lengkap hasil /api/generate",
  "metadata": {
    "styles": ["cinematic", "sci-fi"],
    "categories": ["Teknologi & AI"],
    "mood": "epic dan dramatis",
    "camera": "wide establishing shot",
    "publishYouTube": true,
    "youtubeCategoryId": "28",
    "youtubePrivacyStatus": "private",
    "youtubeTags": ["ai", "teknologi", "vidgen"]
  },
  "callbackUrl": "https://automation.maksitech.id/api/integrations/n8n/callback",
  "callbackSecret": "secret-untuk-callback-ke-vidgen",
  "requestedAt": "2026-04-06T00:00:00.000Z"
}
```

## Respons minimum dari renderer

Renderer boleh memproses sinkron atau asinkron.

Kalau sinkron:

```json
{
  "finalVideoUrl": "https://cdn.example.com/videos/job-123-final.mp4",
  "shortVideoUrl": "https://cdn.example.com/videos/job-123-short.mp4",
  "thumbnailUrl": "https://cdn.example.com/videos/job-123-thumb.jpg"
}
```

Kalau asinkron, renderer boleh segera menjawab:

```json
{
  "accepted": true,
  "renderJobId": "render-987",
  "status": "queued"
}
```

Lalu renderer melakukan callback sendiri ke `callbackUrl`.

## Callback dari renderer ke VidGen

Method:

```text
POST
```

Header:

```text
x-vidgen-callback-secret: <callbackSecret>
Content-Type: application/json
```

Body status proses:

```json
{
  "jobId": "vidgen-job-id",
  "status": "processing",
  "message": "Render sedang berjalan",
  "progress": 55,
  "externalJobId": "render-987"
}
```

Body status selesai:

```json
{
  "jobId": "vidgen-job-id",
  "status": "completed",
  "message": "Render selesai",
  "progress": 100,
  "externalJobId": "render-987",
  "finalVideoUrl": "https://cdn.example.com/videos/job-123-final.mp4",
  "shortVideoUrl": "https://cdn.example.com/videos/job-123-short.mp4",
  "thumbnailUrl": "https://cdn.example.com/videos/job-123-thumb.jpg",
  "youtubeUrl": "https://www.youtube.com/watch?v=xxxx"
}
```

Body status gagal:

```json
{
  "jobId": "vidgen-job-id",
  "status": "failed",
  "message": "Render gagal",
  "error": {
    "code": "RENDER_TIMEOUT",
    "detail": "Service rendering timeout setelah 30 menit"
  }
}
```

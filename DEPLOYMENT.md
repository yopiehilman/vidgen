# Panduan Deploy: Generator Video

Berikut adalah catatan lengkap untuk mendeploy aplikasi Generator Video ke server (VPS/Cloud).

## 1. Apakah Harus Install Firebase di Server?
**Jawabannya: Tidak.**
Firebase yang digunakan di aplikasi ini adalah **Client-Side SDK**. Artinya:
- Firebase akan "dibungkus" (bundled) ke dalam file JavaScript saat Anda menjalankan `npm run build`.
- Anda tidak perlu menginstall Firebase CLI atau software Firebase apapun di sistem operasi server Anda.
- Anda hanya perlu memastikan file `firebase-applet-config.json` atau konfigurasi Firebase di `src/firebase.ts` sudah benar sebelum melakukan build.

## 2. Daftar Package Utama yang Dibutuhkan
Aplikasi ini menggunakan beberapa library penting yang harus terinstall di folder project (via `npm install`):
- **Frontend Framework**: `react`, `react-dom` (v19)
- **Build Tool**: `vite`
- **Styling**: `tailwindcss`, `lucide-react` (icons)
- **AI Engine**: `Ollama` (akses lewat endpoint `OLLAMA_BASE_URL`)
- **Database/Auth**: `firebase` (v12)
- **Animation**: `motion` (framer-motion)

Catatan penting:
- `Ollama` di arsitektur ini dipakai untuk naskah, metadata, dan prompt scene.
- Render visual tetap butuh engine generatif terpisah untuk `text-to-video` atau `image-to-video`.
- `ffmpeg` hanya merakit hasil visual + audio menjadi video akhir.

## 3. Persiapan Lingkungan (Environment Variables)
Sebelum menjalankan server, buat file `.env` di root folder server:
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
N8N_WEBHOOK_URL=https://n8n.example.com/webhook/vidgen-production
VIDGEN_CALLBACK_SECRET=replace-with-random-secret
```
*Catatan: pada arsitektur terbaru, AI dipanggil dari server Express, bukan dari browser.*

Opsional fallback darurat:
```env
VIDGEN_ALLOW_VISUAL_FALLBACK=false
VIDGEN_ALLOW_BLACK_VIDEO_FALLBACK=false
```
Biarkan `false` untuk production agar job gagal jelas saat engine visual tidak tersedia.

Untuk mode ComfyUI API:
- Server/app Anda boleh tetap CPU-only.
- Generasi visual dijalankan oleh ComfyUI API / Comfy Cloud.
- Workflow harus disimpan dalam format `API format JSON` dari ComfyUI, lalu path-nya diisi ke `COMFYUI_WORKFLOW_FILE`.
- Placeholder yang didukung dijelaskan di `n8n/comfyui-api-workflow-template.md`.

Untuk mode Replicate:
- Isi `REPLICATE_API_TOKEN`; jika variabel ini ada, `generate_clips.py` akan memakainya sebelum ComfyUI, local model, atau HuggingFace.
- `REPLICATE_MODEL` opsional dan default-nya `lightricks/ltx-video`.
- Billing dihitung per clip karena VidGen membuat satu Replicate prediction per clip. Default 8 clip kira-kira `$0.168/video` atau sekitar `Rp2.856` bila `VIDGEN_USD_TO_IDR=17000`.
- Cek log `REPLICATE_BILLING_SUMMARY` di node `Generate Video Clips` untuk estimasi per job.

## 4. Langkah-Langkah Deploy di VPS (Ubuntu/Debian)

### A. Install Node.js & NPM
```bash
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs
```

### B. Persiapan Source Code
1. Upload folder project ke server.
2. Masuk ke folder project: `cd vidgen-ai`
3. Install semua package:
   ```bash
   npm install
   ```

### C. Build Aplikasi
Jalankan perintah build untuk menghasilkan folder `dist/` yang berisi file statis:
```bash
npm run build
```

### D. Serve Menggunakan Nginx (Rekomendasi)
1. Install Nginx: `sudo apt install nginx`
2. Copy isi folder `dist/` ke folder web server:
   ```bash
   sudo cp -r dist/* /var/www/html/
   ```
3. Pastikan konfigurasi Nginx mendukung SPA (Single Page Application) agar routing React berjalan lancar:
   Edit `/etc/nginx/sites-available/default`:
   ```nginx
   location / {
       try_files $uri $uri/ /index.html;
   }
   ```
4. Restart Nginx: `sudo systemctl restart nginx`

## 5. Keamanan & SSL
- Gunakan **Certbot (Let's Encrypt)** untuk mengaktifkan HTTPS. Ini **WAJIB** jika Anda ingin fitur PWA (Install App) muncul di HP user.
- Jangan pernah membagikan file `.env` atau API Key Anda di repository publik (GitHub).

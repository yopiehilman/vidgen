# Panduan Deploy: VidGen AI

Berikut adalah catatan lengkap untuk mendeploy aplikasi VidGen AI ke server (VPS/Cloud).

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
- **AI Engine**: `@google/genai` (untuk analisa trend & video)
- **Database/Auth**: `firebase` (v12)
- **Animation**: `motion` (framer-motion)

## 3. Persiapan Lingkungan (Environment Variables)
Sebelum melakukan build, buat file `.env` di root folder server Anda dan masukkan API Key:
```env
GEMINI_API_KEY=your_api_key_here
```
*Catatan: API Key ini akan dimasukkan ke dalam build oleh Vite.*

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

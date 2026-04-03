# Deployment Guide: VidGen AI

Aplikasi ini dibangun menggunakan React (Frontend) dan n8n (Backend Automation). Berikut adalah langkah-langkah untuk mendeploy aplikasi ini di server (VPS).

## 1. Persiapan Server (VPS)
Pastikan server Anda memiliki spesifikasi minimal:
- **CPU**: 2 Core+ (untuk Ollama)
- **RAM**: 8GB+ (Mistral 7B butuh ~4.5GB, Kokoro TTS ~2GB)
- **OS**: Ubuntu 22.04 LTS

## 2. Install Dependencies di VPS
Jalankan perintah berikut di terminal VPS Anda:

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Docker (untuk n8n & Ollama)
sudo apt-get update
sudo apt-get install ca-certificates border-radius gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
```

## 3. Setup n8n & Ollama (Docker Compose)
Buat file `docker-compose.yml`:

```yaml
services:
  ollama:
    image: ollama/ollama
    container_name: ollama
    volumes:
      - ollama:/root/.ollama
    ports:
      - "11434:11434"

  n8n:
    image: n8nio/n8n
    container_name: n8n
    ports:
      - "5678:5678"
    environment:
      - N8N_HOST=your-domain.com
      - WEBHOOK_URL=https://your-domain.com/
    volumes:
      - n8n_data:/home/node/.n8n

volumes:
  ollama:
  n8n_data:
```

## 4. Deploy Frontend (VidGen AI Dashboard)
1. **Build Aplikasi**:
   ```bash
   npm install
   npm run build
   ```
2. **Serve menggunakan Nginx**:
   Copy isi folder `dist/` ke `/var/www/html`.
3. **Konfigurasi SSL**:
   Gunakan Certbot untuk HTTPS (Wajib untuk PWA).

## 5. Konfigurasi n8n Workflow
1. Import workflow n8n yang disediakan.
2. Masukkan Webhook URL ke dalam aplikasi VidGen AI di tab **Settings**.
3. Pastikan Ollama sudah mendownload model: `docker exec -it ollama ollama run mistral`.

## 6. PWA Installation
Aplikasi akan otomatis menawarkan instalasi jika dibuka melalui browser mobile (Chrome/Safari) dengan koneksi HTTPS.

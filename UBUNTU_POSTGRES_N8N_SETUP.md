# Ubuntu Setup: PostgreSQL untuk VidGen dan n8n

Panduan ini untuk Ubuntu server self-hosted.

Target akhir:

- `VidGen app` memakai PostgreSQL untuk queue produksi
- `VidGen app` memakai PostgreSQL untuk profile/settings/history/schedules
- `n8n` juga memakai PostgreSQL
- jalur `generate -> queue -> n8n` tidak lagi bergantung pada Firestore quota

## 1. Install PostgreSQL di Ubuntu

Referensi resmi PostgreSQL APT repo:
- https://wiki.postgresql.org/wiki/Apt

Quickstart resmi:

```bash
sudo apt install -y postgresql-common ca-certificates
sudo /usr/share/postgresql-common/pgdg/apt.postgresql.org.sh
```

Kalau ingin pin versi stabil spesifik, install misalnya PostgreSQL 17:

```bash
sudo apt update
sudo apt install -y postgresql-17 postgresql-client-17
```

Cek service:

```bash
sudo systemctl status postgresql
sudo systemctl enable postgresql
```

## 2. Buat user dan database

Masuk sebagai postgres:

```bash
sudo -u postgres psql
```

Lalu jalankan:

```sql
CREATE USER vidgen_app WITH PASSWORD 'ganti-password-aman';
CREATE USER n8n_app WITH PASSWORD 'ganti-password-aman';

CREATE DATABASE vidgen OWNER vidgen_app;
CREATE DATABASE n8n OWNER n8n_app;

\q
```

## 3. Buat schema queue VidGen

Jalankan:

```bash
sudo -u postgres psql -d vidgen -f /path/to/vidgen/scripts/setup_postgres_queue.sql
```

Contoh path repo:

```bash
cd /var/www/vidgen
sudo -u postgres psql -d vidgen -f scripts/setup_postgres_queue.sql
```

## 4. Konfigurasi VidGen

Edit `.env` VidGen:

```env
VIDGEN_QUEUE_DB=postgres
VIDGEN_POSTGRES_URL=postgresql://vidgen_app:ganti-password-aman@127.0.0.1:5432/vidgen

N8N_WEBHOOK_URL=https://n8n.example.com/webhook/vidgen-production
N8N_WEBHOOK_SECRET=ganti-secret-webhook
VIDGEN_CALLBACK_SECRET=ganti-secret-callback
```

Kalau tidak pakai connection string, boleh pakai:

```env
VIDGEN_QUEUE_DB=postgres
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=vidgen
PGUSER=vidgen_app
PGPASSWORD=ganti-password-aman
```

## 5. Konfigurasi n8n

Referensi resmi n8n:
- https://docs.n8n.io/hosting/configuration/supported-databases-settings/
- https://docs.n8n.io/hosting/configuration/environment-variables/database/

Environment minimum n8n:

```env
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=127.0.0.1
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_USER=n8n_app
DB_POSTGRESDB_PASSWORD=ganti-password-aman
DB_POSTGRESDB_SCHEMA=public
```

Catatan resmi n8n:

- self-hosted n8n mendukung PostgreSQL
- MySQL/MariaDB sudah deprecated/removed di n8n v1.x

## 6. Restart service

Sesuaikan dengan cara kamu menjalankan service.

Jika VidGen dijalankan sebagai Node app:

```bash
cd /var/www/vidgen
npm run build
npm start
```

Jika pakai systemd, restart service masing-masing, misalnya:

```bash
sudo systemctl restart vidgen
sudo systemctl restart n8n
```

Jika pakai PM2:

```bash
pm2 restart vidgen
pm2 restart n8n
```

## 7. Verifikasi

Cek health VidGen:

```bash
curl -s http://127.0.0.1:3000/health
curl -s http://127.0.0.1:3000/api/health
curl -s http://127.0.0.1:3000/api/integrations/n8n/health
```

Pastikan response menampilkan:

```json
"queueBackend": "postgres"
```

Test generate satu job, lalu cek queue:

```bash
curl -s http://127.0.0.1:3000/api/production-jobs
```

Endpoint ini butuh auth dari app, jadi untuk cek cepat lebih aman lihat dari halaman Queue dashboard setelah login.

## 8. Jika Firestore quota habis

Firestore free quota reset sekitar `midnight Pacific time`.

Untuk Asia/Bangkok, ini biasanya sekitar `14:00 ICT` saat Pacific sedang DST.

Tapi setelah queue VidGen pindah ke PostgreSQL, blocker utama generate video tidak lagi menunggu reset quota Firestore tersebut.

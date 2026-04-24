# Migrasi Queue VidGen ke PostgreSQL

Dokumen ini sekarang mencakup migrasi data app utama ke PostgreSQL:

- `Generate -> POST /api/production-jobs`
- penyimpanan queue produksi
- dispatch ke webhook n8n
- callback status dari n8n
- halaman Queue di dashboard
- profile user dashboard
- settings dashboard
- history prompt
- schedules editor

## Kenapa PostgreSQL

- n8n self-hosted resmi mendukung `PostgreSQL`.
- Dukungan `MySQL/MariaDB` di n8n v1.x sudah deprecated.
- PostgreSQL cocok untuk queue server-side dan retry scheduler.

## Yang sudah dipindahkan di codebase

- Backend queue server-side di [server/postgres-queue.mjs](/c:/xampp/htdocs/vidgen/server/postgres-queue.mjs)
- API queue/retry/callback/dispatch di [server/index.mjs](/c:/xampp/htdocs/vidgen/server/index.mjs)
- Queue page frontend sekarang baca dari `GET /api/production-jobs`
- Bootstrap dashboard, settings, history, dan schedules sekarang lewat API server
- Driver PostgreSQL: `pg`

## Environment server app

Isi `.env` server:

```env
VIDGEN_QUEUE_DB=postgres
VIDGEN_POSTGRES_URL=postgresql://postgres:password@127.0.0.1:5432/vidgen
N8N_WEBHOOK_URL=https://n8n.example.com/webhook/vidgen-production
N8N_WEBHOOK_SECRET=replace-me
VIDGEN_CALLBACK_SECRET=replace-me
```

Alternatif jika tidak pakai connection string:

```env
VIDGEN_QUEUE_DB=postgres
PGHOST=127.0.0.1
PGPORT=5432
PGDATABASE=vidgen
PGUSER=postgres
PGPASSWORD=password
```

## Bootstrap database

Pilihan 1: biarkan server membuat tabel otomatis saat start.

Pilihan 2: buat manual lewat SQL:

File: [scripts/setup_postgres_queue.sql](/c:/xampp/htdocs/vidgen/scripts/setup_postgres_queue.sql)

Contoh:

```powershell
cd /var/www/vidgen
sudo -u postgres psql -d vidgen -f scripts/setup_postgres_queue.sql
```

## Start server app

```powershell
npm run build
npm start
```

Cek health:

- `GET /health`
- `GET /api/health`
- `GET /api/integrations/n8n/health`

Respons sekarang menyertakan `queueBackend`, yang idealnya bernilai `postgres`.

## Konfigurasi n8n

n8n sendiri juga sebaiknya pakai PostgreSQL.

Environment minimum:

```env
DB_TYPE=postgresdb
DB_POSTGRESDB_HOST=127.0.0.1
DB_POSTGRESDB_PORT=5432
DB_POSTGRESDB_DATABASE=n8n
DB_POSTGRESDB_USER=postgres
DB_POSTGRESDB_PASSWORD=password
DB_POSTGRESDB_SCHEMA=public
```

Catatan:

- Database n8n boleh dipisah dari database app VidGen.
- Praktik yang lebih rapi:
  - DB app: `vidgen`
  - DB n8n: `n8n`

## Yang masih tersisa di Firebase

Saat ini Firebase dipertahankan terutama untuk autentikasi user (`Firebase Auth`).

Data aplikasi utama tidak perlu lagi bergantung ke Firestore jika PostgreSQL aktif.

## Urutan rollout yang disarankan

1. Install PostgreSQL di server.
2. Buat DB `vidgen` dan isi env `VIDGEN_POSTGRES_URL`.
3. Restart server VidGen.
4. Cek `GET /api/integrations/n8n/health` dan pastikan `queueBackend=postgres`.
5. Test generate satu video.
6. Setelah app stabil, pindahkan database internal n8n ke PostgreSQL juga.

## Catatan quota Firestore

Free quota Firestore reset sekitar `midnight Pacific time`.

Untuk `Asia/Bangkok`, ini biasanya sekitar `14:00 ICT` saat Pacific sedang DST.

Ini hanya relevan untuk fitur yang masih memakai Firestore. Jalur queue PostgreSQL tidak lagi menunggu reset quota tersebut.

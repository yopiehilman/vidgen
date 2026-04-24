const fs = require('fs');
const path = require('path');

const inputPath = path.join(__dirname, '../n8n/vidgen-omnichannel-v4.json');
const outputPath = path.join(__dirname, '../n8n/vidgen-youtube-native-v5.json');

const data = JSON.parse(fs.readFileSync(inputPath, 'utf8'));

// Modifikasi nama workflow
data.name = "VidGen AI v5 — YouTube Native";
data.id = "vidgen-youtube-native";

// Ambil node dari index 0 s.d sebelum "node-16"
const nodes = data.nodes.filter(n => {
  const nodeNum = parseInt(n.id.replace('node-', ''), 10);
  return nodeNum <= 15 || n.id === 'node-21' || n.id === 'node-22';
});

// Posisi untuk penempatan node baru
const baseX = 3100;
const baseY = 360;

// Tambahkan Node Upload via Script
nodes.push({
  "parameters": {
    "command": "=#!/bin/bash\nset -e\nFINAL=\"{{ $('Parse Hasil FFmpeg').first().json.finalVideoPath }}\"\nSHORT=\"{{ $('Parse Hasil FFmpeg').first().json.shortVideoPath }}\"\nTHUMB=\"{{ $('Parse Hasil FFmpeg').first().json.thumbPath }}\"\nJUDUL_YT=\"{{ $('Parse Hasil FFmpeg').first().json.judul }}\"\nDESKRIPSI=\"{{ $('Parse Hasil FFmpeg').first().json.deskripsi }}\"\nYT_CATEGORY=\"{{ $('Parse Hasil FFmpeg').first().json.youtubeCategory }}\"\nTAGS=\"{{ $('Parse Hasil FFmpeg').first().json.tags.join(',') }}\"\n\nSCRIPT=\"/opt/vidgen/upload_platforms.py\"\n[ -f \"$SCRIPT\" ] || SCRIPT=\"/opt/vidgen/scripts/upload_platforms.py\"\n[ -f \"$SCRIPT\" ] || { echo \"[UPLOAD ERROR] upload_platforms.py tidak ditemukan di /opt/vidgen atau /opt/vidgen/scripts\"; exit 1; }\n\nENV_LOADED=\"\"\nfor ENV_FILE in /var/www/vidgen/.env /var/www/vidgen/.env.local /opt/vidgen/.env /opt/vidgen/.env.local /workspace/vidgen/.env /workspace/vidgen/.env.local /root/.n8n/.env /root/.n8n/.env.local; do\n  if [ -f \"$ENV_FILE\" ]; then\n    echo \"[UPLOAD] load env from $ENV_FILE\"\n    set -a\n    . \"$ENV_FILE\"\n    set +a\n    ENV_LOADED=\"$ENV_FILE\"\n    break\n  fi\ndone\n\nif [ -z \"$ENV_LOADED\" ]; then\n  echo \"[UPLOAD] tidak menemukan file .env fallback, pakai environment proses/container n8n\"\nfi\n\necho \"[UPLOAD] YOUTUBE_CLIENT_ID loaded: ${YOUTUBE_CLIENT_ID:+yes}\"\necho \"[UPLOAD] YOUTUBE_CLIENT_SECRET loaded: ${YOUTUBE_CLIENT_SECRET:+yes}\"\necho \"[UPLOAD] YOUTUBE_REFRESH_TOKEN loaded: ${YOUTUBE_REFRESH_TOKEN:+yes}\"\n\npython3 \"$SCRIPT\" \\\n  --platforms \"youtube\" \\\n  --final-video \"$FINAL\" \\\n  --short-video \"$SHORT\" \\\n  --thumb \"$THUMB\" \\\n  --title-yt \"$JUDUL_YT\" \\\n  --desc-yt \"$DESKRIPSI\" \\\n  --yt-category \"$YT_CATEGORY\" \\\n  --tags \"$TAGS\""
  },
  "id": "node-16-read-binary",
  "name": "Upload ke Platform",
  "type": "n8n-nodes-base.executeCommand",
  "typeVersion": 1,
  "position": [baseX, baseY]
});

// Sisipkan guard agar AI thumbnail opsional bila API tidak mengembalikan binary image.
const thumbnailNodeIndex = nodes.findIndex((node) => node.name === 'Write AI Thumbnail');
if (thumbnailNodeIndex !== -1) {
  nodes.splice(thumbnailNodeIndex, 0, {
    "parameters": {
      "jsCode": "const item = $input.first();\nif (!item?.binary?.data) {\n  console.warn('[Thumbnail] AI thumbnail tidak mengembalikan binary image. Skip write file thumbnail.');\n  return [];\n}\nreturn [item];"
    },
    "id": "node-05a-guard",
    "name": "Cek AI Thumbnail",
    "type": "n8n-nodes-base.code",
    "typeVersion": 2,
    "position": [1400, 200]
  });
}

// Tambahkan Node Parse Hasil Upload
nodes.push({
  "parameters": {
    "jsCode": "const stdout = $input.first().json.stdout || '';\nconst stderr = $input.first().json.stderr || '';\nconst prev = $('Parse Hasil FFmpeg').first().json;\n\nlet results = {};\nlet parseError = '';\ntry {\n  const resultLine = stdout.split(/\\r?\\n/).find((line) => line.startsWith('UPLOAD_RESULTS:'));\n  if (resultLine) {\n    results = JSON.parse(resultLine.slice('UPLOAD_RESULTS:'.length));\n  } else {\n    parseError = 'Marker UPLOAD_RESULTS tidak ditemukan di stdout.';\n  }\n} catch (e) {\n  parseError = e.message;\n  console.error('[Upload Parse] Error:', e.message, stdout);\n}\n\nconst youtubeOk = results.youtube?.ok || false;\nconst youtubeUrl = results.youtube?.url || '';\nconst uploadSummary = [];\nif (youtubeUrl) uploadSummary.push(`YouTube: ${youtubeUrl}`);\n\nconst credsState = {\n  clientIdLoaded: /YOUTUBE_CLIENT_ID loaded:\\s*yes/i.test(stdout),\n  clientSecretLoaded: /YOUTUBE_CLIENT_SECRET loaded:\\s*yes/i.test(stdout),\n  refreshTokenLoaded: /YOUTUBE_REFRESH_TOKEN loaded:\\s*yes/i.test(stdout),\n  envFileLoaded: (/\\[UPLOAD\\] load env from\\s+(.+)/i.exec(stdout) || [])[1] || '',\n};\n\nif (!youtubeOk) {\n  const needsReauth = Boolean(results.youtube?.needs_reauth);\n  const authCode = String(results.youtube?.auth_error_code || '').trim();\n  const authHint = needsReauth\n    ? ` Refresh token/client OAuth YouTube perlu dihubungkan ulang.${results.youtube?.auth_error_hint ? ` ${results.youtube.auth_error_hint}` : ''}`\n    : (/unauthorized/i.test([results.youtube?.error, stderr, stdout].filter(Boolean).join(' | '))\n      ? ' Kemungkinan access token sempat ditolak; sistem sudah mencoba refresh otomatis. Jika masih gagal, cek credential OAuth YouTube.'\n      : '');\n  const details = [\n    results.youtube?.error,\n    results.youtube?.auth_error_hint,\n    parseError,\n    stderr,\n    stdout ? stdout.slice(0, 1500) : '',\n  ].filter(Boolean).join(' | ');\n  throw new Error(`Upload YouTube gagal.${authHint} authCode=${authCode || '-'} creds=${JSON.stringify(credsState)}. ${details || 'Tanpa detail.'}`.slice(0, 1800));\n}\n\nreturn [{ json: {\n  ...prev,\n  youtubeUrl,\n  uploadResults: results,\n  uploadSummary,\n  uploadStdout: stdout,\n  uploadStderr: stderr,\n  uploadCredsState: credsState\n}}];"
  },
  "id": "node-17-youtube",
  "name": "Parse Hasil Upload",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [baseX + 240, baseY]
});

// Tambahkan Node Callback
nodes.push({
  "parameters": {
    "method": "POST",
    "url": "={{ $json.callbackUrl }}",
    "sendHeaders": true,
    "specifyHeaders": "json",
    "jsonHeaders": "={{ JSON.stringify($json.callbackHeaders) }}",
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify({\n  jobId: $json.jobId,\n  status: 'completed',\n  message: 'Produksi dan upload YouTube selesai.',\n  progress: 100,\n  executionId: $execution.id,\n  currentStage: 'youtube_uploaded',\n  currentNode: 'Upload ke Platform',\n  stageLabel: 'Upload YouTube selesai',\n  finalVideoUrl: $json.finalVideoUrl,\n  shortVideoUrl: $json.shortVideoUrl,\n  thumbnailUrl: $json.thumbUrl,\n  youtubeUrl: $json.youtubeUrl,\n  outputs: {\n    duration: $json.final_duration_str,\n    size: $json.final_size,\n    platforms: $json.uploadSummary\n  }\n}) }}",
    "options": { "timeout": 15000 }
  },
  "id": "node-18-parse",
  "name": "Callback: Completed",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [baseX + 480, baseY],
  "continueOnFail": true
});

// Tambahkan Cleaning
nodes.push({
  "parameters": {
    "command": "=rm -rf {{ $('Normalize Request').first().json.jobDir }} && rm -f /tmp/vidgen_{{ $('Normalize Request').first().json.jobId }}_prompts.json && echo 'CLEANUP_OK'"
  },
  "id": "node-19-callback",
  "name": "Bersihkan File Temp",
  "type": "n8n-nodes-base.executeCommand",
  "typeVersion": 1,
  "position": [baseX + 720, baseY],
  "continueOnFail": true
});

// Modifikasi connections
const oldConnections = data.connections;
const newConnections = { ...oldConnections };

// Hapus connection dari node-lama yang berhubungan dg upload
delete newConnections['Upload ke Platform'];
delete newConnections['Parse Hasil Upload'];
delete newConnections['Callback: Completed'];
delete newConnections['Read Video Binary'];

// Redirect Wait Until Upload Time ke uploader
newConnections['Wait Until Upload Time'] = {
  "main": [[
    { "node": "Upload ke Platform", "type": "main", "index": 0 },
    { "node": "Callback: Uploading YouTube", "type": "main", "index": 0 }
  ]]
};

// Sambungkan flow baru
newConnections['Upload ke Platform'] = {
  "main": [[{ "node": "Parse Hasil Upload", "type": "main", "index": 0 }]]
};

newConnections['Generate AI Thumbnail'] = {
  "main": [[{ "node": "Cek AI Thumbnail", "type": "main", "index": 0 }]]
};

newConnections['Cek AI Thumbnail'] = {
  "main": [[{ "node": "Write AI Thumbnail", "type": "main", "index": 0 }]]
};

newConnections['Parse Hasil Upload'] = {
  "main": [[{ "node": "Callback: Completed", "type": "main", "index": 0 }]]
};

newConnections['Callback: Completed'] = {
  "main": [[{ "node": "Bersihkan File Temp", "type": "main", "index": 0 }]]
};

data.nodes = nodes;
data.connections = newConnections;

fs.writeFileSync(outputPath, JSON.stringify(data, null, 2), 'utf8');
console.log('Successfully written to ' + outputPath);

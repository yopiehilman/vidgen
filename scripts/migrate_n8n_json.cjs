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
    "command": "=#!/bin/bash\nFINAL=\"{{ $('Parse Hasil FFmpeg').first().json.finalVideoPath }}\"\nSHORT=\"{{ $('Parse Hasil FFmpeg').first().json.shortVideoPath }}\"\nTHUMB=\"{{ $('Parse Hasil FFmpeg').first().json.thumbPath }}\"\nJUDUL_YT=\"{{ $('Parse Hasil FFmpeg').first().json.judul }}\"\nDESKRIPSI=\"{{ $('Parse Hasil FFmpeg').first().json.deskripsi }}\"\nYT_CATEGORY=\"{{ $('Parse Hasil FFmpeg').first().json.youtubeCategory }}\"\nTAGS=\"{{ $('Parse Hasil FFmpeg').first().json.tags.join(',') }}\"\n\nSCRIPT=\"/opt/vidgen/upload_platforms.py\"\n[ -f \"$SCRIPT\" ] || SCRIPT=\"/opt/vidgen/scripts/upload_platforms.py\"\n[ -f \"$SCRIPT\" ] || { echo \"[UPLOAD ERROR] upload_platforms.py tidak ditemukan di /opt/vidgen atau /opt/vidgen/scripts\"; exit 1; }\n\npython3 \"$SCRIPT\" \\\n  --platforms \"youtube\" \\\n  --final-video \"$FINAL\" \\\n  --short-video \"$SHORT\" \\\n  --thumb \"$THUMB\" \\\n  --title-yt \"$JUDUL_YT\" \\\n  --desc-yt \"$DESKRIPSI\" \\\n  --yt-category \"$YT_CATEGORY\" \\\n  --tags \"$TAGS\""
  },
  "id": "node-16-read-binary",
  "name": "Upload ke Platform",
  "type": "n8n-nodes-base.executeCommand",
  "typeVersion": 1,
  "position": [baseX, baseY]
});

// Tambahkan Node Parse Hasil Upload
nodes.push({
  "parameters": {
    "jsCode": "const stdout = $input.first().json.stdout || '';\nconst stderr = $input.first().json.stderr || '';\nconst prev = $('Parse Hasil FFmpeg').first().json;\n\nlet results = {};\ntry {\n  const match = stdout.match(/UPLOAD_RESULTS:(\\{[\\s\\S]*\\})/);\n  if (match) results = JSON.parse(match[1]);\n} catch(e) {\n  console.error('[Upload Parse] Error:', e.message, stdout);\n}\n\nconst youtubeOk = results.youtube?.ok || false;\nconst youtubeUrl = results.youtube?.url || '';\nconst uploadSummary = [];\nif (youtubeUrl) uploadSummary.push(`YouTube: ${youtubeUrl}`);\n\nif (!youtubeOk) {\n  const message = results.youtube?.error || stderr || stdout || 'Upload YouTube gagal tanpa detail.';\n  throw new Error(message.slice(0, 1000));\n}\n\nreturn [{ json: {\n  ...prev,\n  youtubeUrl,\n  uploadResults: results,\n  uploadSummary,\n  uploadStdout: stdout\n}}];"
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

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

// Tambahkan Node Read Binary File
nodes.push({
  "parameters": {
    "filePath": "={{ $('Parse Hasil FFmpeg').first().json.finalVideoPath }}",
    "dataPropertyName": "data"
  },
  "id": "node-16-read-binary",
  "name": "Read Video Binary",
  "type": "n8n-nodes-base.readBinaryFile",
  "typeVersion": 1,
  "position": [baseX, baseY]
});

// Tambahkan Node YouTube
nodes.push({
  "parameters": {
    "resource": "video",
    "operation": "upload",
    "title": "={{ $('Parse Hasil FFmpeg').first().json.judul }}",
    "description": "={{ $('Parse Hasil FFmpeg').first().json.deskripsi }}",
    "categoryId": "={{ $('Parse Hasil FFmpeg').first().json.youtubeCategory }}",
    "tags": "={{ $('Parse Hasil FFmpeg').first().json.tags.join(',') }}",
    "privacyStatus": "public",
    "binaryData": true,
    "binaryPropertyName": "data"
  },
  "id": "node-17-youtube",
  "name": "YouTube Upload",
  "type": "n8n-nodes-base.youTube",
  "typeVersion": 1,
  "position": [baseX + 240, baseY],
  "credentials": {
    "youTubeOAuth2Api": {
      "id": "",
      "name": "YouTube account"
    }
  }
});

// Tambahkan Node Parse Hasil
nodes.push({
  "parameters": {
    "jsCode": "const prev = $('Parse Hasil FFmpeg').first().json;\nconst ytNode = $input.first().json;\n\n// Untuk YouTube node, url biasanya bisa didapat dari videoId\nconst videoId = ytNode.id || '';\nconst youtubeUrl = videoId ? `https://youtube.com/watch?v=${videoId}` : '';\n\nconst uploadSummary = [];\nif (youtubeUrl) uploadSummary.push(`YouTube: ${youtubeUrl}`);\n\nreturn [{ json: {\n  ...prev,\n  youtubeUrl,\n  uploadSummary\n}}];"
  },
  "id": "node-18-parse",
  "name": "Parse Hasil Upload",
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [baseX + 480, baseY]
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
    "jsonBody": "={{ JSON.stringify({\n  jobId: $json.jobId,\n  status: 'completed',\n  message: 'Produksi dan upload YouTube selesai.',\n  progress: 100,\n  executionId: $execution.id,\n  finalVideoUrl: $json.finalVideoUrl,\n  shortVideoUrl: $json.shortVideoUrl,\n  thumbnailUrl: $json.thumbUrl,\n  youtubeUrl: $json.youtubeUrl,\n  outputs: {\n    duration: $json.final_duration_str,\n    size: $json.final_size,\n    platforms: $json.uploadSummary\n  }\n}) }}",
    "options": { "timeout": 15000 }
  },
  "id": "node-19-callback",
  "name": "Callback: Completed",
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [baseX + 720, baseY],
  "continueOnFail": true
});

// Tambahkan Cleaning
nodes.push({
  "parameters": {
    "command": "=rm -rf {{ $('Normalize Request').first().json.jobDir }} && rm -f /tmp/vidgen_{{ $('Normalize Request').first().json.jobId }}_prompts.json && echo 'CLEANUP_OK'"
  },
  "id": "node-20",
  "name": "Bersihkan File Temp",
  "type": "n8n-nodes-base.executeCommand",
  "typeVersion": 1,
  "position": [baseX + 960, baseY],
  "continueOnFail": true
});

// Modifikasi connections
const oldConnections = data.connections;
const newConnections = { ...oldConnections };

// Hapus connection dari node-lama yang berhubungan dg upload
delete newConnections['Upload ke Platform'];
delete newConnections['Parse Hasil Upload'];
delete newConnections['Callback: Completed'];

// Redirect Salin ke Folder Publik ke Read Binary
newConnections['Salin ke Folder Publik'] = {
  "main": [[
    { "node": "Callback: Video Siap", "type": "main", "index": 0 },
    { "node": "Read Video Binary", "type": "main", "index": 0 }
  ]]
};

// Sambungkan flow baru
newConnections['Read Video Binary'] = {
  "main": [[{ "node": "YouTube Upload", "type": "main", "index": 0 }]]
};

newConnections['YouTube Upload'] = {
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

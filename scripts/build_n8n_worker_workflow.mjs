import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.join(rootDir, 'n8n', 'vidgen-youtube-native-v5-fixed.json');
const targetPath = path.join(rootDir, 'n8n', 'vidgen-youtube-worker-v6.json');

const workflow = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

workflow.name = 'VidGen AI v6 - YouTube Worker API';
workflow.id = 'vidgen-youtube-worker-v6';

const removedNodes = new Set([
  'Generate AI Thumbnail',
  'Cek AI Thumbnail',
  'Write AI Thumbnail',
  'Read Video Binary',
]);

workflow.nodes = workflow.nodes.filter((node) => !removedNodes.has(node.name));

for (const [nodeName, outputs] of Object.entries(workflow.connections)) {
  if (removedNodes.has(nodeName)) {
    delete workflow.connections[nodeName];
    continue;
  }

  for (const outputName of Object.keys(outputs)) {
    outputs[outputName] = outputs[outputName].map((branch) =>
      branch.filter((connection) => !removedNodes.has(connection.node)),
    );
  }
}

const workerUrlExpr =
  "={{ $('Normalize Request').first().json.appBaseUrl.replace(/\\/+$/, '') + '/api/integrations/n8n/worker' }}";
const workerHeadersExpr =
  "={{ JSON.stringify({ \"Content-Type\": \"application/json\", \"x-vidgen-worker-secret\": $('Normalize Request').first().json.callbackSecret }) }}";

const workerNodes = {
  'Buat Folder Job': {
    operation: 'preflight',
    dataExpr: '$json',
    timeout: 120000,
  },
  'TTS: Generate Audio': {
    operation: 'tts',
    dataExpr: "$('Encode Base64').first().json",
    timeout: 900000,
  },
  'Generate Subtitles': {
    operation: 'subtitles',
    dataExpr: "$('Cek TTS').first().json",
    timeout: 120000,
  },
  'Generate Video Clips': {
    operation: 'generate_clips',
    dataExpr: "$('Cek TTS').first().json",
    timeout: 5400000,
  },
  'FFmpeg: Assembly Video': {
    operation: 'assemble_video',
    dataExpr: "$('Cek TTS').first().json",
    timeout: 3600000,
  },
  'Salin ke Folder Publik': {
    operation: 'publish_files',
    dataExpr: "$('Parse Hasil FFmpeg').first().json",
    timeout: 300000,
  },
  'Upload ke Platform': {
    operation: 'upload_youtube',
    dataExpr: "$('Parse Hasil FFmpeg').first().json",
    timeout: 3600000,
  },
  'Bersihkan File Temp': {
    operation: 'cleanup',
    dataExpr: "$('Normalize Request').first().json",
    timeout: 120000,
  },
};

for (const node of workflow.nodes) {
  const workerNode = workerNodes[node.name];
  if (!workerNode) {
    continue;
  }

  node.type = 'n8n-nodes-base.httpRequest';
  node.typeVersion = 4.2;
  node.parameters = {
    method: 'POST',
    url: workerUrlExpr,
    sendHeaders: true,
    specifyHeaders: 'json',
    jsonHeaders: workerHeadersExpr,
    sendBody: true,
    specifyBody: 'json',
    jsonBody: `={{ JSON.stringify({ operation: '${workerNode.operation}', data: ${workerNode.dataExpr} }) }}`,
    options: {
      timeout: workerNode.timeout,
    },
  };
}

const normalizeNode = workflow.nodes.find((node) => node.name === 'Normalize Request');
if (normalizeNode?.parameters?.jsCode) {
  normalizeNode.parameters.jsCode = normalizeNode.parameters.jsCode
    .replace(
      "const jobDir = `/root/.n8n-files/vidgen_${jobId}`;",
      "const jobDir = String(payload.jobDir || metadata.jobDir || `/tmp/vidgen_jobs/vidgen_${jobId}`).trim();",
    )
    .replace(
      "const publicDir = `/var/www/vidgen-tmp/${jobId}`;\nconst publicBaseUrl = `https://automation.maksitech.id/vidgen-tmp/${jobId}`;",
      "const appBaseUrl = String(payload.appBaseUrl || 'https://automation.maksitech.id').trim().replace(/\\/+$/, '');\nconst publicDir = String(payload.publicDir || metadata.publicDir || `/var/www/vidgen-tmp/${jobId}`).trim();\nconst publicBaseUrl = `${appBaseUrl}/vidgen-tmp/${jobId}`;",
    )
    .replace(
      "appBaseUrl: payload.appBaseUrl || 'https://automation.maksitech.id',",
      'appBaseUrl,',
    );
}

const ifSkipWait = workflow.nodes.find((node) => node.name === 'IF Skip Wait');
if (ifSkipWait?.parameters?.conditions?.boolean?.[0]) {
  ifSkipWait.parameters.conditions.boolean[0].value1 =
    "={{ Boolean($('Parse Hasil FFmpeg').first().json.metadata?.forceImmediateUpload) || !$('Parse Hasil FFmpeg').first().json.scheduledUploadAtIso }}";
}

fs.writeFileSync(targetPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Wrote ${path.relative(rootDir, targetPath)}`);

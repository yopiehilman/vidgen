import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const sourcePath = path.join(rootDir, 'n8n', 'vidgen-youtube-native-v5-fixed.json');
const targetPath = path.join(rootDir, 'n8n', 'vidgen-youtube-storyboard-v7.json');

const workflow = JSON.parse(fs.readFileSync(sourcePath, 'utf8'));

workflow.name = 'VidGen AI v7 - Storyboard Worker API';
workflow.id = 'vidgen-youtube-storyboard-v7';

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
      "const clipCount = Math.min(Math.max(toInt(metadata.clipCount, 8), 4), 12);\nconst clipDuration = Math.min(Math.max(toInt(metadata.clipDuration, 6), 4), 10);",
      "const clipCount = Math.min(Math.max(toInt(metadata.clipCount, 12), 4), 80);\nconst clipDuration = Math.min(Math.max(toInt(metadata.clipDuration, 8), 4), 24);\nconst storyboardSource = Array.isArray(metadata.storyboardScenes)\n  ? metadata.storyboardScenes\n  : (Array.isArray(metadata.storyboard) ? metadata.storyboard : []);\nconst storyboardScenes = storyboardSource.map((scene, index) => {\n  if (typeof scene === 'string') {\n    return { scene: index + 1, title: `Scene ${index + 1}`, narration: '', visual_prompt: scene, duration_seconds: clipDuration };\n  }\n  const source = scene && typeof scene === 'object' ? scene : {};\n  return {\n    scene: Number(source.scene || source.scene_number || index + 1) || index + 1,\n    chapter: String(source.chapter || '').trim(),\n    title: String(source.title || source.beat || `Scene ${index + 1}`).trim(),\n    narration: String(source.narration || source.narasi || source.voiceover || '').trim(),\n    visual_prompt: String(source.visual_prompt || source.visualPrompt || source.prompt || '').trim(),\n    duration_seconds: Math.max(toInt(source.duration_seconds || source.duration, clipDuration), 4),\n  };\n}).filter((scene) => scene.narration || scene.visual_prompt);\nconst storyboardNarration = storyboardScenes.map((scene) => scene.narration).filter(Boolean).join('\\n\\n');\nconst storyboardPrompts = storyboardScenes.map((scene) => scene.visual_prompt).filter(Boolean);",
    )
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
    )
    .replace(
      "metadata,\n  platforms,",
      "metadata,\n  storyboardScenes,\n  storyboardNarration,\n  storyboardPrompts,\n  targetDurationSeconds: Number(metadata.targetDurationSeconds || payload.targetDurationSeconds || 0),\n  platforms,",
    );
}

const parseNode = workflow.nodes.find((node) => node.name === 'Parse Response Ollama');
if (parseNode?.parameters?.jsCode) {
  parseNode.parameters.jsCode = parseNode.parameters.jsCode
    .replace(
      "const prev = $('Normalize Request').first().json;",
      "const prev = $('Normalize Request').first().json;\nconst storyboardScenes = Array.isArray(prev.storyboardScenes) ? prev.storyboardScenes : [];\nconst storyboardPrompts = storyboardScenes.map((scene) => String(scene.visual_prompt || scene.visualPrompt || scene.prompt || '').trim()).filter(Boolean);\nconst storyboardNarration = storyboardScenes.map((scene) => String(scene.narration || scene.narasi || scene.voiceover || '').trim()).filter(Boolean).join('\\n\\n');",
    )
    .replace(
      "const sourcePrompts = Array.isArray(parsed.video_prompts)\n  ? parsed.video_prompts.map((item) => sanitizeScenePrompt(pickPromptText(item))).filter(Boolean)\n  : [];",
      "const sourcePrompts = storyboardPrompts.length > 0\n  ? storyboardPrompts.map((item) => sanitizeScenePrompt(item)).filter(Boolean)\n  : (Array.isArray(parsed.video_prompts)\n    ? parsed.video_prompts.map((item) => sanitizeScenePrompt(pickPromptText(item))).filter(Boolean)\n    : []);",
    )
    .replace(
      "const clipCount = Math.max(1, Number(prev.clipCount || 8));",
      "const clipCount = Math.max(1, storyboardPrompts.length || Number(prev.clipCount || 8));",
    )
    .replace(
      "narasi: parsed.narasi || '',",
      "narasi: storyboardNarration || parsed.narasi || '',",
    );
}

const ifSkipWait = workflow.nodes.find((node) => node.name === 'IF Skip Wait');
if (ifSkipWait?.parameters?.conditions?.boolean?.[0]) {
  ifSkipWait.parameters.conditions.boolean[0].value1 =
    "={{ Boolean($('Parse Hasil FFmpeg').first().json.metadata?.forceImmediateUpload) || !$('Parse Hasil FFmpeg').first().json.scheduledUploadAtIso }}";
}

fs.writeFileSync(targetPath, `${JSON.stringify(workflow, null, 2)}\n`);
console.log(`Wrote ${path.relative(rootDir, targetPath)}`);

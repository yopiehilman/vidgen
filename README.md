# Run the app locally

This project now runs as an integrated app:
- React + Vite for the dashboard UI
- Express for internal API routes
- Ollama is called from the server, not directly from the browser

Important:
- `Ollama` in this repo generates text content and prompts, not visual frames.
- `ffmpeg` only assembles/transcodes media; it is not a text-to-image or image-to-video engine.
- For real output video you still need a visual generation engine such as:
  - Replicate via `REPLICATE_API_TOKEN` and optional `REPLICATE_MODEL`,
  - ComfyUI API / Comfy Cloud via `COMFYUI_API_URL` + `COMFYUI_WORKFLOW_FILE`,
  - text/image to video via local endpoint set in `VIDEO_MODEL_URL`, or
  - HuggingFace video inference plus an image model fallback if you explicitly allow it.
- Current scripts now fail fast by default if no visual generation engine is available, to avoid black/blank "successful" videos.
- Replicate billing is estimated in `generate_clips.py` and logged as `REPLICATE_BILLING_SUMMARY`; default `lightricks/ltx-video` is approximately `$0.021/run`, so 8 clips is about `$0.168/video` before exchange-rate or retry variance.

## Run locally

Prerequisites: Node.js

1. Install dependencies:
   `npm install`
2. Copy `.env.example` to `.env.local`
3. Set `OLLAMA_BASE_URL` and `OLLAMA_MODEL` in `.env.local`
4. For the built-in dashboard login, enable PostgreSQL (`VIDGEN_QUEUE_DB=postgres`, `VIDGEN_POSTGRES_URL`) and set `VIDGEN_ADMIN_PASSWORD`
5. Run the app:
   `npm run dev`

Open `http://localhost:3000`.

## Other scripts

- `npm run build` builds the frontend into `dist/`
- `npm run start` starts the integrated server
- `npm run lint` runs TypeScript type-checking

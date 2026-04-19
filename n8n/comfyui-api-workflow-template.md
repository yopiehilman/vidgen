# ComfyUI API Workflow Template

File ini menjelaskan placeholder yang bisa dipakai di `COMFYUI_WORKFLOW_FILE`.

Gunakan workflow ComfyUI yang disimpan dalam **API Format JSON** lalu taruh placeholder berikut pada input node yang ingin diubah saat runtime:

- `{{PROMPT}}`
- `{{NEGATIVE_PROMPT}}`
- `{{SEED}}`
- `{{DURATION}}`
- `{{WIDTH}}`
- `{{HEIGHT}}`
- `{{GEN_WIDTH}}`
- `{{GEN_HEIGHT}}`
- `{{REFERENCE_IMAGE_URL}}`

Contoh ide pemakaian:

- node prompt positif: `"text": "{{PROMPT}}"`
- node negative prompt: `"text": "{{NEGATIVE_PROMPT}}"`
- node seed sampler: `"seed": "{{SEED}}"`
- node durasi video: `"frames": "{{DURATION}}"`
- node resize/output width: `"width": "{{WIDTH}}"`
- node resize/output height: `"height": "{{HEIGHT}}"`
- node latent/model generation width: `"width": "{{GEN_WIDTH}}"`
- node latent/model generation height: `"height": "{{GEN_HEIGHT}}"`
- node load image from URL: `"url": "{{REFERENCE_IMAGE_URL}}"`

Catatan:

- `WIDTH/HEIGHT` adalah ukuran output clip akhir VidGen.
- `GEN_WIDTH/GEN_HEIGHT` adalah ukuran generasi model yang biasanya lebih kecil.
- Jika workflow Anda menghasilkan `video`, script akan mengunduh video itu langsung.
- Jika workflow Anda hanya menghasilkan `image`, script akan mengubah image menjadi clip video dengan `ffmpeg`.
- Untuk Comfy Cloud, gunakan base URL `https://cloud.comfy.org` dan set `COMFYUI_API_KEY`.

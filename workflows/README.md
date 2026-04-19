This folder stores ComfyUI API-format workflow files used by VidGen.

Starter workflow included:

- `comfy_image_api_starter.json`

Before using the starter workflow:

1. Open the JSON and replace `CHANGE_ME_TO_YOUR_AVAILABLE_CHECKPOINT.safetensors`
   with a checkpoint/model name that actually exists in your ComfyUI account.
2. Keep the placeholders used by VidGen, such as `{{PROMPT}}`, `{{NEGATIVE_PROMPT}}`,
   `{{SEED}}`, `{{GEN_WIDTH}}`, and `{{GEN_HEIGHT}}`.
3. Start with image generation first. VidGen will turn the generated image into
   a short clip so the end-to-end pipeline can be tested.

Why image first:

- It is the simplest way to confirm your ComfyUI API key, workflow submission,
  polling, output download, and ffmpeg assembly are all working.
- After that succeeds, we can upgrade this into an image-to-video or text-to-video
  workflow for higher quality motion output.

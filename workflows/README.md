This folder stores ComfyUI API-format workflow files used by VidGen.

Starter workflow included:

- `comfy_image_api_starter.json`
- `comfy_image_api_consistent_character.json`

Before using the starter workflow:

1. Open the JSON and replace `CHANGE_ME_TO_YOUR_AVAILABLE_CHECKPOINT.safetensors`
   with a checkpoint/model name that actually exists in your ComfyUI account.
2. Keep the placeholders used by VidGen, such as `{{PROMPT}}`, `{{NEGATIVE_PROMPT}}`,
   `{{SEED}}`, `{{GEN_WIDTH}}`, and `{{GEN_HEIGHT}}`.
3. Start with image generation first. VidGen will turn the generated image into
   a short clip so the end-to-end pipeline can be tested.

Recommended for character consistency:

- Use `comfy_image_api_consistent_character.json` when you want text-to-image first
  so the same recurring character stays more stable across scenes.
- This workflow stays on standard core nodes only, so it is safer to run on a
  plain ComfyUI install without depending on custom nodes.
- Character consistency in this setup comes mainly from:
  - stable `{{SEED}}`
  - a strong character description inside `{{PROMPT}}`
  - a protective `{{NEGATIVE_PROMPT}}`
- The repo can also pass `{{REFERENCE_IMAGE_URL}}`, but this starter workflow does
  not consume that placeholder because loading images by URL usually requires an
  extra custom node or a different workflow design.

Why image first:

- It is the simplest way to confirm your ComfyUI API key, workflow submission,
  polling, output download, and ffmpeg assembly are all working.
- After that succeeds, we can upgrade this into an image-to-video or text-to-video
  workflow for higher quality motion output.

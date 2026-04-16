#!/usr/bin/env python3
"""
generate_clips.py - VidGen AI Clip Generator
Dipanggil oleh n8n Execute Command node.
Mendukung HuggingFace Inference API (default) dan model lokal via URL kustom.

Penggunaan:
  python3 generate_clips.py \
    --clips-dir /tmp/vidgen_abc/clips \
    --prompts-file /tmp/vidgen_abc_prompts.json \
    --hf-token hf_xxx \
    --clip-duration 8
"""

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request


HF_MODEL_URL = "https://api-inference.huggingface.co/models/Lightricks/LTX-Video"
LOCAL_MODEL_URL = os.environ.get("VIDEO_MODEL_URL", "")
MAX_RETRIES = 3
RETRY_DELAY = 10


def log(msg: str) -> None:
    print(f"[CLIPS] {msg}", flush=True)


def normalize_text(text: str) -> str:
    return " ".join(str(text or "").strip().split())


def build_prompt(scene_prompt: str, character_anchor: str) -> str:
    clean_scene = normalize_text(scene_prompt)
    clean_anchor = normalize_text(character_anchor)
    if not clean_anchor:
        return clean_scene
    return f"{clean_scene}. Character anchor: {clean_anchor}. Keep the same identity and face."


def post_json(url: str, payload: dict, headers: dict, timeout: int = 300) -> bytes:
    req = urllib.request.Request(
        url,
        data=json.dumps(payload).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def generate_clip_huggingface(
    prompt: str,
    clip_duration: int,
    hf_token: str,
    seed: int,
    negative_prompt: str,
    consistency_strength: float,
) -> bytes:
    """Generate video clip via HuggingFace Inference API."""
    base_prompt = f"{normalize_text(prompt)}, smooth motion, high quality, cinematic lighting"

    full_params = {
        "num_frames": max(25, clip_duration * 8),
        "fps": 8,
        "height": 480,
        "width": 256,
        # Optional knobs. If backend rejects these, retry with basic payload.
        "seed": int(seed),
        "guidance_scale": round(4.0 + (float(consistency_strength) * 2.0), 2),
    }

    clean_negative = normalize_text(negative_prompt)
    if clean_negative:
        full_params["negative_prompt"] = clean_negative

    headers = {
        "Authorization": f"Bearer {hf_token}",
        "Content-Type": "application/json",
        "X-Wait-For-Model": "true",
    }

    full_payload = {"inputs": base_prompt, "parameters": full_params}
    basic_payload = {
        "inputs": base_prompt,
        "parameters": {
            "num_frames": max(25, clip_duration * 8),
            "fps": 8,
            "height": 480,
            "width": 256,
        },
    }

    try:
        return post_json(HF_MODEL_URL, full_payload, headers, timeout=300)
    except urllib.error.HTTPError as exc:
        # Some hosted inference backends reject optional params.
        if exc.code in (400, 422):
            log("    -> HF backend menolak parameter lanjutan, retry dengan payload basic")
            return post_json(HF_MODEL_URL, basic_payload, headers, timeout=300)
        raise


def generate_clip_local(
    prompt: str,
    clip_duration: int,
    url: str,
    seed: int,
    negative_prompt: str,
    reference_image_url: str,
    consistency_strength: float,
) -> bytes:
    """Generate video clip via model lokal (ComfyUI, Wan2.1, dll)."""
    payload = json.dumps(
        {
            "prompt": normalize_text(prompt),
            "duration": clip_duration,
            "width": 480,
            "height": 852,
            "seed": int(seed),
            "negative_prompt": normalize_text(negative_prompt),
            "reference_image_url": normalize_text(reference_image_url),
            "consistency_strength": float(consistency_strength),
        }
    ).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST",
    )

    with urllib.request.urlopen(req, timeout=300) as response:
        return response.read()


def generate_clip_fallback(prompt: str, clip_duration: int, clips_dir: str, index: int) -> str:
    """Fallback: buat video hitam dengan teks jika API gagal."""
    output_path = os.path.join(clips_dir, f"clip_{index:03d}.mp4")
    safe_prompt = normalize_text(prompt)[:80].replace("'", "").replace('"', "")
    cmd = (
        f"ffmpeg -y -f lavfi -i color=c=black:s=480x852:r=24 "
        f"-vf \"drawtext=text='{safe_prompt}':fontsize=18:fontcolor=white:x=10:y=10\" "
        f"-t {clip_duration} -c:v libx264 -preset ultrafast '{output_path}' 2>/dev/null"
    )
    os.system(cmd)
    return output_path


def main() -> None:
    parser = argparse.ArgumentParser(description="VidGen Clip Generator")
    parser.add_argument("--clips-dir", required=True)
    parser.add_argument("--prompts-file", required=True)
    parser.add_argument("--hf-token", default="")
    parser.add_argument("--clip-duration", type=int, default=8)
    parser.add_argument("--seed-base", type=int, default=0)
    parser.add_argument("--character-anchor", default="")
    parser.add_argument("--negative-prompt", default="")
    parser.add_argument("--reference-image-url", default="")
    parser.add_argument("--consistency-strength", type=float, default=0.8)
    args = parser.parse_args()

    with open(args.prompts_file, "r", encoding="utf-8") as f:
        prompts = json.load(f)

    if not isinstance(prompts, list) or len(prompts) == 0:
        log("ERROR: daftar prompts kosong atau bukan array")
        sys.exit(1)

    os.makedirs(args.clips_dir, exist_ok=True)
    log(f"Total prompts: {len(prompts)}, clip duration: {args.clip_duration}s")
    log(f"Character anchor: {normalize_text(args.character_anchor)[:120]}")
    log(f"Seed base: {args.seed_base}")

    success_count = 0
    fail_count = 0

    for i, prompt in enumerate(prompts):
        output_path = os.path.join(args.clips_dir, f"clip_{i:03d}.mp4")
        clip_seed = int(args.seed_base) + i
        final_prompt = build_prompt(str(prompt), args.character_anchor)

        if os.path.exists(output_path) and os.path.getsize(output_path) > 10240:
            log(f"  [{i + 1}/{len(prompts)}] Skip (sudah ada): clip_{i:03d}.mp4")
            success_count += 1
            continue

        log(f"  [{i + 1}/{len(prompts)}] Generate (seed {clip_seed}): {final_prompt[:60]}...")

        video_data = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                if LOCAL_MODEL_URL:
                    log(f"    -> Pakai model lokal: {LOCAL_MODEL_URL}")
                    video_data = generate_clip_local(
                        final_prompt,
                        args.clip_duration,
                        LOCAL_MODEL_URL,
                        clip_seed,
                        args.negative_prompt,
                        args.reference_image_url,
                        args.consistency_strength,
                    )
                elif args.hf_token:
                    log(f"    -> Pakai HuggingFace API (attempt {attempt})")
                    video_data = generate_clip_huggingface(
                        final_prompt,
                        args.clip_duration,
                        args.hf_token,
                        clip_seed,
                        args.negative_prompt,
                        args.consistency_strength,
                    )
                else:
                    log("    -> Tidak ada HF token atau model lokal, pakai fallback FFmpeg")
                    generate_clip_fallback(final_prompt, args.clip_duration, args.clips_dir, i)
                    video_data = b"fallback"

                break

            except urllib.error.HTTPError as e:
                log(f"    -> HTTP error {e.code}: {e.reason}")
                if e.code in [503, 500] and attempt < MAX_RETRIES:
                    log(f"    -> Retry dalam {RETRY_DELAY}s...")
                    time.sleep(RETRY_DELAY)
                else:
                    break
            except Exception as e:
                log(f"    -> Error: {e}")
                if attempt < MAX_RETRIES:
                    log(f"    -> Retry dalam {RETRY_DELAY}s...")
                    time.sleep(RETRY_DELAY)
                else:
                    break

        if video_data and video_data != b"fallback":
            with open(output_path, "wb") as f:
                f.write(video_data)
            size_kb = len(video_data) // 1024
            log(f"    -> Disimpan: clip_{i:03d}.mp4 ({size_kb}KB)")
            success_count += 1
        elif video_data == b"fallback":
            success_count += 1
        else:
            log("    -> GAGAL, pakai fallback FFmpeg")
            generate_clip_fallback(final_prompt, args.clip_duration, args.clips_dir, i)
            fail_count += 1

        if args.hf_token and not LOCAL_MODEL_URL:
            time.sleep(2)

    log(f"Selesai: {success_count} berhasil, {fail_count} fallback")
    log(f"CLIPS_SUMMARY: success={success_count} fail={fail_count}")


if __name__ == "__main__":
    main()

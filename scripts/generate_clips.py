#!/usr/bin/env python3
"""
generate_clips.py — VidGen AI Clip Generator
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
import base64
import json
import os
import sys
import time
import urllib.request
import urllib.error


HF_MODEL_URL = "https://api-inference.huggingface.co/models/Lightricks/LTX-Video"
LOCAL_MODEL_URL = os.environ.get("VIDEO_MODEL_URL", "")  # set jika punya model lokal
MAX_RETRIES = 3
RETRY_DELAY = 10  # detik


def log(msg):
    print(f"[CLIPS] {msg}", flush=True)


def generate_clip_huggingface(prompt: str, clip_duration: int, hf_token: str) -> bytes:
    """Generate video clip via HuggingFace Inference API."""
    payload = json.dumps({
        "inputs": f"{prompt}, smooth motion, high quality, 4K",
        "parameters": {
            "num_frames": max(25, clip_duration * 8),
            "fps": 8,
            "height": 480,
            "width": 256,
        }
    }).encode("utf-8")

    req = urllib.request.Request(
        HF_MODEL_URL,
        data=payload,
        headers={
            "Authorization": f"Bearer {hf_token}",
            "Content-Type": "application/json",
            "X-Wait-For-Model": "true",
        },
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=300) as response:
        return response.read()


def generate_clip_local(prompt: str, clip_duration: int, url: str) -> bytes:
    """Generate video clip via model lokal (ComfyUI, Wan2.1, dsb)."""
    payload = json.dumps({
        "prompt": prompt,
        "duration": clip_duration,
        "width": 480,
        "height": 852,
    }).encode("utf-8")

    req = urllib.request.Request(
        url,
        data=payload,
        headers={"Content-Type": "application/json"},
        method="POST"
    )

    with urllib.request.urlopen(req, timeout=300) as response:
        return response.read()


def generate_clip_fallback(prompt: str, clip_duration: int, clips_dir: str, index: int) -> str:
    """
    Fallback: buat video hitam kosong dengan teks menggunakan FFmpeg.
    Dipakai jika HF API gagal dan tidak ada model lokal.
    """
    output_path = os.path.join(clips_dir, f"clip_{index:03d}.mp4")
    safe_prompt = prompt[:80].replace("'", "").replace('"', "")
    cmd = (
        f"ffmpeg -y -f lavfi -i color=c=black:s=480x852:r=24 "
        f"-vf \"drawtext=text='{safe_prompt}':fontsize=18:fontcolor=white:x=10:y=10\" "
        f"-t {clip_duration} -c:v libx264 -preset ultrafast '{output_path}' 2>/dev/null"
    )
    os.system(cmd)
    return output_path


def main():
    parser = argparse.ArgumentParser(description="VidGen Clip Generator")
    parser.add_argument("--clips-dir", required=True)
    parser.add_argument("--prompts-file", required=True)
    parser.add_argument("--hf-token", default="")
    parser.add_argument("--clip-duration", type=int, default=8)
    args = parser.parse_args()

    # Baca daftar prompts
    with open(args.prompts_file, "r", encoding="utf-8") as f:
        prompts = json.load(f)

    if not isinstance(prompts, list) or len(prompts) == 0:
        log("ERROR: daftar prompts kosong atau bukan array")
        sys.exit(1)

    os.makedirs(args.clips_dir, exist_ok=True)
    log(f"Total prompts: {len(prompts)}, clip duration: {args.clip_duration}s")

    success_count = 0
    fail_count = 0

    for i, prompt in enumerate(prompts):
        output_path = os.path.join(args.clips_dir, f"clip_{i:03d}.mp4")

        # Skip jika sudah ada dan ukurannya > 10KB
        if os.path.exists(output_path) and os.path.getsize(output_path) > 10240:
            log(f"  [{i+1}/{len(prompts)}] Skip (sudah ada): clip_{i:03d}.mp4")
            success_count += 1
            continue

        log(f"  [{i+1}/{len(prompts)}] Generate: {prompt[:60]}...")

        video_data = None
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                if LOCAL_MODEL_URL:
                    log(f"    → Pakai model lokal: {LOCAL_MODEL_URL}")
                    video_data = generate_clip_local(prompt, args.clip_duration, LOCAL_MODEL_URL)
                elif args.hf_token:
                    log(f"    → Pakai HuggingFace API (attempt {attempt})")
                    video_data = generate_clip_huggingface(prompt, args.clip_duration, args.hf_token)
                else:
                    log("    → Tidak ada HF token atau model lokal, pakai fallback FFmpeg")
                    generate_clip_fallback(prompt, args.clip_duration, args.clips_dir, i)
                    video_data = b"fallback"

                break  # sukses, keluar retry loop

            except urllib.error.HTTPError as e:
                log(f"    → HTTP error {e.code}: {e.reason}")
                if e.code in [503, 500] and attempt < MAX_RETRIES:
                    log(f"    → Retry dalam {RETRY_DELAY}s...")
                    time.sleep(RETRY_DELAY)
                else:
                    break
            except Exception as e:
                log(f"    → Error: {e}")
                if attempt < MAX_RETRIES:
                    log(f"    → Retry dalam {RETRY_DELAY}s...")
                    time.sleep(RETRY_DELAY)
                else:
                    break

        if video_data and video_data != b"fallback":
            with open(output_path, "wb") as f:
                f.write(video_data)
            size_kb = len(video_data) // 1024
            log(f"    → Disimpan: clip_{i:03d}.mp4 ({size_kb}KB)")
            success_count += 1
        elif video_data == b"fallback":
            success_count += 1
        else:
            log(f"    → GAGAL, pakai fallback FFmpeg")
            generate_clip_fallback(prompt, args.clip_duration, args.clips_dir, i)
            fail_count += 1

        # Jangan terlalu cepat hit API
        if args.hf_token and not LOCAL_MODEL_URL:
            time.sleep(2)

    log(f"Selesai: {success_count} berhasil, {fail_count} fallback")
    log(f"CLIPS_SUMMARY: success={success_count} fail={fail_count}")


if __name__ == "__main__":
    main()

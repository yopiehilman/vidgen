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
import subprocess
import sys
import time
import urllib.parse
import urllib.error
import urllib.request
from pathlib import Path


HF_MODEL_URL = "https://router.huggingface.co/hf-inference/models/Lightricks/LTX-Video"
HF_IMAGE_MODEL_URL = "https://router.huggingface.co/hf-inference/models/black-forest-labs/FLUX.1-schnell"
LOCAL_MODEL_URL = os.environ.get("VIDEO_MODEL_URL", "")
MAX_RETRIES = 3
RETRY_DELAY = 10
OUTPUT_WIDTH = int(os.environ.get("VIDGEN_OUTPUT_WIDTH", "1280"))
OUTPUT_HEIGHT = int(os.environ.get("VIDGEN_OUTPUT_HEIGHT", "720"))
OUTPUT_FPS = int(os.environ.get("VIDGEN_OUTPUT_FPS", "24"))
GEN_WIDTH = int(os.environ.get("VIDGEN_GEN_WIDTH", "768"))
GEN_HEIGHT = int(os.environ.get("VIDGEN_GEN_HEIGHT", "432"))
ALLOW_VISUAL_FALLBACK = os.environ.get("VIDGEN_ALLOW_VISUAL_FALLBACK", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}
COMFYUI_API_URL = os.environ.get("COMFYUI_API_URL", "").strip().rstrip("/")
COMFYUI_API_KEY = os.environ.get("COMFYUI_API_KEY", "").strip()
COMFYUI_WORKFLOW_FILE = os.environ.get("COMFYUI_WORKFLOW_FILE", "").strip()
COMFYUI_POLL_INTERVAL = max(float(os.environ.get("COMFYUI_POLL_INTERVAL", "3")), 1.0)
COMFYUI_TIMEOUT = max(int(os.environ.get("COMFYUI_TIMEOUT", "900")), 60)


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


def get_json(url: str, headers: dict, timeout: int = 300) -> bytes:
    req = urllib.request.Request(url, headers=headers, method="GET")
    with urllib.request.urlopen(req, timeout=timeout) as response:
        return response.read()


def run_cmd(cmd: list[str]) -> subprocess.CompletedProcess:
    try:
        return subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True, check=False)
    except FileNotFoundError as ex:
        return subprocess.CompletedProcess(cmd, 127, stdout=str(ex))


def is_valid_video_file(path: str, min_size_bytes: int = 20 * 1024) -> bool:
    target = Path(path)
    if not target.exists() or target.stat().st_size < min_size_bytes:
        return False

    probe = run_cmd(
        [
            "ffprobe",
            "-v",
            "error",
            "-show_entries",
            "stream=codec_type",
            "-show_entries",
            "format=duration",
            "-of",
            "json",
            str(target),
        ]
    )
    if probe.returncode != 0:
        return False

    try:
        data = json.loads(probe.stdout or "{}")
        streams = data.get("streams", [])
        duration = float(data.get("format", {}).get("duration") or 0.0)
        has_video = any(s.get("codec_type") == "video" for s in streams)
        return has_video and duration > 0
    except Exception:
        return False


def write_image_file(path: str, data: bytes) -> bool:
    if not data or len(data) < 1024:
        return False
    Path(path).parent.mkdir(parents=True, exist_ok=True)
    with open(path, "wb") as f:
        f.write(data)
    return Path(path).exists() and Path(path).stat().st_size > 1024


def create_video_from_image(image_path: str, output_path: str, clip_duration: int) -> bool:
    proc = run_cmd(
        [
            "ffmpeg",
            "-y",
            "-loop",
            "1",
            "-framerate",
            str(OUTPUT_FPS),
            "-i",
            image_path,
            "-t",
            str(clip_duration),
            "-vf",
            (
                f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,"
                f"crop={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},format=yuv420p"
            ),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            output_path,
        ]
    )
    if proc.returncode != 0:
        log(f"    -> Fallback image->video gagal: {(proc.stdout or '').splitlines()[-1:]}")
        return False
    return is_valid_video_file(output_path)


def create_abstract_fallback(output_path: str, clip_duration: int) -> bool:
    proc = run_cmd(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"testsrc2=size={OUTPUT_WIDTH}x{OUTPUT_HEIGHT}:rate={OUTPUT_FPS}",
            "-t",
            str(clip_duration),
            "-vf",
            "eq=saturation=0.9:contrast=1.05,boxblur=2:1,format=yuv420p",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            "-pix_fmt",
            "yuv420p",
            output_path,
        ]
    )
    if proc.returncode != 0:
        log(f"    -> Fallback abstract gagal: {(proc.stdout or '').splitlines()[-1:]}")
        return False
    return is_valid_video_file(output_path)


def fetch_hf_image(prompt: str, hf_token: str) -> bytes:
    if not hf_token:
        return b""
    payload = {"inputs": normalize_text(prompt)[:700]}
    headers = {
        "Authorization": f"Bearer {hf_token}",
        "Content-Type": "application/json",
        "Accept": "image/jpeg",
        "X-Wait-For-Model": "true",
    }
    return post_json(HF_IMAGE_MODEL_URL, payload, headers, timeout=180)


def fetch_stock_image(seed: int) -> bytes:
    # Public random image fallback agar tetap ada visual jika AI model gagal total.
    url = f"https://picsum.photos/seed/vidgen-{seed}/{OUTPUT_WIDTH}/{OUTPUT_HEIGHT}"
    req = urllib.request.Request(url, headers={"User-Agent": "VidGen/1.0"})
    with urllib.request.urlopen(req, timeout=30) as response:
        return response.read()


def save_video_bytes(output_path: str, video_data: bytes) -> bool:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    with open(output_path, "wb") as f:
        f.write(video_data)

    if is_valid_video_file(output_path):
        return True

    try:
        os.remove(output_path)
    except OSError:
        pass
    return False


def comfy_headers() -> dict:
    headers = {"Content-Type": "application/json"}
    if COMFYUI_API_KEY:
        headers["X-API-Key"] = COMFYUI_API_KEY
    return headers


def deep_replace_placeholders(value, replacements: dict[str, object]):
    if isinstance(value, dict):
        return {key: deep_replace_placeholders(item, replacements) for key, item in value.items()}
    if isinstance(value, list):
        return [deep_replace_placeholders(item, replacements) for item in value]
    if isinstance(value, str):
        if value in replacements:
            return replacements[value]
        result = value
        for key, replacement in replacements.items():
            result = result.replace(key, str(replacement))
        return result
    return value


def load_comfy_workflow(
    prompt: str,
    negative_prompt: str,
    seed: int,
    clip_duration: int,
    reference_image_url: str,
) -> dict:
    if not COMFYUI_WORKFLOW_FILE:
        raise RuntimeError("COMFYUI_WORKFLOW_FILE belum di-set.")

    workflow_path = Path(COMFYUI_WORKFLOW_FILE)
    if not workflow_path.is_file():
        raise RuntimeError(f"Workflow file ComfyUI tidak ditemukan: {workflow_path}")

    with open(workflow_path, "r", encoding="utf-8-sig") as f:
        workflow = json.load(f)

    replacements = {
        "{{PROMPT}}": normalize_text(prompt),
        "{{NEGATIVE_PROMPT}}": normalize_text(negative_prompt),
        "{{SEED}}": int(seed),
        "{{DURATION}}": int(clip_duration),
        "{{WIDTH}}": int(OUTPUT_WIDTH),
        "{{HEIGHT}}": int(OUTPUT_HEIGHT),
        "{{GEN_WIDTH}}": int(GEN_WIDTH),
        "{{GEN_HEIGHT}}": int(GEN_HEIGHT),
        "{{REFERENCE_IMAGE_URL}}": normalize_text(reference_image_url),
    }
    return deep_replace_placeholders(workflow, replacements)


def comfy_api_candidates(base_url: str, suffix: str) -> list[str]:
    clean_suffix = suffix if suffix.startswith("/") else f"/{suffix}"
    candidates = []
    if base_url.endswith("/api"):
        candidates.append(f"{base_url}{clean_suffix}")
    else:
        candidates.append(f"{base_url}/api{clean_suffix}")
        candidates.append(f"{base_url}{clean_suffix}")
    seen = set()
    ordered = []
    for item in candidates:
        if item not in seen:
            seen.add(item)
            ordered.append(item)
    return ordered


def comfy_request_json(method: str, suffix: str, payload: dict | None = None, timeout: int = 300) -> dict:
    headers = comfy_headers()
    last_error = None
    for url in comfy_api_candidates(COMFYUI_API_URL, suffix):
        try:
            if method == "POST":
                raw = post_json(url, payload or {}, headers, timeout=timeout)
            else:
                raw = get_json(url, headers, timeout=timeout)
            return json.loads(raw.decode("utf-8") or "{}")
        except urllib.error.HTTPError as exc:
            last_error = exc
            if exc.code == 404:
                continue
            try:
                body = exc.read().decode("utf-8", errors="ignore")
            except Exception:
                body = exc.reason
            raise RuntimeError(f"ComfyUI API error {exc.code}: {body[:300]}")
        except urllib.error.URLError as exc:
            last_error = exc
    raise RuntimeError(f"Gagal mengakses ComfyUI API pada {COMFYUI_API_URL}: {last_error}")


def comfy_wait_for_completion(prompt_id: str) -> dict:
    start = time.time()
    while time.time() - start < COMFYUI_TIMEOUT:
        try:
            status_data = comfy_request_json("GET", f"/job/{prompt_id}/status", timeout=60)
            status = str(status_data.get("status") or "").strip().lower()
            if status == "completed":
                return comfy_request_json("GET", f"/history_v2/{prompt_id}", timeout=120)
            if status in {"failed", "cancelled"}:
                raise RuntimeError(f"Job ComfyUI {prompt_id} berakhir dengan status {status}.")
        except RuntimeError as exc:
            # Local/self-hosted compatibility path: some setups expose history but not job status.
            if "404" not in str(exc):
                history = {}
                try:
                    history = comfy_request_json("GET", f"/history_v2/{prompt_id}", timeout=120)
                except Exception:
                    history = {}
                if history:
                    return history
        time.sleep(COMFYUI_POLL_INTERVAL)
    raise RuntimeError(f"Timeout menunggu job ComfyUI {prompt_id} setelah {COMFYUI_TIMEOUT} detik.")


def iter_output_assets(history: dict):
    outputs = history.get("outputs") if isinstance(history, dict) else None
    if outputs is None and isinstance(history, dict) and len(history) == 1:
        outputs = next(iter(history.values()), {}).get("outputs")
    if not isinstance(outputs, dict):
        return []

    assets = []
    for node_outputs in outputs.values():
        if not isinstance(node_outputs, dict):
            continue
        for key in ("videos", "video", "images", "gifs"):
            value = node_outputs.get(key)
            if isinstance(value, list):
                assets.extend(value)
    return assets


def comfy_download_asset(file_info: dict) -> bytes:
    params = urllib.parse.urlencode(
        {
            "filename": str(file_info.get("filename") or ""),
            "subfolder": str(file_info.get("subfolder") or ""),
            "type": str(file_info.get("type") or "output"),
        }
    )
    headers = {}
    if COMFYUI_API_KEY:
        headers["X-API-Key"] = COMFYUI_API_KEY

    last_error = None
    for url in comfy_api_candidates(COMFYUI_API_URL, f"/view?{params}"):
        try:
            req = urllib.request.Request(url, headers=headers, method="GET")
            with urllib.request.urlopen(req, timeout=300) as response:
                return response.read()
        except Exception as exc:
            last_error = exc
    raise RuntimeError(f"Gagal download output ComfyUI: {last_error}")


def generate_clip_comfyui(
    prompt: str,
    clip_duration: int,
    output_path: str,
    seed: int,
    negative_prompt: str,
    reference_image_url: str,
) -> bool:
    workflow = load_comfy_workflow(prompt, negative_prompt, seed, clip_duration, reference_image_url)
    submit_result = comfy_request_json("POST", "/prompt", {"prompt": workflow}, timeout=120)
    prompt_id = str(submit_result.get("prompt_id") or "").strip()
    if not prompt_id:
        raise RuntimeError(f"Respons submit ComfyUI tidak mengandung prompt_id: {submit_result}")

    log(f"    -> ComfyUI job submitted: {prompt_id}")
    history = comfy_wait_for_completion(prompt_id)
    assets = iter_output_assets(history)
    if not assets:
        raise RuntimeError(f"Job ComfyUI {prompt_id} selesai tapi tidak ada output asset.")

    preferred_video = next(
        (asset for asset in assets if str(asset.get("filename") or "").lower().endswith((".mp4", ".webm", ".mov"))),
        None,
    )
    chosen_asset = preferred_video or assets[0]
    asset_bytes = comfy_download_asset(chosen_asset)
    filename = str(chosen_asset.get("filename") or "").lower()

    if filename.endswith((".mp4", ".webm", ".mov")):
        return save_video_bytes(output_path, asset_bytes)

    image_path = os.path.join(os.path.dirname(output_path), f"{Path(output_path).stem}_comfy.png")
    if not write_image_file(image_path, asset_bytes):
        raise RuntimeError("Output ComfyUI bukan video valid dan gagal disimpan sebagai image.")
    return create_video_from_image(image_path, output_path, clip_duration)


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
        "height": GEN_HEIGHT,
        "width": GEN_WIDTH,
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
            "height": GEN_HEIGHT,
            "width": GEN_WIDTH,
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
            "width": OUTPUT_WIDTH,
            "height": OUTPUT_HEIGHT,
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


def generate_clip_fallback(
    prompt: str,
    clip_duration: int,
    clips_dir: str,
    index: int,
    seed: int,
    hf_token: str,
) -> bool:
    """Fallback: buat klip visual TANPA text overlay saat model video gagal."""
    output_path = os.path.join(clips_dir, f"clip_{index:03d}.mp4")
    img_path = os.path.join(clips_dir, f"fallback_{index:03d}.jpg")

    image_data = b""
    if hf_token:
        try:
            image_data = fetch_hf_image(prompt, hf_token)
            if image_data:
                log("    -> Fallback gambar dari HuggingFace image model")
        except Exception as e:
            log(f"    -> HF image fallback gagal: {e}")

    if not image_data:
        try:
            image_data = fetch_stock_image(seed)
            if image_data:
                log("    -> Fallback gambar stok (picsum)")
        except Exception as e:
            log(f"    -> Stock image fallback gagal: {e}")

    if image_data and write_image_file(img_path, image_data):
        if create_video_from_image(img_path, output_path, clip_duration):
            return True

    log("    -> Pakai fallback visual abstract (tanpa teks)")
    return create_abstract_fallback(output_path, clip_duration)


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

    with open(args.prompts_file, "r", encoding="utf-8-sig") as f:
        prompts = json.load(f)

    if not isinstance(prompts, list) or len(prompts) == 0:
        log("ERROR: daftar prompts kosong atau bukan array")
        sys.exit(1)

    os.makedirs(args.clips_dir, exist_ok=True)
    log(f"Total prompts: {len(prompts)}, clip duration: {args.clip_duration}s")
    log(f"Character anchor: {normalize_text(args.character_anchor)[:120]}")
    log(f"Seed base: {args.seed_base}")
    log(f"Visual fallback allowed: {ALLOW_VISUAL_FALLBACK}")
    log(f"ComfyUI API configured: {bool(COMFYUI_API_URL)}")

    if not COMFYUI_API_URL and not LOCAL_MODEL_URL and not args.hf_token:
        log("ERROR: Tidak ada video generation engine yang aktif.")
        log("ERROR: Set COMFYUI_API_URL untuk ComfyUI API, VIDEO_MODEL_URL untuk engine lokal, atau isi --hf-token untuk HuggingFace.")
        log("ERROR: ffmpeg tidak bisa membuat video generatif dari prompt tanpa model visual.")
        sys.exit(1)

    success_count = 0
    fail_count = 0
    strict_failure = False

    for i, prompt in enumerate(prompts):
        output_path = os.path.join(args.clips_dir, f"clip_{i:03d}.mp4")
        clip_seed = int(args.seed_base) + i
        final_prompt = build_prompt(str(prompt), args.character_anchor)

        if is_valid_video_file(output_path):
            log(f"  [{i + 1}/{len(prompts)}] Skip (sudah ada): clip_{i:03d}.mp4")
            success_count += 1
            continue

        log(f"  [{i + 1}/{len(prompts)}] Generate (seed {clip_seed}): {final_prompt[:60]}...")

        video_data = None
        saved_ok = False
        for attempt in range(1, MAX_RETRIES + 1):
            try:
                if COMFYUI_API_URL:
                    log(f"    -> Pakai ComfyUI API: {COMFYUI_API_URL}")
                    saved_ok = generate_clip_comfyui(
                        final_prompt,
                        args.clip_duration,
                        output_path,
                        clip_seed,
                        args.negative_prompt,
                        args.reference_image_url,
                    )
                elif LOCAL_MODEL_URL:
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
                    log("    -> Tidak ada HF token atau model lokal")
                    strict_failure = True
                    break

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

        if video_data:
            saved_ok = save_video_bytes(output_path, video_data)
            if saved_ok:
                size_kb = os.path.getsize(output_path) // 1024
                log(f"    -> Disimpan: clip_{i:03d}.mp4 ({size_kb}KB)")
            else:
                log("    -> Output model tidak valid sebagai video")

        if saved_ok:
            success_count += 1
        else:
            fail_count += 1
            if not ALLOW_VISUAL_FALLBACK:
                log("    -> GAGAL keras. Fallback visual dinonaktifkan agar job tidak tampak sukses palsu.")
                strict_failure = True
                continue

            log("    -> GAGAL, pakai fallback visual karena VIDGEN_ALLOW_VISUAL_FALLBACK aktif")
            fallback_ok = generate_clip_fallback(
                final_prompt,
                args.clip_duration,
                args.clips_dir,
                i,
                clip_seed,
                args.hf_token,
            )
            if fallback_ok:
                success_count += 1
            else:
                strict_failure = True

        if args.hf_token and not LOCAL_MODEL_URL and not COMFYUI_API_URL:
            time.sleep(2)

    valid_clips = []
    for i in range(len(prompts)):
        clip_path = os.path.join(args.clips_dir, f"clip_{i:03d}.mp4")
        if is_valid_video_file(clip_path):
            valid_clips.append(clip_path)

    log(f"Selesai: {success_count} berhasil, {fail_count} fallback")
    log(f"Valid clips: {len(valid_clips)}/{len(prompts)}")
    log(f"CLIPS_SUMMARY: success={success_count} fail={fail_count}")

    if strict_failure:
        log("ERROR: Generasi klip tidak sepenuhnya berhasil dan strict mode aktif.")
        sys.exit(1)

    if not valid_clips:
        log("ERROR: Tidak ada clip valid yang berhasil dibuat.")
        sys.exit(1)


if __name__ == "__main__":
    main()

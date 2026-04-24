#!/usr/bin/env python3
"""
upload_platforms.py — VidGen AI Platform Uploader
Dipanggil oleh n8n Execute Command node.

Mendukung: YouTube, TikTok, Facebook

Environment variables yang wajib di-set di n8n:
  YOUTUBE_CLIENT_ID
  YOUTUBE_CLIENT_SECRET
  YOUTUBE_REFRESH_TOKEN
  TIKTOK_ACCESS_TOKEN
  FB_PAGE_ID
  FB_PAGE_ACCESS_TOKEN

Penggunaan:
  python3 upload_platforms.py \
    --platforms youtube,tiktok,facebook \
    --final-video /tmp/vidgen_abc/final.mp4 \
    --short-video /tmp/vidgen_abc/short.mp4 \
    --thumb /tmp/vidgen_abc/thumb.jpg \
    --title-yt "Judul YouTube" \
    --desc-yt "Deskripsi YouTube" \
    --title-tiktok "Judul TikTok 🔥" \
    --caption-fb "Caption Facebook" \
    --yt-category "27" \
    --public-short-url "https://automation.maksitech.id/vidgen-tmp/abc/short.mp4" \
    --tags "tag1,tag2,tag3"
"""

import argparse
import json
import os
import sys
import time
from pathlib import Path
import urllib.request
import urllib.parse
import urllib.error


def log(msg):
    print(f"[UPLOAD] {msg}", flush=True)


def read_http_error_body(error: urllib.error.HTTPError) -> str:
    try:
        return error.read().decode("utf-8", errors="ignore")
    except Exception:
        return ""


def classify_youtube_auth_error(status_code: int, error_body: str) -> dict:
    body_l = (error_body or "").lower()
    if "invalid_grant" in body_l:
        return {
            "needs_reauth": True,
            "auth_error_code": "invalid_grant",
            "auth_error_hint": "Refresh token YouTube sudah tidak valid dan perlu OAuth ulang.",
        }
    if "invalid_client" in body_l:
        return {
            "needs_reauth": True,
            "auth_error_code": "invalid_client",
            "auth_error_hint": "OAuth client YouTube tidak valid atau sudah berubah.",
        }
    if status_code in (400, 401):
        return {
            "needs_reauth": False,
            "auth_error_code": "unauthorized",
            "auth_error_hint": "Access token ditolak atau kedaluwarsa. Sistem bisa mencoba refresh ulang otomatis.",
        }
    return {
        "needs_reauth": False,
        "auth_error_code": "",
        "auth_error_hint": "",
    }


def load_dotenv_file(dotenv_path: Path) -> None:
    if not dotenv_path.is_file():
        return

    try:
        for raw_line in dotenv_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue

            key, value = line.split("=", 1)
            key = key.strip()
            value = value.strip()
            if not key or key in os.environ:
                continue

            if value and len(value) >= 2 and value[0] == value[-1] and value[0] in ("'", '"'):
                value = value[1:-1]

            os.environ[key] = value.replace("\\n", "\n")
    except Exception as exc:
        log(f"WARN: gagal membaca dotenv {dotenv_path}: {exc}")


def bootstrap_env() -> None:
    base_dir = Path(__file__).resolve().parent
    candidate_paths = [
        Path.cwd() / ".env",
        Path.cwd() / ".env.local",
        base_dir.parent / ".env",
        base_dir.parent / ".env.local",
        Path("/var/www/vidgen/.env"),
        Path("/var/www/vidgen/.env.local"),
        Path("/opt/vidgen/.env"),
        Path("/opt/vidgen/.env.local"),
        Path("/workspace/vidgen/.env"),
        Path("/workspace/vidgen/.env.local"),
        Path("/root/.n8n/.env"),
        Path("/root/.n8n/.env.local"),
    ]

    seen = set()
    for candidate in candidate_paths:
        candidate_str = str(candidate)
        if candidate_str in seen:
            continue
        seen.add(candidate_str)
        load_dotenv_file(candidate)


bootstrap_env()


# ─── YouTube ──────────────────────────────────────────────────────────────────

def get_youtube_access_token(client_id: str, client_secret: str, refresh_token: str) -> dict:
    """Refresh YouTube OAuth2 access token."""
    data = urllib.parse.urlencode({
        "client_id": client_id,
        "client_secret": client_secret,
        "refresh_token": refresh_token,
        "grant_type": "refresh_token",
    }).encode()

    req = urllib.request.Request(
        "https://oauth2.googleapis.com/token",
        data=data,
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        method="POST"
    )

    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            result = json.loads(resp.read())
            return {
                "ok": True,
                "access_token": result.get("access_token", ""),
                "expires_in": result.get("expires_in"),
                "scope": result.get("scope", ""),
                "token_type": result.get("token_type", ""),
            }
    except urllib.error.HTTPError as e:
        error_body = read_http_error_body(e)
        auth_state = classify_youtube_auth_error(e.code, error_body)
        return {
            "ok": False,
            "access_token": "",
            "error": f"HTTP {e.code}: {error_body[:400]}",
            **auth_state,
        }
    except Exception as e:
        return {
            "ok": False,
            "access_token": "",
            "error": str(e),
            "needs_reauth": False,
            "auth_error_code": "",
            "auth_error_hint": "",
        }


def youtube_request_json(url: str, access_token: str, data=None, headers=None, method="POST", timeout=30):
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {access_token}",
            **(headers or {}),
        },
        method=method,
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        body = resp.read()
        return json.loads(body) if body else {}


def youtube_request_raw(url: str, access_token: str, data=None, headers=None, method="POST", timeout=30):
    req = urllib.request.Request(
        url,
        data=data,
        headers={
            "Authorization": f"Bearer {access_token}",
            **(headers or {}),
        },
        method=method,
    )
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return {
            "body": resp.read(),
            "headers": dict(resp.headers.items()),
        }


def upload_youtube(video_path: str, thumb_path: str, title: str, description: str,
                   category_id: str, tags: list) -> dict:
    """Upload video ke YouTube via resumable upload."""
    client_id = os.environ.get("YOUTUBE_CLIENT_ID", "").strip()
    client_secret = os.environ.get("YOUTUBE_CLIENT_SECRET", "").strip()
    refresh_token = os.environ.get("YOUTUBE_REFRESH_TOKEN", "").strip()
    privacy_status = os.environ.get("YOUTUBE_PRIVACY_STATUS", "public").strip() or "public"

    if not all([client_id, client_secret, refresh_token]):
        return {
            "ok": False,
            "error": "YOUTUBE_CLIENT_ID, YOUTUBE_CLIENT_SECRET, atau YOUTUBE_REFRESH_TOKEN belum terbaca dari environment/.env",
            "needs_reauth": False,
            "auth_error_code": "missing_credentials",
        }

    try:
        log("YouTube: Mendapatkan access token...")
        token_result = get_youtube_access_token(client_id, client_secret, refresh_token)
        if not token_result.get("ok"):
            return {
                "ok": False,
                "error": token_result.get("error") or "Gagal refresh access token YouTube",
                "needs_reauth": bool(token_result.get("needs_reauth")),
                "auth_error_code": token_result.get("auth_error_code", ""),
                "auth_error_hint": token_result.get("auth_error_hint", ""),
                "auth_stage": "token_refresh",
            }
        access_token = token_result.get("access_token", "")
        if not access_token:
            return {
                "ok": False,
                "error": "Google tidak mengembalikan access token.",
                "needs_reauth": False,
                "auth_error_code": "missing_access_token",
                "auth_stage": "token_refresh",
            }

        # Step 1: Init resumable upload
        metadata = {
            "snippet": {
                "title": title[:100],
                "description": description[:5000],
                "tags": tags[:30],
                "categoryId": category_id,
                "defaultLanguage": "id",
            },
            "status": {
                "privacyStatus": privacy_status,
                "selfDeclaredMadeForKids": False,
            }
        }

        file_size = os.path.getsize(video_path)
        meta_bytes = json.dumps(metadata).encode("utf-8")

        def start_resumable_upload(current_access_token: str) -> str:
            response = youtube_request_raw(
                "https://www.googleapis.com/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status",
                current_access_token,
                data=meta_bytes,
                headers={
                    "Content-Type": "application/json; charset=UTF-8",
                    "X-Upload-Content-Length": str(file_size),
                    "X-Upload-Content-Type": "video/mp4",
                },
                method="POST",
                timeout=30,
            )
            return response["headers"].get("Location") or response["headers"].get("location") or ""

        try:
            upload_url = start_resumable_upload(access_token)
        except urllib.error.HTTPError as e:
            error_body = read_http_error_body(e)
            auth_state = classify_youtube_auth_error(e.code, error_body)
            if e.code == 401 and not auth_state.get("needs_reauth"):
                log("YouTube: Access token ditolak saat init upload, mencoba refresh ulang sekali...")
                retry_token_result = get_youtube_access_token(client_id, client_secret, refresh_token)
                if retry_token_result.get("ok") and retry_token_result.get("access_token"):
                    access_token = retry_token_result["access_token"]
                    upload_url = start_resumable_upload(access_token)
                else:
                    return {
                        "ok": False,
                        "error": retry_token_result.get("error") or f"HTTP {e.code}: {error_body[:400]}",
                        "needs_reauth": bool(retry_token_result.get("needs_reauth")),
                        "auth_error_code": retry_token_result.get("auth_error_code", auth_state.get("auth_error_code", "")),
                        "auth_error_hint": retry_token_result.get("auth_error_hint", auth_state.get("auth_error_hint", "")),
                        "auth_stage": "resumable_init",
                    }
            else:
                return {
                    "ok": False,
                    "error": f"HTTP {e.code}: {error_body[:400]}",
                    "needs_reauth": bool(auth_state.get("needs_reauth")),
                    "auth_error_code": auth_state.get("auth_error_code", ""),
                    "auth_error_hint": auth_state.get("auth_error_hint", ""),
                    "auth_stage": "resumable_init",
                }

        if not upload_url:
            return {
                "ok": False,
                "error": "Gagal mendapatkan upload URL dari YouTube",
                "needs_reauth": False,
                "auth_error_code": "missing_upload_url",
                "auth_stage": "resumable_init",
            }

        log(f"YouTube: Upload URL didapat, mengunggah file {file_size // 1024 // 1024}MB...")

        # Step 2: Upload file
        with open(video_path, "rb") as f:
            video_data = f.read()

        def upload_video_bytes(current_access_token: str) -> dict:
            return youtube_request_json(
                upload_url,
                current_access_token,
                data=video_data,
                headers={
                    "Content-Type": "video/mp4",
                    "Content-Length": str(file_size),
                },
                method="PUT",
                timeout=600,
            )

        try:
            result = upload_video_bytes(access_token)
        except urllib.error.HTTPError as e:
            error_body = read_http_error_body(e)
            auth_state = classify_youtube_auth_error(e.code, error_body)
            if e.code == 401 and not auth_state.get("needs_reauth"):
                log("YouTube: Access token ditolak saat upload video, mencoba refresh ulang sekali...")
                retry_token_result = get_youtube_access_token(client_id, client_secret, refresh_token)
                if retry_token_result.get("ok") and retry_token_result.get("access_token"):
                    access_token = retry_token_result["access_token"]
                    result = upload_video_bytes(access_token)
                else:
                    return {
                        "ok": False,
                        "error": retry_token_result.get("error") or f"HTTP {e.code}: {error_body[:400]}",
                        "needs_reauth": bool(retry_token_result.get("needs_reauth")),
                        "auth_error_code": retry_token_result.get("auth_error_code", auth_state.get("auth_error_code", "")),
                        "auth_error_hint": retry_token_result.get("auth_error_hint", auth_state.get("auth_error_hint", "")),
                        "auth_stage": "video_upload",
                    }
            else:
                return {
                    "ok": False,
                    "error": f"HTTP {e.code}: {error_body[:400]}",
                    "needs_reauth": bool(auth_state.get("needs_reauth")),
                    "auth_error_code": auth_state.get("auth_error_code", ""),
                    "auth_error_hint": auth_state.get("auth_error_hint", ""),
                    "auth_stage": "video_upload",
                }

        video_id = result.get("id", "")
        youtube_url = f"https://youtube.com/watch?v={video_id}"
        log(f"YouTube: Upload berhasil! {youtube_url}")

        # Step 3: Upload thumbnail (opsional)
        if thumb_path and os.path.exists(thumb_path) and video_id:
            try:
                with open(thumb_path, "rb") as f:
                    thumb_data = f.read()
                thumb_req = urllib.request.Request(
                    f"https://www.googleapis.com/upload/youtube/v3/thumbnails/set?videoId={video_id}",
                    data=thumb_data,
                    headers={
                        "Authorization": f"Bearer {access_token}",
                        "Content-Type": "image/jpeg",
                    },
                    method="POST"
                )
                urllib.request.urlopen(thumb_req, timeout=60)
                log("YouTube: Thumbnail berhasil diupload")
            except Exception as e:
                log(f"YouTube: Thumbnail gagal (non-fatal): {e}")

        return {
            "ok": True,
            "video_id": video_id,
            "url": youtube_url,
            "auth_refreshed": True,
            "auth_error_code": "",
        }

    except urllib.error.HTTPError as e:
        error_body = read_http_error_body(e)
        auth_state = classify_youtube_auth_error(e.code, error_body)
        log(f"YouTube HTTP ERROR {e.code}: {error_body}")
        return {
            "ok": False,
            "error": f"HTTP {e.code}: {error_body[:400]}",
            "needs_reauth": bool(auth_state.get("needs_reauth")),
            "auth_error_code": auth_state.get("auth_error_code", ""),
            "auth_error_hint": auth_state.get("auth_error_hint", ""),
        }
    except Exception as e:
        log(f"YouTube ERROR: {e}")
        return {
            "ok": False,
            "error": str(e),
            "needs_reauth": False,
            "auth_error_code": "",
        }


# ─── TikTok ───────────────────────────────────────────────────────────────────

def upload_tiktok(video_path: str, title: str) -> dict:
    """Upload video ke TikTok via Direct Post API."""
    access_token = os.environ.get("TIKTOK_ACCESS_TOKEN", "")

    if not access_token:
        return {"ok": False, "error": "TIKTOK_ACCESS_TOKEN belum di-set"}

    try:
        file_size = os.path.getsize(video_path)
        chunk_size = 10 * 1024 * 1024  # 10MB
        total_chunks = max(1, (file_size + chunk_size - 1) // chunk_size)

        log(f"TikTok: Init upload ({file_size // 1024 // 1024}MB, {total_chunks} chunks)...")

        # Step 1: Init
        init_payload = json.dumps({
            "post_info": {
                "title": title[:150],
                "privacy_level": "PUBLIC_TO_EVERYONE",
                "disable_duet": False,
                "disable_comment": False,
                "disable_stitch": False,
                "video_cover_timestamp_ms": 1000,
            },
            "source_info": {
                "source": "FILE_UPLOAD",
                "video_size": file_size,
                "chunk_size": chunk_size,
                "total_chunk_count": total_chunks,
            }
        }).encode("utf-8")

        init_req = urllib.request.Request(
            "https://open.tiktokapis.com/v2/post/publish/video/init/",
            data=init_payload,
            headers={
                "Authorization": f"Bearer {access_token}",
                "Content-Type": "application/json; charset=UTF-8",
            },
            method="POST"
        )

        with urllib.request.urlopen(init_req, timeout=30) as resp:
            init_result = json.loads(resp.read())

        publish_id = init_result.get("data", {}).get("publish_id", "")
        upload_url = init_result.get("data", {}).get("upload_url", "")

        if not publish_id or not upload_url:
            return {"ok": False, "error": f"TikTok init gagal: {init_result}"}

        log(f"TikTok: publish_id={publish_id}, mulai upload chunks...")

        # Step 2: Upload chunks
        with open(video_path, "rb") as f:
            for chunk_num in range(total_chunks):
                chunk_data = f.read(chunk_size)
                start_byte = chunk_num * chunk_size
                end_byte = start_byte + len(chunk_data) - 1

                chunk_req = urllib.request.Request(
                    upload_url,
                    data=chunk_data,
                    headers={
                        "Content-Range": f"bytes {start_byte}-{end_byte}/{file_size}",
                        "Content-Length": str(len(chunk_data)),
                        "Content-Type": "video/mp4",
                    },
                    method="PUT"
                )
                urllib.request.urlopen(chunk_req, timeout=120)
                log(f"TikTok: Chunk {chunk_num+1}/{total_chunks} uploaded")

        log(f"TikTok: Upload berhasil! publish_id={publish_id}")
        return {"ok": True, "video_id": publish_id}

    except Exception as e:
        log(f"TikTok ERROR: {e}")
        return {"ok": False, "error": str(e)}


# ─── Facebook ─────────────────────────────────────────────────────────────────

def upload_facebook(public_video_url: str, description: str) -> dict:
    """Upload video ke Facebook Page via Graph API (pakai URL publik)."""
    page_id = os.environ.get("FB_PAGE_ID", "")
    access_token = os.environ.get("FB_PAGE_ACCESS_TOKEN", "")

    if not all([page_id, access_token]):
        return {"ok": False, "error": "FB_PAGE_ID atau FB_PAGE_ACCESS_TOKEN belum di-set"}

    if not public_video_url:
        return {"ok": False, "error": "public_video_url belum tersedia"}

    try:
        log(f"Facebook: Upload via URL publik...")

        payload = urllib.parse.urlencode({
            "access_token": access_token,
            "file_url": public_video_url,
            "description": description[:5000],
        }).encode("utf-8")

        req = urllib.request.Request(
            f"https://graph.facebook.com/v18.0/{page_id}/videos",
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            method="POST"
        )

        with urllib.request.urlopen(req, timeout=300) as resp:
            result = json.loads(resp.read())

        post_id = result.get("id", "")
        log(f"Facebook: Upload berhasil! post_id={post_id}")
        return {"ok": True, "post_id": post_id}

    except urllib.error.HTTPError as e:
        error_body = e.read().decode("utf-8", errors="ignore")
        log(f"Facebook HTTP ERROR {e.code}: {error_body}")
        return {"ok": False, "error": f"HTTP {e.code}: {error_body[:200]}"}
    except Exception as e:
        log(f"Facebook ERROR: {e}")
        return {"ok": False, "error": str(e)}


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(description="VidGen Platform Uploader")
    parser.add_argument("--platforms", required=True, help="Comma-separated: youtube,tiktok,facebook")
    parser.add_argument("--final-video", required=True)
    parser.add_argument("--short-video", required=True)
    parser.add_argument("--thumb", default="")
    parser.add_argument("--title-yt", default="Video")
    parser.add_argument("--desc-yt", default="")
    parser.add_argument("--title-tiktok", default="Video")
    parser.add_argument("--caption-fb", default="")
    parser.add_argument("--yt-category", default="27")
    parser.add_argument("--public-short-url", default="")
    parser.add_argument("--tags", default="")
    args = parser.parse_args()

    platforms = [p.strip().lower() for p in args.platforms.split(",") if p.strip()]
    tags = [t.strip() for t in args.tags.split(",") if t.strip()]

    log(f"Platform yang akan diupload: {platforms}")
    results = {}

    # YouTube
    if "youtube" in platforms:
        log("─── YouTube Upload ───")
        if not os.path.exists(args.final_video):
            results["youtube"] = {"ok": False, "error": f"File tidak ditemukan: {args.final_video}"}
        else:
            results["youtube"] = upload_youtube(
                args.final_video, args.thumb,
                args.title_yt, args.desc_yt,
                args.yt_category, tags
            )

    # TikTok
    if "tiktok" in platforms:
        log("─── TikTok Upload ───")
        video_to_use = args.short_video if os.path.exists(args.short_video) else args.final_video
        if not os.path.exists(video_to_use):
            results["tiktok"] = {"ok": False, "error": f"File tidak ditemukan: {video_to_use}"}
        else:
            results["tiktok"] = upload_tiktok(video_to_use, args.title_tiktok)

    # Facebook
    if "facebook" in platforms:
        log("─── Facebook Upload ───")
        # Facebook butuh URL publik
        results["facebook"] = upload_facebook(args.public_short_url, args.caption_fb)

    # Print hasil untuk dibaca n8n
    print(f"UPLOAD_RESULTS:{json.dumps(results)}")

    # Summary
    for platform, result in results.items():
        status = "✅" if result.get("ok") else "❌"
        log(f"{status} {platform.upper()}: {result}")


if __name__ == "__main__":
    main()

#!/usr/bin/env python3
import argparse
import glob
import os
import shlex
import subprocess
import sys
from pathlib import Path

OUTPUT_WIDTH = int(os.environ.get("VIDGEN_OUTPUT_WIDTH", "1280"))
OUTPUT_HEIGHT = int(os.environ.get("VIDGEN_OUTPUT_HEIGHT", "720"))
OUTPUT_FPS = int(os.environ.get("VIDGEN_OUTPUT_FPS", "24"))
ALLOW_BLACK_VIDEO_FALLBACK = os.environ.get("VIDGEN_ALLOW_BLACK_VIDEO_FALLBACK", "").strip().lower() in {
    "1",
    "true",
    "yes",
    "on",
}


def eprint(msg: str) -> None:
    print(msg, flush=True)


def run(cmd: list[str], check: bool = True, capture: bool = False) -> subprocess.CompletedProcess:
    eprint(f"[CMD] {' '.join(shlex.quote(c) for c in cmd)}")
    if capture:
        proc = subprocess.run(cmd, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        if proc.stdout:
            print(proc.stdout, end="")
    else:
        proc = subprocess.run(cmd)
    if check and proc.returncode != 0:
        raise subprocess.CalledProcessError(proc.returncode, cmd)
    return proc


def ffprobe_duration(audio_path: str, default: float = 60.0) -> float:
    try:
        proc = run(
            [
                "ffprobe",
                "-v",
                "quiet",
                "-show_entries",
                "format=duration",
                "-of",
                "csv=p=0",
                audio_path,
            ],
            check=False,
            capture=True,
        )
        text = (proc.stdout or "").strip() if proc.stdout is not None else ""
        return float(text) if text else default
    except Exception:
        return default


def write_concat_file(paths: list[str], filelist_path: str) -> int:
    Path(filelist_path).parent.mkdir(parents=True, exist_ok=True)
    with open(filelist_path, "w", encoding="utf-8") as f:
        for p in paths:
            escaped = p.replace("'", "'\\''")
            f.write(f"file '{escaped}'\n")
    return len(paths)


def safe_size_human(path: str) -> str:
    try:
        proc = run(["du", "-sh", path], check=False, capture=True)
        text = (proc.stdout or "").strip()
        if not text:
            return "unknown"
        return text.split()[0]
    except Exception:
        return "unknown"


def subtitle_filter_available() -> bool:
    proc = run(["ffmpeg", "-hide_banner", "-filters"], check=False, capture=True)
    return " subtitles " in (proc.stdout or "")


def escape_subtitles_path(path: str) -> str:
    # Escape minimal characters for ffmpeg filter parser.
    return path.replace("\\", "\\\\").replace(":", "\\:").replace("'", "\\'")


def make_black_raw(raw_path: str, audio_dur: float) -> None:
    eprint("[FFMPEG WARN] Buat RAW background polos sepanjang audio")
    run(
        [
            "ffmpeg",
            "-y",
            "-f",
            "lavfi",
            "-i",
            f"color=c=black:s={OUTPUT_WIDTH}x{OUTPUT_HEIGHT}:r={OUTPUT_FPS}",
            "-t",
            str(audio_dur),
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "23",
            raw_path,
        ]
    )


def assemble(args: argparse.Namespace) -> int:
    job_dir = Path(args.job_dir)
    clips_dir = Path(args.clips_dir)
    filelist = Path(args.filelist)
    audio = Path(args.audio)
    raw = Path(args.raw)
    final = Path(args.final)
    short = Path(args.short)
    srt = Path(args.srt) if args.srt else None
    thumb = Path(args.thumb) if args.thumb else None
    norm_dir = job_dir / "clips_norm"
    norm_list = job_dir / "filelist_norm.txt"

    job_dir.mkdir(parents=True, exist_ok=True)
    clips_dir.mkdir(parents=True, exist_ok=True)
    norm_dir.mkdir(parents=True, exist_ok=True)

    if (not audio.exists()) or audio.stat().st_size <= 0:
        eprint(f"[FFMPEG ERROR] Audio tidak ditemukan / kosong: {audio}")
        return 1

    eprint("[FFMPEG] Step0: scan clips")
    clips = sorted(glob.glob(str(clips_dir / "clip_*.mp4")))
    clips = [p for p in clips if Path(p).is_file() and Path(p).stat().st_size > 0]
    clip_count = write_concat_file(clips, str(filelist))
    eprint(f"[FFMPEG] Jumlah klip terdeteksi: {clip_count}")
    eprint(f"[FFMPEG] Black fallback allowed: {ALLOW_BLACK_VIDEO_FALLBACK}")

    audio_dur = ffprobe_duration(str(audio), default=60.0)
    if audio_dur <= 0:
        audio_dur = 60.0

    eprint("[FFMPEG] Step1: build RAW")
    raw_ok = False
    if clip_count > 0:
        direct_concat = run(
            [
                "ffmpeg",
                "-y",
                "-f",
                "concat",
                "-safe",
                "0",
                "-i",
                str(filelist),
                "-vf",
                f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},fps={OUTPUT_FPS},format=yuv420p",
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "23",
                str(raw),
            ],
            check=False,
        )
        raw_ok = direct_concat.returncode == 0 and raw.exists() and raw.stat().st_size > 0
        if not raw_ok:
            eprint("[FFMPEG WARN] Concat langsung gagal. Coba normalize klip...")
            norm_paths: list[str] = []
            for idx, clip in enumerate(clips, start=1):
                norm_file = norm_dir / f"norm_{idx:04d}.mp4"
                proc = run(
                    [
                        "ffmpeg",
                        "-y",
                        "-i",
                        clip,
                        "-an",
                        "-vf",
                        (
                            f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT}:force_original_aspect_ratio=increase,"
                            f"crop={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},fps={OUTPUT_FPS},format=yuv420p"
                        ),
                        "-c:v",
                        "libx264",
                        "-preset",
                        "fast",
                        "-crf",
                        "23",
                        str(norm_file),
                    ],
                    check=False,
                )
                if proc.returncode == 0 and norm_file.exists() and norm_file.stat().st_size > 0:
                    norm_paths.append(str(norm_file))
                else:
                    eprint(f"[FFMPEG WARN] Normalize gagal untuk: {clip}")

            norm_count = write_concat_file(norm_paths, str(norm_list))
            eprint(f"[FFMPEG] Normalize sukses: {norm_count} klip")
            if norm_count > 0:
                proc = run(
                    [
                        "ffmpeg",
                        "-y",
                        "-f",
                        "concat",
                        "-safe",
                        "0",
                        "-i",
                        str(norm_list),
                        "-vf",
                        f"scale={OUTPUT_WIDTH}:{OUTPUT_HEIGHT},fps={OUTPUT_FPS},format=yuv420p",
                        "-c:v",
                        "libx264",
                        "-preset",
                        "fast",
                        "-crf",
                        "23",
                        str(raw),
                    ],
                    check=False,
                )
                raw_ok = proc.returncode == 0 and raw.exists() and raw.stat().st_size > 0
            if not raw_ok:
                if not ALLOW_BLACK_VIDEO_FALLBACK:
                    eprint("[FFMPEG ERROR] Semua klip gagal dinormalisasi/digabung dan black fallback dinonaktifkan.")
                    return 1
                make_black_raw(str(raw), audio_dur)
                raw_ok = raw.exists() and raw.stat().st_size > 0
    else:
        if not ALLOW_BLACK_VIDEO_FALLBACK:
            eprint("[FFMPEG ERROR] Tidak ada klip valid untuk dirakit. Black fallback dinonaktifkan.")
            return 1
        make_black_raw(str(raw), audio_dur)
        raw_ok = raw.exists() and raw.stat().st_size > 0

    if not raw_ok:
        eprint(f"[FFMPEG ERROR] RAW video gagal dibuat: {raw}")
        return 1
    eprint("[FFMPEG] Step1 OK: RAW siap")

    eprint("[FFMPEG] Step2: merge audio + subtitle")
    video_ok = False
    can_sub = subtitle_filter_available()
    use_sub = args.burn_subtitles and srt and srt.exists() and srt.stat().st_size > 0 and can_sub
    if use_sub:
        eprint("[FFMPEG] Burn subtitle aktif")
        srt_esc = escape_subtitles_path(str(srt))
        sub_vf = (
            f"subtitles='{srt_esc}':"
            "force_style='Alignment=2,FontSize=20,PrimaryColour=&H00FFFF,OutlineColour=&H000000,BorderStyle=3'"
        )
        proc = run(
            [
                "ffmpeg",
                "-y",
                "-stream_loop",
                "-1",
                "-i",
                str(raw),
                "-i",
                str(audio),
                "-vf",
                sub_vf,
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "22",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-shortest",
                "-movflags",
                "+faststart",
                str(final),
            ],
            check=False,
        )
        video_ok = proc.returncode == 0 and final.exists() and final.stat().st_size > 0
        if not video_ok:
            eprint("[FFMPEG WARN] Burn subtitle gagal, lanjut tanpa subtitle")
    else:
        if args.burn_subtitles:
            if not srt or not srt.exists() or srt.stat().st_size == 0:
                eprint(f"[FFMPEG WARN] Subtitle file tidak ada/kosong: {srt if srt else '(none)'}")
            if not can_sub:
                eprint("[FFMPEG WARN] Filter subtitles tidak tersedia")
        else:
            eprint("[FFMPEG] Burn subtitle dinonaktifkan (video tanpa text overlay)")

    if not video_ok:
        run(
            [
                "ffmpeg",
                "-y",
                "-stream_loop",
                "-1",
                "-i",
                str(raw),
                "-i",
                str(audio),
                "-c:v",
                "libx264",
                "-preset",
                "fast",
                "-crf",
                "22",
                "-c:a",
                "aac",
                "-b:a",
                "128k",
                "-map",
                "0:v:0",
                "-map",
                "1:a:0",
                "-shortest",
                "-movflags",
                "+faststart",
                str(final),
            ]
        )

    if (not final.exists()) or final.stat().st_size <= 0:
        eprint(f"[FFMPEG ERROR] FINAL video gagal dibuat: {final}")
        return 1
    eprint("[FFMPEG] Step2 OK: FINAL siap")

    eprint("[FFMPEG] Step3: create short")
    run(
        [
            "ffmpeg",
            "-y",
            "-i",
            str(final),
            "-t",
            "60",
            "-c:v",
            "libx264",
            "-preset",
            "fast",
            "-crf",
            "22",
            "-c:a",
            "aac",
            "-b:a",
            "128k",
            "-movflags",
            "+faststart",
            str(short),
        ]
    )

    if (not short.exists()) or short.stat().st_size <= 0:
        eprint(f"[FFMPEG ERROR] SHORT video gagal dibuat: {short}")
        return 1

    if thumb:
        thumb_proc = run(
            [
                "ffmpeg",
                "-y",
                "-i",
                str(final),
                "-vf",
                "thumbnail,scale=1280:720",
                "-frames:v",
                "1",
                str(thumb),
            ],
            check=False,
        )
        if thumb_proc.returncode != 0:
            eprint("[FFMPEG WARN] Gagal membuat thumbnail")

    final_size = safe_size_human(str(final))
    final_dur = ffprobe_duration(str(final), default=0.0)

    eprint("FFMPEG_OK")
    eprint(f"FINAL_VIDEO:{final}")
    eprint(f"FINAL_SIZE:{final_size}")
    eprint(f"FINAL_DURATION:{final_dur}")
    return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Assemble final video for VidGen")
    parser.add_argument("--job-dir", required=True)
    parser.add_argument("--clips-dir", required=True)
    parser.add_argument("--filelist", required=True)
    parser.add_argument("--audio", required=True)
    parser.add_argument("--raw", required=True)
    parser.add_argument("--final", required=True)
    parser.add_argument("--short", required=True)
    parser.add_argument("--srt", default="")
    parser.add_argument("--thumb", default="")
    parser.add_argument("--burn-subtitles", action="store_true")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    try:
        return assemble(args)
    except subprocess.CalledProcessError as ex:
        eprint(f"[FFMPEG ERROR] Command gagal (exit {ex.returncode}): {' '.join(ex.cmd)}")
        return ex.returncode or 1
    except Exception as ex:
        eprint(f"[FFMPEG ERROR] Exception: {ex}")
        return 1


if __name__ == "__main__":
    sys.exit(main())

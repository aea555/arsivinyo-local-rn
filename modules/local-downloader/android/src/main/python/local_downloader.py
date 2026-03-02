import json
import os
import re
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse

import yt_dlp

SUPPORTED_PLATFORMS = {
    "twitter": ["twitter.com", "x.com"],
    "instagram": ["instagram.com"],
    "facebook": ["facebook.com", "fb.watch"],
    "reddit": ["reddit.com", "v.redd.it"],
    "youtube": ["youtube.com", "youtu.be"],
}


def _result(success: bool, code: str, message: Optional[str] = None, **kwargs: Any) -> str:
    payload: Dict[str, Any] = {
        "success": success,
        "code": code,
        "message": message,
    }
    payload.update(kwargs)
    return json.dumps(payload)


def _validate_supported_platform(url: str) -> str:
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    if domain.startswith("www."):
        domain = domain[4:]

    for platform, domains in SUPPORTED_PLATFORMS.items():
        if any(d in domain for d in domains):
            return platform

    raise ValueError("Bu platform desteklenmiyor. Desteklenen platformlar: Twitter, Instagram, Facebook, Reddit, Youtube")


def _resolve_cookie_file(cookies_dir: str, platform: str, cookie_profile: Optional[str]) -> Optional[str]:
    platform_dir = os.path.join(cookies_dir, platform)
    if not os.path.isdir(platform_dir):
        return None

    files = [
        os.path.join(platform_dir, f)
        for f in os.listdir(platform_dir)
        if f.endswith(".txt") or f.endswith(".json")
    ]
    if not files:
        return None

    if cookie_profile:
        normalized = cookie_profile.strip().lower()
        for path in files:
            filename = os.path.basename(path).lower()
            stem, _ = os.path.splitext(filename)
            if normalized == filename or normalized == stem:
                return path

    files.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return files[0]


def _estimate_file_size_mb(info: Dict[str, Any]) -> Tuple[float, str]:
    filesize = info.get("filesize")
    if filesize and filesize > 0:
        return filesize / (1024 * 1024), "filesize"

    filesize_approx = info.get("filesize_approx")
    if filesize_approx and filesize_approx > 0:
        return filesize_approx / (1024 * 1024), "filesize_approx"

    duration = info.get("duration")
    tbr = info.get("tbr")
    if duration and tbr:
        return (tbr * duration) / 8 / 1024, "duration_bitrate"

    if duration:
        avg_kbps = 2000 if duration < 180 else 5000
        return (avg_kbps * duration) / 8 / 1024, "duration_estimate"

    return 0, "unknown"


def _is_cancel_requested(cancel_flag_path: Optional[str]) -> bool:
    return bool(cancel_flag_path and os.path.exists(cancel_flag_path))


def _common_ydl_opts(cookie_file: Optional[str], ffmpeg_path: Optional[str]) -> Dict[str, Any]:
    opts: Dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "no_cache_dir": True,
    }

    if cookie_file:
        opts["cookiefile"] = cookie_file

    if ffmpeg_path and os.path.exists(ffmpeg_path):
        opts["ffmpeg_location"] = ffmpeg_path

    return opts


def _build_format_selector(max_file_size_mb: int) -> str:
    limit_mb = max(1, int(max_file_size_mb))
    return f"best[filesize<{limit_mb}M]/best[filesize_approx<{limit_mb}M]/bestvideo+bestaudio/best"


def _sanitize_filename(name: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9._-]", "_", name).strip("._")
    return name[:200] if name else "download"


def preflight(
    url: str,
    cookies_dir: str,
    cookie_profile: Optional[str] = None,
    max_file_size_mb: int = 2048,
    ffmpeg_path: Optional[str] = None,
) -> str:
    try:
        platform = _validate_supported_platform(url)
        cookie_file = _resolve_cookie_file(cookies_dir, platform, cookie_profile)

        opts = _common_ydl_opts(cookie_file, ffmpeg_path)
        opts["extractor_args"] = {
            "youtube": {
                "player_client": ["android", "ios", "web"],
            }
        }

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if "entries" in info and info["entries"]:
                info = info["entries"][0]

        size_mb, _ = _estimate_file_size_mb(info)
        if size_mb > 0 and size_mb > max_file_size_mb:
            return _result(
                False,
                "FILE_TOO_LARGE",
                f"File size ({size_mb:.1f}MB) exceeds local limit ({max_file_size_mb}MB)",
                estimated_size_mb=round(size_mb, 1),
                platform=platform,
            )

        return _result(
            True,
            "PREFLIGHT_OK",
            "Preflight successful",
            estimated_size_mb=round(size_mb, 1) if size_mb > 0 else None,
            platform=platform,
        )
    except ValueError as exc:
        return _result(False, "UNSUPPORTED_PLATFORM", str(exc))
    except Exception as exc:
        return _result(False, "PREFLIGHT_FAILED", str(exc))


def run_download(
    url: str,
    output_dir: str,
    cookies_dir: str,
    cookie_profile: Optional[str] = None,
    max_file_size_mb: int = 2048,
    cancel_flag_path: Optional[str] = None,
    ffmpeg_path: Optional[str] = None,
) -> str:
    try:
        if _is_cancel_requested(cancel_flag_path):
            return _result(False, "DOWNLOAD_CANCELLED", "Cancellation requested")

        platform = _validate_supported_platform(url)
        cookie_file = _resolve_cookie_file(cookies_dir, platform, cookie_profile)

        os.makedirs(output_dir, exist_ok=True)

        opts = _common_ydl_opts(cookie_file, ffmpeg_path)
        opts.update(
            {
                "format": _build_format_selector(max_file_size_mb),
                "merge_output_format": "mp4",
                "outtmpl": os.path.join(output_dir, "%(title)s.%(ext)s"),
                "extractor_args": {
                    "youtube": {
                        "player_client": ["android", "ios", "web"],
                    }
                },
            }
        )

        def _progress_hook(_: Dict[str, Any]) -> None:
            if _is_cancel_requested(cancel_flag_path):
                raise RuntimeError("DOWNLOAD_CANCELLED")

        opts["progress_hooks"] = [_progress_hook]

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = ydl.extract_info(url, download=False)
            if "entries" in info and info["entries"]:
                info = info["entries"][0]

            estimated_mb, _ = _estimate_file_size_mb(info)
            if estimated_mb > 0 and estimated_mb > max_file_size_mb:
                return _result(
                    False,
                    "FILE_TOO_LARGE",
                    f"File size ({estimated_mb:.1f}MB) exceeds local limit ({max_file_size_mb}MB)",
                    estimated_size_mb=round(estimated_mb, 1),
                )

            if _is_cancel_requested(cancel_flag_path):
                return _result(False, "DOWNLOAD_CANCELLED", "Cancellation requested")

            info = ydl.extract_info(url, download=True)
            if "entries" in info and info["entries"]:
                info = info["entries"][0]

            if _is_cancel_requested(cancel_flag_path):
                return _result(False, "DOWNLOAD_CANCELLED", "Cancellation requested")

            downloaded_file = None
            req = info.get("requested_downloads") or []
            for item in reversed(req):
                fp = item.get("filepath")
                if fp and os.path.exists(fp):
                    downloaded_file = fp
                    break

            if not downloaded_file:
                fallback = info.get("filepath") or info.get("_filename")
                if fallback and os.path.exists(fallback):
                    downloaded_file = fallback

            if not downloaded_file:
                candidate = ydl.prepare_filename(info)
                base, _ = os.path.splitext(candidate)
                mp4_candidate = f"{base}.mp4"
                downloaded_file = mp4_candidate if os.path.exists(mp4_candidate) else candidate

            if not downloaded_file or not os.path.exists(downloaded_file):
                return _result(False, "FILE_NOT_FOUND", "Download finished but output file could not be found")

            basename = _sanitize_filename(os.path.basename(downloaded_file))
            final_path = os.path.join(output_dir, basename)

            if downloaded_file != final_path:
                os.replace(downloaded_file, final_path)

            size_mb = os.path.getsize(final_path) / (1024 * 1024)
            return _result(
                True,
                "DOWNLOAD_COMPLETED",
                "Download completed",
                file_path=final_path,
                filename=basename,
                size_mb=round(size_mb, 2),
            )
    except ValueError as exc:
        return _result(False, "UNSUPPORTED_PLATFORM", str(exc))
    except Exception as exc:
        if "DOWNLOAD_CANCELLED" in str(exc):
            return _result(False, "DOWNLOAD_CANCELLED", "Cancellation requested")
        return _result(False, "DOWNLOAD_FAILED", str(exc))

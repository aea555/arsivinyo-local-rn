import datetime
import json
import os
import random
import re
import subprocess
import time
from typing import Any, Dict, Optional, Tuple
from urllib.parse import urlparse

import yt_dlp

COOKIE_PLATFORMS = {
    "twitter": ["twitter.com", "x.com"],
    "instagram": ["instagram.com"],
    "facebook": ["facebook.com", "fb.watch"],
    "reddit": ["reddit.com", "v.redd.it"],
    "youtube": ["youtube.com", "youtu.be"],
    "tiktok": ["tiktok.com", "vm.tiktok.com"],
}

DEFAULT_HTTP_USER_AGENT = (
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36"
)

RETRYABLE_STATUS_MARKERS = (
    "http error 403",
    "http error 429",
    "http error 500",
    "http error 502",
    "http error 503",
    "http error 504",
    "temporarily unavailable",
    "timed out",
    "connection reset",
    "network is unreachable",
)

VIDEO_TIMESTAMP_EXTENSIONS = {".mp4", ".mov", ".m4v", ".3gp"}


def _debug_log(enabled: bool, message: str) -> None:
    if enabled:
        print(f"[LocalDownloaderPy] {message}", flush=True)


def _result(success: bool, code: str, message: Optional[str] = None, **kwargs: Any) -> str:
    payload: Dict[str, Any] = {
        "success": success,
        "code": code,
        "message": message,
    }
    payload.update(kwargs)
    return json.dumps(payload)


def _detect_cookie_platform(url: str) -> Optional[str]:
    parsed = urlparse(url)
    domain = parsed.netloc.lower()
    if domain.startswith("www."):
        domain = domain[4:]

    for platform, domains in COOKIE_PLATFORMS.items():
        if any(d in domain for d in domains):
            return platform

    return None


def _resolve_cookie_file(cookies_dir: str, platform: Optional[str], cookie_profile: Optional[str]) -> Optional[str]:
    if not platform:
        return None

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


def _resolve_ffmpeg_location(ffmpeg_path: Optional[str]) -> Optional[str]:
    if not ffmpeg_path:
        return None

    if os.path.isdir(ffmpeg_path):
        return ffmpeg_path

    if os.path.isfile(ffmpeg_path):
        return ffmpeg_path

    return None


def _resolve_ffmpeg_binary(ffmpeg_location: Optional[str]) -> Optional[str]:
    if not ffmpeg_location:
        return None

    if os.path.isfile(ffmpeg_location):
        return ffmpeg_location

    for name in ("ffmpeg", "libffmpeg.so"):
        candidate = os.path.join(ffmpeg_location, name)
        if os.path.exists(candidate):
            return candidate

    return None


def _resolve_ffprobe_binary(ffmpeg_location: Optional[str]) -> Optional[str]:
    if not ffmpeg_location:
        return None

    if os.path.isfile(ffmpeg_location):
        base_dir = os.path.dirname(ffmpeg_location)
        base_name = os.path.basename(ffmpeg_location)
        candidates = []
        if base_name == "libffmpeg.so":
            candidates.append(os.path.join(base_dir, "libffprobe.so"))
        candidates.append(os.path.join(base_dir, "ffprobe"))
        for candidate in candidates:
            if os.path.exists(candidate):
                return candidate
        return None

    for name in ("ffprobe", "libffprobe.so"):
        candidate = os.path.join(ffmpeg_location, name)
        if os.path.exists(candidate):
            return candidate

    return None


def _probe_binary(binary_path: Optional[str], label: str, debug_logging: bool = False) -> Tuple[bool, str]:
    if not binary_path or not os.path.exists(binary_path):
        _debug_log(debug_logging, f"{label} missing path={binary_path}")
        return False, f"{label} binary missing"

    try:
        proc = subprocess.run(
            [binary_path, "-version"],
            capture_output=True,
            check=False,
            timeout=5,
            text=True,
        )
        first_line = (proc.stdout or proc.stderr or "").strip().splitlines()
        first = first_line[0] if first_line else ""
        if proc.returncode == 0:
            _debug_log(debug_logging, f"{label} probe ok path={binary_path} version={first or 'ok'}")
            return True, first or "ok"
        _debug_log(debug_logging, f"{label} probe failed path={binary_path} exit={proc.returncode} first={first or 'no output'}")
        return False, f"{label} exited {proc.returncode}: {first or 'no output'}"
    except Exception as exc:
        _debug_log(debug_logging, f"{label} probe exception path={binary_path} error={exc}")
        return False, f"{label} probe failed: {exc}"


def _resolve_merge_capability(
    ffmpeg_location: Optional[str],
    requested_merge_capable: bool,
    debug_logging: bool = False,
) -> Tuple[bool, Optional[str]]:
    if not requested_merge_capable:
        _debug_log(debug_logging, "merge capability disabled by native input")
        return False, None

    ffmpeg_binary = _resolve_ffmpeg_binary(ffmpeg_location)
    ffprobe_binary = _resolve_ffprobe_binary(ffmpeg_location)
    _debug_log(
        debug_logging,
        f"merge capability probing ffmpeg_location={ffmpeg_location} ffmpeg={ffmpeg_binary} ffprobe={ffprobe_binary}",
    )
    ffmpeg_ok, ffmpeg_reason = _probe_binary(ffmpeg_binary, "ffmpeg", debug_logging)
    ffprobe_ok, ffprobe_reason = _probe_binary(ffprobe_binary, "ffprobe", debug_logging)
    if ffmpeg_ok and ffprobe_ok:
        _debug_log(debug_logging, "merge capability ready")
        return True, None

    reason = f"{ffmpeg_reason}; {ffprobe_reason}"
    _debug_log(debug_logging, f"merge capability unavailable: {reason}")
    return False, reason


def _build_http_headers(url: str, user_agent: str) -> Dict[str, str]:
    headers = {
        "User-Agent": user_agent,
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "Accept-Language": "en-US,en;q=0.9",
        "Sec-Fetch-Dest": "document",
        "Sec-Fetch-Mode": "navigate",
        "Sec-Fetch-Site": "none",
    }
    host = (urlparse(url).netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]

    if host.endswith("reddit.com") or host.endswith("redd.it"):
        headers["Referer"] = "https://www.reddit.com/"
        headers["Origin"] = "https://www.reddit.com"

    return headers


def _common_ydl_opts(
    url: str,
    cookie_file: Optional[str],
    ffmpeg_location: Optional[str],
    user_agent: str,
    debug_logging: bool = False,
) -> Dict[str, Any]:
    headers = {
        **_build_http_headers(url, user_agent)
    }

    opts: Dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "noplaylist": True,
        "no_cache_dir": True,
        "http_headers": headers,
        "extractor_retries": 3,
        "retries": 3,
        "fragment_retries": 3,
        # Keep output file timestamps at download time so gallery apps sort as latest.
        "updatetime": False,
    }

    if cookie_file:
        opts["cookiefile"] = cookie_file

    ffmpeg_binary = _resolve_ffmpeg_binary(ffmpeg_location)
    if ffmpeg_binary:
        opts["ffmpeg_location"] = ffmpeg_binary
    elif ffmpeg_location and os.path.exists(ffmpeg_location):
        opts["ffmpeg_location"] = ffmpeg_location
    _debug_log(
        debug_logging,
        f"ydl opts prepared url={url} cookie={'yes' if cookie_file else 'no'} ffmpeg_location={opts.get('ffmpeg_location')}",
    )

    return opts


def _build_format_selector(max_file_size_mb: int, merge_capable: bool) -> str:
    limit_mb = max(1, int(max_file_size_mb))

    if merge_capable:
        return (
            f"bestvideo[filesize<{limit_mb}M]+bestaudio[filesize<{limit_mb}M]/"
            f"bestvideo+bestaudio/"
            f"best[filesize<{limit_mb}M]/"
            f"best[filesize_approx<{limit_mb}M]/"
            "best"
        )

    return (
        f"best[acodec!=none][vcodec!=none][filesize<{limit_mb}M]/"
        f"best[acodec!=none][vcodec!=none][filesize_approx<{limit_mb}M]/"
        "best[acodec!=none][vcodec!=none]"
    )


def _has_progressive_format(info: Dict[str, Any]) -> bool:
    for fmt in info.get("formats") or []:
        vcodec = fmt.get("vcodec")
        acodec = fmt.get("acodec")
        if vcodec and vcodec != "none" and acodec and acodec != "none":
            return True
    return False


def _is_retryable_message(message: str) -> bool:
    return any(marker in message for marker in RETRYABLE_STATUS_MARKERS)


def _extract_info_with_retry(ydl: yt_dlp.YoutubeDL, url: str, *, download: bool, max_attempts: int = 3) -> Dict[str, Any]:
    last_exc: Optional[Exception] = None

    for attempt in range(1, max_attempts + 1):
        try:
            info = ydl.extract_info(url, download=download)
            if isinstance(info, dict):
                return info
            return {}
        except Exception as exc:
            last_exc = exc
            message = str(exc).lower()
            can_retry = attempt < max_attempts and _is_retryable_message(message)
            if not can_retry:
                raise

            backoff = 0.6 * (2 ** (attempt - 1)) + random.uniform(0.0, 0.25)
            time.sleep(backoff)

    if last_exc:
        raise last_exc
    raise RuntimeError("UNKNOWN_EXTRACTION_ERROR")


def _classify_exception(exc: Exception, default_code: str) -> Tuple[str, str]:
    message = str(exc) or default_code
    lower = message.lower()

    if "http error 403" in lower and ("blocked" in lower or "forbidden" in lower or "reddit" in lower):
        return "SITE_BLOCKED_403", message

    if (
        "cookie" in lower
        and ("stale" in lower or "expired" in lower or "invalid" in lower or "required" in lower)
    ) or "sign in" in lower or "log in" in lower:
        return "COOKIE_STALE_OR_INVALID", message

    if "ffmpeg is not installed" in lower or "ffprobe is not installed" in lower:
        return "MERGE_DEPENDENCY_MISSING", message

    return default_code, message


def _sanitize_filename(name: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9._-]", "_", name).strip("._")
    return name[:200] if name else "download"


def _normalize_video_timestamp(file_path: str, ffmpeg_location: Optional[str], debug_logging: bool = False) -> bool:
    _, ext = os.path.splitext(file_path)
    ext = ext.lower()
    if ext not in VIDEO_TIMESTAMP_EXTENSIONS:
        return False

    ffmpeg_binary = _resolve_ffmpeg_binary(ffmpeg_location)
    if not ffmpeg_binary or not os.path.exists(ffmpeg_binary):
        _debug_log(debug_logging, f"timestamp normalize skipped: ffmpeg missing path={ffmpeg_binary}")
        return False

    base, ext = os.path.splitext(file_path)
    temp_path = f"{base}.timestamp_refresh{ext}"
    creation_time = datetime.datetime.now(datetime.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")

    cmd = [
        ffmpeg_binary,
        "-y",
        "-loglevel",
        "error",
        "-i",
        file_path,
        "-map",
        "0",
        "-c",
        "copy",
        "-metadata",
        f"creation_time={creation_time}",
        "-movflags",
        "+use_metadata_tags",
        temp_path,
    ]

    try:
        _debug_log(debug_logging, f"timestamp normalize start file={file_path} ffmpeg={ffmpeg_binary}")
        result = subprocess.run(cmd, capture_output=True, check=False, timeout=120)
        if result.returncode != 0 or not os.path.exists(temp_path):
            stderr = (result.stderr or b"").decode("utf-8", errors="replace").strip().splitlines()
            _debug_log(debug_logging, f"timestamp normalize failed exit={result.returncode} stderr={stderr[0] if stderr else 'n/a'}")
            return False

        if os.path.getsize(temp_path) <= 0:
            _debug_log(debug_logging, "timestamp normalize failed: empty temp output")
            return False

        os.replace(temp_path, file_path)
        os.utime(file_path, None)
        verified = _verify_video_creation_time(file_path, ffmpeg_location, debug_logging)
        if not verified:
            _debug_log(debug_logging, "timestamp normalize verification failed")
            return False
        _debug_log(debug_logging, "timestamp normalize success")
        return True
    except Exception as exc:
        _debug_log(debug_logging, f"timestamp normalize exception: {exc}")
        return False
    finally:
        if os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except OSError:
                pass


def _verify_video_creation_time(file_path: str, ffmpeg_location: Optional[str], debug_logging: bool = False) -> bool:
    ffprobe_binary = _resolve_ffprobe_binary(ffmpeg_location)
    if not ffprobe_binary or not os.path.exists(ffprobe_binary):
        _debug_log(debug_logging, f"timestamp verify skipped: ffprobe missing path={ffprobe_binary}")
        return False

    probes = [
        [
            ffprobe_binary,
            "-v",
            "error",
            "-show_entries",
            "format_tags=creation_time",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            file_path,
        ],
        [
            ffprobe_binary,
            "-v",
            "error",
            "-show_entries",
            "stream_tags=creation_time",
            "-of",
            "default=noprint_wrappers=1:nokey=1",
            file_path,
        ],
    ]

    for cmd in probes:
        try:
            result = subprocess.run(cmd, capture_output=True, check=False, timeout=10, text=True)
            output = (result.stdout or "").strip()
            if result.returncode == 0 and output:
                _debug_log(debug_logging, f"timestamp verify ok output={output.splitlines()[0]}")
                return True
        except Exception as exc:
            _debug_log(debug_logging, f"timestamp verify exception: {exc}")

    return False


def preflight(
    url: str,
    cookies_dir: str,
    cookie_profile: Optional[str] = None,
    max_file_size_mb: int = 2048,
    ffmpeg_path: Optional[str] = None,
    cookie_file: Optional[str] = None,
    force_no_cookie: bool = False,
    merge_capable: bool = True,
    user_agent: str = DEFAULT_HTTP_USER_AGENT,
    debug_logging: bool = False,
) -> str:
    try:
        _debug_log(
            debug_logging,
            f"preflight start url={url} ffmpeg_path={ffmpeg_path} cookie_file={'yes' if cookie_file else 'no'} "
            f"force_no_cookie={force_no_cookie} merge_capable={merge_capable}",
        )
        selected_cookie_file = cookie_file if cookie_file and os.path.exists(cookie_file) else None
        platform = _detect_cookie_platform(url)
        if not selected_cookie_file and not force_no_cookie:
            selected_cookie_file = _resolve_cookie_file(cookies_dir, platform, cookie_profile)
        if platform == "reddit" and not selected_cookie_file and not force_no_cookie:
            return _result(False, "REDDIT_COOKIE_REQUIRED", "Reddit download requires a valid Reddit cookie profile.")

        ffmpeg_location = _resolve_ffmpeg_location(ffmpeg_path)
        effective_merge_capable, merge_reason = _resolve_merge_capability(ffmpeg_location, merge_capable, debug_logging)
        opts = _common_ydl_opts(url, selected_cookie_file, ffmpeg_location, user_agent, debug_logging)
        opts["extractor_args"] = {
            "youtube": {
                "player_client": ["android", "ios"],
            }
        }

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = _extract_info_with_retry(ydl, url, download=False)
            if "entries" in info and info["entries"]:
                info = info["entries"][0]

        if not effective_merge_capable and not _has_progressive_format(info):
            _debug_log(debug_logging, "preflight failed: no progressive format and merge unavailable")
            return _result(
                False,
                "MERGE_DEPENDENCY_MISSING",
                merge_reason
                or "This media requires stream merge but ffmpeg/ffprobe merge runtime is unavailable.",
                platform=platform,
            )

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
    except Exception as exc:
        code, message = _classify_exception(exc, "PREFLIGHT_FAILED")
        _debug_log(debug_logging, f"preflight exception code={code} message={message}")
        return _result(False, code, message)


def run_download(
    url: str,
    output_dir: str,
    cookies_dir: str,
    cookie_profile: Optional[str] = None,
    max_file_size_mb: int = 2048,
    cancel_flag_path: Optional[str] = None,
    ffmpeg_path: Optional[str] = None,
    cookie_file: Optional[str] = None,
    force_no_cookie: bool = False,
    merge_capable: bool = True,
    user_agent: str = DEFAULT_HTTP_USER_AGENT,
    debug_logging: bool = False,
) -> str:
    try:
        _debug_log(
            debug_logging,
            f"download start url={url} output_dir={output_dir} ffmpeg_path={ffmpeg_path} "
            f"cookie_file={'yes' if cookie_file else 'no'} force_no_cookie={force_no_cookie} merge_capable={merge_capable}",
        )
        if _is_cancel_requested(cancel_flag_path):
            return _result(False, "DOWNLOAD_CANCELLED", "Cancellation requested")

        platform = _detect_cookie_platform(url)
        selected_cookie_file = cookie_file if cookie_file and os.path.exists(cookie_file) else None
        if not selected_cookie_file and not force_no_cookie:
            selected_cookie_file = _resolve_cookie_file(cookies_dir, platform, cookie_profile)
        if platform == "reddit" and not selected_cookie_file and not force_no_cookie:
            return _result(False, "REDDIT_COOKIE_REQUIRED", "Reddit download requires a valid Reddit cookie profile.")

        os.makedirs(output_dir, exist_ok=True)

        ffmpeg_location = _resolve_ffmpeg_location(ffmpeg_path)
        effective_merge_capable, merge_reason = _resolve_merge_capability(ffmpeg_location, merge_capable, debug_logging)
        opts = _common_ydl_opts(url, selected_cookie_file, ffmpeg_location, user_agent, debug_logging)
        opts.update(
            {
                "format": _build_format_selector(max_file_size_mb, effective_merge_capable),
                "outtmpl": os.path.join(output_dir, "%(title)s.%(ext)s"),
                "extractor_args": {
                    "youtube": {
                        "player_client": ["android", "ios"],
                    }
                },
            }
        )
        if effective_merge_capable:
            opts["merge_output_format"] = "mp4"
        _debug_log(debug_logging, f"download format mode={'merged' if effective_merge_capable else 'progressive'} format={opts.get('format')}")

        def _progress_hook(_: Dict[str, Any]) -> None:
            if _is_cancel_requested(cancel_flag_path):
                raise RuntimeError("DOWNLOAD_CANCELLED")

        opts["progress_hooks"] = [_progress_hook]

        with yt_dlp.YoutubeDL(opts) as ydl:
            info = _extract_info_with_retry(ydl, url, download=False)
            if "entries" in info and info["entries"]:
                info = info["entries"][0]

            if not effective_merge_capable and not _has_progressive_format(info):
                _debug_log(debug_logging, "download failed: no progressive format and merge unavailable")
                return _result(
                    False,
                    "MERGE_DEPENDENCY_MISSING",
                    merge_reason
                    or "This media requires stream merge but ffmpeg/ffprobe merge runtime is unavailable.",
                )

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

            info = _extract_info_with_retry(ydl, url, download=True)
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

            timestamp_normalized = _normalize_video_timestamp(final_path, ffmpeg_location, debug_logging)
            warning_code = None

            if not timestamp_normalized:
                try:
                    os.utime(final_path, None)
                except OSError:
                    pass

                _, ext = os.path.splitext(final_path)
                if ext.lower() in VIDEO_TIMESTAMP_EXTENSIONS and ffmpeg_location:
                    warning_code = "TIMESTAMP_POSTPROCESS_FAILED"
                    _debug_log(debug_logging, f"timestamp warning for file={final_path}")

            size_mb = os.path.getsize(final_path) / (1024 * 1024)
            return _result(
                True,
                "DOWNLOAD_COMPLETED",
                "Download completed",
                file_path=final_path,
                filename=basename,
                size_mb=round(size_mb, 2),
                timestamp_normalized=timestamp_normalized,
                warning_code=warning_code,
                format_mode="merged" if effective_merge_capable else "progressive",
            )
    except Exception as exc:
        if "DOWNLOAD_CANCELLED" in str(exc):
            return _result(False, "DOWNLOAD_CANCELLED", "Cancellation requested")

        code, message = _classify_exception(exc, "DOWNLOAD_FAILED")
        _debug_log(debug_logging, f"download exception code={code} message={message}")
        return _result(False, code, message)

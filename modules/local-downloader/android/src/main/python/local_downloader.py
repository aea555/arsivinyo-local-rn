import datetime
import importlib
import json
import os
import random
import re
import subprocess
import time
import uuid
from typing import Any, Dict, List, Optional, Tuple
from urllib.parse import urlparse, urlunparse
from urllib.request import Request, urlopen

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
    "downloaded file is empty",
)

VIDEO_TIMESTAMP_EXTENSIONS = {".mp4", ".mov", ".m4v", ".3gp"}
MAX_ATTEMPT_TRACE = 80
ALLOW_REDDIT_PUBLIC_FALLBACK = True
YTDLP_VERBOSE_DEV = True
TIKTOK_APP_INFO_CANDIDATES = [
    ("musical_ly", "35.1.3", "2023501030", "0"),
    ("trill", "35.1.3", "2023501030", "1180"),
    ("aweme", "35.1.3", "2023501030", "1128"),
]
TIKTOK_API_HOSTNAME_CANDIDATES = [
    "api22-normal-c-alisg.tiktokv.com",
    "api16-normal-c-useast1a.tiktokv.com",
]
IMP_ABI_COVERAGE = ["arm64-v8a"]
IMPERSONATION_BACKEND_NAME = "curl_cffi"
IMPERSONATION_DEPENDENCY_PIN = "0.14.0"
DAILYMOTION_DOMAINS = {"dailymotion.com", "www.dailymotion.com", "dai.ly"}
IMPERSONATION_TARGET_MATRIX = {
    "dailymotion": ["firefox", "chrome", "edge"],
    "tiktok": ["chrome", "firefox"],
    "reddit": ["chrome"],
}
IMPERSONATION_UNAVAILABLE_MARKERS = (
    "impersonate target",
    "no impersonate target is available",
    "none of these impersonate targets are available",
)
IMPERSONATION_DISABLE_EXTRACTOR_ARGS: Dict[str, Dict[str, List[str]]] = {
    "generic": {"impersonate": ["false"]},
    "dailymotion": {"impersonate": ["false"]},
    "tiktok": {"impersonate": ["false"]},
}
REDDIT_DOMAINS = {"reddit.com", "v.redd.it", "redd.it"}
TIKTOK_SHORT_DOMAINS = {"vm.tiktok.com", "vt.tiktok.com"}
COOKIE_PLATFORM_DOMAINS = {
    "reddit": {"reddit.com", "redd.it", "v.redd.it"},
    "tiktok": {"tiktok.com", "vm.tiktok.com"},
}
YTDLP_PIN_BASELINE = "2026.2.4"
URL_REDACTION_PATTERN = re.compile(r"/(?:data|storage|sdcard)/[^\s)]+", flags=re.IGNORECASE)
TOKEN_REDACTION_PATTERN = re.compile(r"(po_token|visitor_data|authorization)=([^,&\\s]+)", flags=re.IGNORECASE)
REDDIT_SHARE_PATH_PATTERN = re.compile(r"/r/[^/]+/s/[^/?#]+", flags=re.IGNORECASE)
GENERIC_FAILURE_CODES = {"PREFLIGHT_FAILED", "DOWNLOAD_FAILED"}

_RUNTIME_DIAGNOSTICS: Dict[str, Any] = {
    "normalizedUrlLast": None,
    "attemptTrace": [],
    "lastExtractorKey": None,
    "lastRawYtDlpError": None,
    "lastCookieCheck": None,
    "platformStrategyLast": None,
    "ytDlpVersionAgeDays": None,
    "impersonationRuntimeAvailable": None,
    "impersonationEnabled": False,
    "impersonationBackend": "none",
    "impersonationRequiredByExtractorLast": None,
    "impersonationAttemptedTargetsLast": [],
    "impersonationResolvedTargetLast": None,
    "impersonationWheelVersion": None,
    "impersonationBuildAbiCoverage": IMP_ABI_COVERAGE,
    "impersonationBootstrapError": None,
}
_IMPERSONATION_RUNTIME_AVAILABLE: Optional[bool] = None


def _now_ms() -> int:
    return int(time.time() * 1000)


def _redact_text(value: str) -> str:
    redacted = URL_REDACTION_PATTERN.sub("<redacted-path>", value or "")
    return TOKEN_REDACTION_PATTERN.sub(r"\1=<redacted>", redacted)


def _reset_attempt_trace() -> None:
    _RUNTIME_DIAGNOSTICS["attemptTrace"] = []
    _RUNTIME_DIAGNOSTICS["impersonationAttemptedTargetsLast"] = []
    _RUNTIME_DIAGNOSTICS["impersonationResolvedTargetLast"] = None
    _RUNTIME_DIAGNOSTICS["impersonationRequiredByExtractorLast"] = None


def _push_attempt_trace(entry: Dict[str, Any]) -> None:
    trace = _RUNTIME_DIAGNOSTICS.setdefault("attemptTrace", [])
    trace.append(entry)
    if len(trace) > MAX_ATTEMPT_TRACE:
        del trace[:-MAX_ATTEMPT_TRACE]


def _set_runtime_diag(key: str, value: Any) -> None:
    _RUNTIME_DIAGNOSTICS[key] = value


def _append_diag_target(target: Optional[str]) -> None:
    if not target:
        return
    current = list(_RUNTIME_DIAGNOSTICS.get("impersonationAttemptedTargetsLast") or [])
    if target not in current:
        current.append(target)
    _set_runtime_diag("impersonationAttemptedTargetsLast", current)


def _is_impersonation_unavailable_message(message: str) -> bool:
    lower = (message or "").lower()
    return any(marker in lower for marker in IMPERSONATION_UNAVAILABLE_MARKERS)


def _extract_required_targets_from_message(message: str) -> List[str]:
    text = message or ""
    match = re.search(r"available:\s*([a-z0-9_,\-\s]+)", text, flags=re.IGNORECASE)
    if not match:
        return []
    raw = match.group(1).strip().rstrip(".")
    return [item.strip().lower() for item in raw.split(",") if item.strip()]


def _bootstrap_impersonation_runtime(debug_logging: bool = False) -> bool:
    global _IMPERSONATION_RUNTIME_AVAILABLE
    if _IMPERSONATION_RUNTIME_AVAILABLE is not None:
        return _IMPERSONATION_RUNTIME_AVAILABLE

    _set_runtime_diag("impersonationAttemptedTargetsLast", [])
    _set_runtime_diag("impersonationResolvedTargetLast", None)
    _set_runtime_diag("impersonationRequiredByExtractorLast", None)

    try:
        module = importlib.import_module(IMPERSONATION_BACKEND_NAME)
    except ModuleNotFoundError as exc:
        _IMPERSONATION_RUNTIME_AVAILABLE = False
        _set_runtime_diag("impersonationRuntimeAvailable", False)
        _set_runtime_diag("impersonationEnabled", False)
        _set_runtime_diag("impersonationBackend", "none")
        _set_runtime_diag("impersonationWheelVersion", IMPERSONATION_DEPENDENCY_PIN)
        _set_runtime_diag("impersonationBootstrapError", f"IMPERSONATION_DEPENDENCY_MISSING: {exc}")
        _debug_log(debug_logging, "IMP_BOOTSTRAP_FAIL code=IMPERSONATION_DEPENDENCY_MISSING reason=module-not-found")
        return False
    except Exception as exc:
        _IMPERSONATION_RUNTIME_AVAILABLE = False
        _set_runtime_diag("impersonationRuntimeAvailable", False)
        _set_runtime_diag("impersonationEnabled", False)
        _set_runtime_diag("impersonationBackend", "none")
        _set_runtime_diag("impersonationWheelVersion", None)
        _set_runtime_diag("impersonationBootstrapError", f"IMPERSONATION_BOOTSTRAP_FAILED: {exc}")
        _debug_log(debug_logging, f"IMP_BOOTSTRAP_FAIL code=IMPERSONATION_BOOTSTRAP_FAILED reason={exc}")
        return False

    try:
        from curl_cffi import Curl

        curl = Curl()
        curl.close()
        version = str(getattr(module, "__version__", "")).strip() or None
        _IMPERSONATION_RUNTIME_AVAILABLE = True
        _set_runtime_diag("impersonationRuntimeAvailable", True)
        _set_runtime_diag("impersonationEnabled", True)
        _set_runtime_diag("impersonationBackend", IMPERSONATION_BACKEND_NAME)
        _set_runtime_diag("impersonationWheelVersion", version)
        _set_runtime_diag("impersonationBootstrapError", None)
        _debug_log(
            debug_logging,
            f"IMP_BOOTSTRAP_OK backend={IMPERSONATION_BACKEND_NAME} version={version or 'unknown'}",
        )
        return True
    except Exception as exc:
        _IMPERSONATION_RUNTIME_AVAILABLE = False
        _set_runtime_diag("impersonationRuntimeAvailable", False)
        _set_runtime_diag("impersonationEnabled", False)
        _set_runtime_diag("impersonationBackend", "none")
        _set_runtime_diag("impersonationWheelVersion", None)
        _set_runtime_diag("impersonationBootstrapError", f"IMPERSONATION_BOOTSTRAP_FAILED: {exc}")
        _debug_log(debug_logging, f"IMP_BOOTSTRAP_FAIL code=IMPERSONATION_BOOTSTRAP_FAILED reason={exc}")
        return False


def _is_impersonation_runtime_available(debug_logging: bool = False) -> bool:
    return _bootstrap_impersonation_runtime(debug_logging)


def _merge_extractor_args(base: Optional[Dict[str, Any]], extra: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    if not base and not extra:
        return None
    merged: Dict[str, Any] = {}
    for source in (base or {}, extra or {}):
        for key, value in source.items():
            if isinstance(value, dict) and isinstance(merged.get(key), dict):
                child = dict(merged[key])  # type: ignore[index]
                child.update(value)
                merged[key] = child
            else:
                merged[key] = value
    return merged


def _extract_yt_dlp_version_age_days(version: str) -> Optional[int]:
    match = re.match(r"^(\d{4})\.(\d{1,2})\.(\d{1,2})$", (version or "").strip())
    if not match:
        return None
    try:
        year, month, day = (int(match.group(1)), int(match.group(2)), int(match.group(3)))
        release_date = datetime.date(year, month, day)
        return max(0, (datetime.date.today() - release_date).days)
    except Exception:
        return None


def get_runtime_diagnostics() -> str:
    version = getattr(getattr(yt_dlp, "version", object()), "__version__", None)
    if isinstance(version, str):
        _set_runtime_diag("ytDlpVersionAgeDays", _extract_yt_dlp_version_age_days(version))

    _bootstrap_impersonation_runtime(debug_logging=False)

    payload = {
        "normalizedUrlLast": _RUNTIME_DIAGNOSTICS.get("normalizedUrlLast"),
        "attemptTraceCount": len(_RUNTIME_DIAGNOSTICS.get("attemptTrace") or []),
        "attemptTrace": _RUNTIME_DIAGNOSTICS.get("attemptTrace") or [],
        "lastExtractorKey": _RUNTIME_DIAGNOSTICS.get("lastExtractorKey"),
        "lastRawYtDlpError": _RUNTIME_DIAGNOSTICS.get("lastRawYtDlpError"),
        "lastCookieCheck": _RUNTIME_DIAGNOSTICS.get("lastCookieCheck"),
        "platformStrategyLast": _RUNTIME_DIAGNOSTICS.get("platformStrategyLast"),
        "ytDlpVersionAgeDays": _RUNTIME_DIAGNOSTICS.get("ytDlpVersionAgeDays"),
        "impersonationRuntimeAvailable": _RUNTIME_DIAGNOSTICS.get("impersonationRuntimeAvailable"),
        "impersonationEnabled": _RUNTIME_DIAGNOSTICS.get("impersonationEnabled"),
        "impersonationBackend": _RUNTIME_DIAGNOSTICS.get("impersonationBackend"),
        "impersonationRequiredByExtractorLast": _RUNTIME_DIAGNOSTICS.get("impersonationRequiredByExtractorLast"),
        "impersonationAttemptedTargetsLast": _RUNTIME_DIAGNOSTICS.get("impersonationAttemptedTargetsLast") or [],
        "impersonationResolvedTargetLast": _RUNTIME_DIAGNOSTICS.get("impersonationResolvedTargetLast"),
        "impersonationWheelVersion": _RUNTIME_DIAGNOSTICS.get("impersonationWheelVersion"),
        "impersonationBuildAbiCoverage": _RUNTIME_DIAGNOSTICS.get("impersonationBuildAbiCoverage") or IMP_ABI_COVERAGE,
        "impersonationBootstrapError": _RUNTIME_DIAGNOSTICS.get("impersonationBootstrapError"),
    }
    return json.dumps(payload)


def run_impersonation_self_test(debug_logging: bool = False) -> str:
    enabled = _bootstrap_impersonation_runtime(debug_logging=debug_logging)
    code = "IMPERSONATION_SELF_TEST_OK" if enabled else (
        "IMPERSONATION_BOOTSTRAP_FAILED"
        if str(_RUNTIME_DIAGNOSTICS.get("impersonationBootstrapError") or "").startswith("IMPERSONATION_BOOTSTRAP_FAILED")
        else "IMPERSONATION_DEPENDENCY_MISSING"
    )
    return _result(
        enabled,
        code,
        None if enabled else str(_RUNTIME_DIAGNOSTICS.get("impersonationBootstrapError") or "Impersonation bootstrap failed"),
        impersonation_enabled=enabled,
        backend=_RUNTIME_DIAGNOSTICS.get("impersonationBackend"),
        wheel_version=_RUNTIME_DIAGNOSTICS.get("impersonationWheelVersion"),
        build_abi_coverage=_RUNTIME_DIAGNOSTICS.get("impersonationBuildAbiCoverage") or IMP_ABI_COVERAGE,
    )


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
    domain = _extract_host(url)
    if not domain:
        return None

    for platform, domains in COOKIE_PLATFORMS.items():
        if any(domain == d or domain.endswith(f".{d}") for d in domains):
            return platform

    return None


def _extract_host(url: str) -> str:
    raw = (url or "").strip()
    if not raw:
        return ""

    parsed = urlparse(raw if "://" in raw else f"https://{raw}")
    host = (parsed.hostname or parsed.netloc or "").lower()
    if host.startswith("www."):
        host = host[4:]
    return host


def _is_public_reddit_url(url: str) -> bool:
    host = _extract_host(url)
    if host not in REDDIT_DOMAINS:
        return False

    parsed = urlparse(url if "://" in url else f"https://{url}")
    path = (parsed.path or "").lower()
    return "/comments/" in path or host in {"v.redd.it", "redd.it"}


def _resolve_reddit_share_url(url: str, user_agent: str, debug_logging: bool = False) -> Tuple[Optional[str], Optional[str]]:
    try:
        request = Request(url, headers={"User-Agent": user_agent})
        with urlopen(request, timeout=12) as response:
            final_url = response.geturl()
            _debug_log(debug_logging, f"reddit share resolved url={url} final={final_url}")
            if not final_url:
                return None, "empty redirect target"
            return final_url, None
    except Exception as exc:
        _debug_log(debug_logging, f"reddit share resolve failed url={url} error={exc}")
        return None, str(exc)


def _resolve_redirect_url(url: str, user_agent: str, debug_logging: bool = False) -> Tuple[Optional[str], Optional[str]]:
    try:
        request = Request(url, headers={"User-Agent": user_agent})
        with urlopen(request, timeout=12) as response:
            final_url = response.geturl()
            _debug_log(debug_logging, f"redirect resolved url={url} final={final_url}")
            if not final_url:
                return None, "empty redirect target"
            return final_url, None
    except Exception as exc:
        _debug_log(debug_logging, f"redirect resolve failed url={url} error={exc}")
        return None, str(exc)


def _normalize_input_url(url: str, platform: Optional[str], user_agent: str, debug_logging: bool = False) -> Tuple[Optional[str], Optional[str]]:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = _extract_host(url)

    normalized_url = url
    if not parsed.scheme:
        normalized_url = f"https://{url.strip()}"

    if platform == "tiktok" and host in TIKTOK_SHORT_DOMAINS:
        final_url, error = _resolve_redirect_url(normalized_url, user_agent, debug_logging)
        if error:
            return None, error
        normalized_url = final_url or normalized_url

    if platform == "tiktok":
        return _canonicalize_tiktok_url(normalized_url), None

    if platform != "reddit" or host not in REDDIT_DOMAINS:
        return normalized_url, None

    path = parsed.path or ""
    if not REDDIT_SHARE_PATH_PATTERN.search(path):
        return normalized_url, None

    final_url, error = _resolve_reddit_share_url(normalized_url, user_agent, debug_logging)
    if error:
        return None, error

    final_host = _extract_host(final_url or "")
    if final_host not in REDDIT_DOMAINS:
        return None, f"resolved host is not reddit ({final_host})"

    return final_url, None


def _canonicalize_tiktok_url(url: str) -> str:
    parsed = urlparse(url if "://" in url else f"https://{url}")
    host = (parsed.hostname or "").lower()
    if host.startswith("www."):
        host = host[4:]
    if not host.endswith("tiktok.com"):
        return url

    path = (parsed.path or "/").rstrip("/") or "/"
    if not path.startswith("/"):
        path = f"/{path}"
    # Drop tracking/query params (_r/_t etc.). TikTok video URLs are stable by path.
    return urlunparse(("https", "www.tiktok.com", path, "", "", ""))


def _inspect_cookie_file(cookie_file: Optional[str], platform: Optional[str]) -> Dict[str, Any]:
    result: Dict[str, Any] = {
        "platform": platform,
        "hasCookieFile": bool(cookie_file and os.path.exists(cookie_file)),
        "domainCoverage": [],
        "unexpiredCount": 0,
    }
    if not result["hasCookieFile"]:
        return result

    now = int(time.time())
    domains: set[str] = set()
    unexpired = 0
    try:
        with open(cookie_file or "", "r", encoding="utf-8", errors="replace") as f:
            for raw_line in f:
                line = raw_line.strip()
                if not line or line.startswith("#"):
                    continue
                cols = raw_line.rstrip("\n").split("\t")
                if len(cols) < 7:
                    continue

                domain = (cols[0] or "").strip().lstrip(".").lower()
                if domain.startswith("www."):
                    domain = domain[4:]
                if domain:
                    domains.add(domain)

                expiry_raw = (cols[4] or "").strip()
                expiry = 0
                try:
                    expiry = int(expiry_raw)
                except Exception:
                    expiry = 0
                if expiry <= 0 or expiry > now:
                    unexpired += 1
    except Exception:
        return result

    result["domainCoverage"] = sorted(domains)
    result["unexpiredCount"] = unexpired
    return result


def _cookie_integrity_error(cookie_check: Dict[str, Any]) -> Optional[Tuple[str, str]]:
    if not cookie_check.get("hasCookieFile"):
        return None

    platform = cookie_check.get("platform")
    coverage = cookie_check.get("domainCoverage") or []
    unexpired = int(cookie_check.get("unexpiredCount") or 0)
    if unexpired <= 0:
        return "COOKIE_EMPTY_OR_EXPIRED", "Cookie file has no unexpired entries."

    expected_domains = COOKIE_PLATFORM_DOMAINS.get(platform, set())
    if expected_domains:
        has_coverage = any(
            domain == expected or domain.endswith(f".{expected}")
            for domain in coverage
            for expected in expected_domains
        )
        if not has_coverage:
            return (
                "COOKIE_DOMAIN_MISMATCH",
                f"Cookie domains do not match expected platform domains: {', '.join(sorted(expected_domains))}",
            )
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


def _build_http_headers(url: str, user_agent: str, platform: Optional[str], include_reddit_context: bool = False) -> Dict[str, str]:
    headers = {"Accept-Language": "en-US,en;q=0.9"}
    # For TikTok, do not hard-force User-Agent; extractor/impersonation should control it.
    if platform != "tiktok":
        headers["User-Agent"] = user_agent
    host = _extract_host(url)
    parsed = urlparse(url)
    if include_reddit_context and platform == "reddit" and (host.endswith("reddit.com") or host.endswith("redd.it")):
        headers["Referer"] = "https://www.reddit.com/"
        headers["Origin"] = "https://www.reddit.com"
    elif platform is None and parsed.scheme in {"http", "https"} and parsed.netloc:
        # Generic fallback for non-built-in platforms: many tokenized HLS/CDN URLs expect same-site context.
        headers["Referer"] = f"{parsed.scheme}://{parsed.netloc}/"
        headers["Origin"] = f"{parsed.scheme}://{parsed.netloc}"
    return headers


def _is_generic_failure(code: Optional[str], message: Optional[str]) -> bool:
    normalized_code = (code or "").strip()
    normalized_msg = (message or "").strip()
    return normalized_code in GENERIC_FAILURE_CODES and (
        not normalized_msg or normalized_msg == normalized_code
    )


def _should_replace_last_error(
    prev_code: Optional[str],
    prev_message: Optional[str],
    new_code: Optional[str],
    new_message: Optional[str],
) -> bool:
    if prev_code is None:
        return True

    prev_generic = _is_generic_failure(prev_code, prev_message)
    new_generic = _is_generic_failure(new_code, new_message)
    if not prev_generic and new_generic:
        return False
    if prev_generic and not new_generic:
        return True

    # Keep the strongest TikTok classification if we already have it.
    if prev_code == "TIKTOK_API_STATUS_ZERO" and new_code != "TIKTOK_API_STATUS_ZERO":
        return False
    if new_code == "TIKTOK_API_STATUS_ZERO" and prev_code != "TIKTOK_API_STATUS_ZERO":
        return True

    if not new_message and prev_message:
        return False
    return True


class _YdlLogger:
    def __init__(self, debug_logging: bool, strategy: str, attempt_id: str):
        self.debug_logging = debug_logging
        self.strategy = strategy
        self.attempt_id = attempt_id

    def _emit(self, level: str, message: str) -> None:
        if not YTDLP_VERBOSE_DEV:
            return
        msg = _redact_text(str(message or "").strip())
        if not msg:
            return
        _debug_log(
            self.debug_logging,
            f"yt-dlp[{self.strategy}#{self.attempt_id}][{level}] {msg}",
        )

    def debug(self, message: str) -> None:
        self._emit("debug", message)

    def warning(self, message: str) -> None:
        self._emit("warn", message)

    def error(self, message: str) -> None:
        self._emit("error", message)


def _sanitize_opts_for_log(opts: Dict[str, Any]) -> Dict[str, Any]:
    safe = {
        "format": opts.get("format"),
        "cookie": "yes" if opts.get("cookiefile") else "no",
        "ffmpeg_location": opts.get("ffmpeg_location"),
        "extractor_args": opts.get("extractor_args"),
        "impersonate": opts.get("impersonate"),
        "force_generic_extractor": opts.get("force_generic_extractor"),
        "headers": list((opts.get("http_headers") or {}).keys()),
        "noplaylist": opts.get("noplaylist"),
        "retries": opts.get("retries"),
        "hls_prefer_native": opts.get("hls_prefer_native"),
        "external_downloader": opts.get("external_downloader"),
        "abort_on_unavailable_fragments": opts.get("abort_on_unavailable_fragments"),
        "skip_unavailable_fragments": opts.get("skip_unavailable_fragments"),
    }
    return safe


def _common_ydl_opts(
    normalized_url: str,
    platform: Optional[str],
    cookie_file: Optional[str],
    ffmpeg_location: Optional[str],
    user_agent: str,
    extractor_args: Optional[Dict[str, Any]] = None,
    include_reddit_context: bool = False,
    impersonate: Optional[str] = None,
    disable_impersonation: bool = False,
    debug_strategy_label: Optional[str] = None,
    debug_attempt_id: Optional[str] = None,
    debug_logging: bool = False,
) -> Dict[str, Any]:
    headers = _build_http_headers(normalized_url, user_agent, platform, include_reddit_context=include_reddit_context)

    opts: Dict[str, Any] = {
        "quiet": True,
        "no_warnings": True,
        "ignoreconfig": True,
        "noplaylist": True,
        "no_cache_dir": True,
        "extractor_retries": 6,
        "retries": 10,
        "fragment_retries": 10,
        "file_access_retries": 3,
        # Avoid silently producing empty/partial outputs when a site CDN invalidates HLS fragments.
        "abort_on_unavailable_fragments": True,
        "skip_unavailable_fragments": False,
        # Keep output file timestamps at download time so gallery apps sort as latest.
        "updatetime": False,
    }
    if headers:
        opts["http_headers"] = headers

    if cookie_file:
        opts["cookiefile"] = cookie_file

    ffmpeg_binary = _resolve_ffmpeg_binary(ffmpeg_location)
    if ffmpeg_binary:
        opts["ffmpeg_location"] = ffmpeg_binary
    elif ffmpeg_location and os.path.exists(ffmpeg_location):
        opts["ffmpeg_location"] = ffmpeg_location

    if extractor_args:
        opts["extractor_args"] = extractor_args
    if disable_impersonation:
        # Equivalent of --no-impersonate for environments without optional runtime support.
        opts["impersonate"] = False
    elif impersonate:
        opts["impersonate"] = impersonate
    if debug_logging and YTDLP_VERBOSE_DEV and debug_strategy_label and debug_attempt_id:
        opts["logger"] = _YdlLogger(debug_logging, debug_strategy_label, debug_attempt_id)

    _debug_log(debug_logging, f"ydl opts prepared url={normalized_url} opts={_sanitize_opts_for_log(opts)}")

    return opts


def _build_format_selector(max_file_size_mb: int, merge_capable: bool) -> str:
    limit_mb = int(max_file_size_mb)
    unlimited = limit_mb <= 0

    if unlimited:
        if merge_capable:
            return "bestvideo+bestaudio/best"
        return "best[acodec!=none][vcodec!=none]/best"

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


def _extract_info_with_retry(
    ydl: yt_dlp.YoutubeDL,
    url: str,
    *,
    download: bool,
    max_attempts: int = 3,
    debug_logging: bool = False,
    strategy_label: Optional[str] = None,
    attempt_id: Optional[str] = None,
) -> Dict[str, Any]:
    last_exc: Optional[Exception] = None

    for attempt in range(1, max_attempts + 1):
        try:
            _debug_log(
                debug_logging,
                f"extract start strategy={strategy_label or 'single'} attempt={attempt}/{max_attempts} "
                f"download={download} url={url} id={attempt_id or 'n/a'}",
            )
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
            _debug_log(
                debug_logging,
                f"extract retry strategy={strategy_label or 'single'} id={attempt_id or 'n/a'} "
                f"attempt={attempt} backoff={backoff:.2f}s reason={_redact_text(str(exc))}",
            )
            time.sleep(backoff)

    if last_exc:
        raise last_exc
    raise RuntimeError("UNKNOWN_EXTRACTION_ERROR")


def _extract_error_extractor_key(message: str) -> Optional[str]:
    match = re.search(r"\[([A-Za-z0-9_.-]+)\]", message or "")
    if not match:
        return None
    key = match.group(1).strip().lower()
    return key or None


def _classify_exception(exc: Exception, default_code: str, platform: Optional[str] = None) -> Tuple[str, str]:
    message = str(exc) or default_code
    lower = message.lower()

    if _is_impersonation_unavailable_message(lower):
        if "extractor is attempting impersonation" in lower or "none of these impersonate targets are available" in lower:
            return "IMPERSONATION_TARGET_REQUIRED_UNAVAILABLE", message
        if "missing dependencies required" in lower:
            return "IMPERSONATION_DEPENDENCY_MISSING", message
        return "IMPERSONATION_RUNTIME_UNAVAILABLE", message

    if platform == "reddit" and "[generic]" in lower:
        return "REDDIT_EXTRACTOR_ROUTE_FAILED", message

    if "http error 403" in lower and ("blocked" in lower or "forbidden" in lower or "reddit" in lower):
        return "SITE_BLOCKED_403", message

    if platform == "tiktok" and "status code 0" in lower:
        return "TIKTOK_API_STATUS_ZERO", message

    if platform == "tiktok" and ("video not available" in lower or "empty response" in lower):
        return "TIKTOK_EXTRACTOR_UNSTABLE", message

    if (
        "cookie" in lower
        and ("stale" in lower or "expired" in lower or "invalid" in lower or "required" in lower)
    ) or "sign in" in lower or "log in" in lower:
        return "COOKIE_STALE_OR_INVALID", message

    if "ffmpeg is not installed" in lower or "ffprobe is not installed" in lower:
        return "MERGE_DEPENDENCY_MISSING", message

    return default_code, message


def _build_platform_attempts(
    platform: Optional[str],
    normalized_url: str,
    has_cookie: bool,
    cookie_integrity_ok: bool,
    impersonation_available: bool,
) -> List[Dict[str, Any]]:
    attempts: List[Dict[str, Any]] = []
    host = _extract_host(normalized_url)
    is_dailymotion = host in DAILYMOTION_DOMAINS or host.endswith(".dailymotion.com") or host.endswith(".dai.ly")

    if platform == "reddit":
        if has_cookie and cookie_integrity_ok:
            attempts.append(
                {
                    "label": "reddit-cookie-primary",
                    "use_cookie": True,
                    "include_reddit_context": True,
                }
            )
            if impersonation_available:
                attempts.append(
                    {
                        "label": "reddit-cookie-impersonate",
                        "use_cookie": True,
                        "include_reddit_context": True,
                        "extractor_args": {"generic": {"impersonate": ["chrome"]}},
                        "impersonate": "chrome",
                    }
                )

        if ALLOW_REDDIT_PUBLIC_FALLBACK and _is_public_reddit_url(normalized_url):
            guarded_codes: Optional[set[str]] = None
            if has_cookie and cookie_integrity_ok:
                guarded_codes = {"SITE_BLOCKED_403", "COOKIE_STALE_OR_INVALID", "REDDIT_EXTRACTOR_ROUTE_FAILED"}
            anon_attempt: Dict[str, Any] = {
                "label": "reddit-anon-fallback",
                "use_cookie": False,
                "include_reddit_context": True,
                "guarded_for_codes": guarded_codes,
            }
            if impersonation_available:
                anon_attempt["extractor_args"] = {"generic": {"impersonate": ["chrome"]}}
                anon_attempt["impersonate"] = "chrome"
            attempts.append(anon_attempt)
        return attempts

    if platform == "tiktok":
        install_id = _load_or_create_tiktok_install_id()
        device_id = _load_or_create_tiktok_device_id()
        tiktok_targets = IMPERSONATION_TARGET_MATRIX.get("tiktok", [])
        if impersonation_available:
            for target in tiktok_targets:
                if has_cookie and cookie_integrity_ok:
                    attempts.append(
                        {
                            "label": f"tiktok-cookie-impersonate-{target}",
                            "use_cookie": True,
                            "impersonate": target,
                        }
                    )
                attempts.append(
                    {
                        "label": f"tiktok-anon-impersonate-{target}",
                        "use_cookie": False,
                        "impersonate": target,
                    }
                )

        if has_cookie and cookie_integrity_ok:
            attempts.append({"label": "tiktok-base-cookie", "use_cookie": True})

        attempts.append({"label": "tiktok-base-anon", "use_cookie": False})
        for idx, profile in enumerate(TIKTOK_APP_INFO_CANDIDATES):
            app_name, app_version, manifest, aid = profile
            app_info = _build_tiktok_app_info(install_id, app_name, app_version, manifest, aid)
            api_hostname = TIKTOK_API_HOSTNAME_CANDIDATES[idx % len(TIKTOK_API_HOSTNAME_CANDIDATES)]
            attempts.append(
                {
                    "label": f"tiktok-appinfo-{idx+1}",
                    "use_cookie": has_cookie and cookie_integrity_ok,
                    "extractor_args": {
                        "tiktok": {
                            "app_info": [app_info],
                            "device_id": [device_id],
                            "api_hostname": [api_hostname],
                        }
                    },
                }
            )
        attempts.append(
            {
                "label": "tiktok-deviceid",
                "use_cookie": has_cookie and cookie_integrity_ok,
                "extractor_args": {
                    "tiktok": {
                        "device_id": [device_id],
                        "api_hostname": [TIKTOK_API_HOSTNAME_CANDIDATES[0]],
                    }
                },
            }
        )
        # API-style anonymous fallback with minimal args can recover when cookie/session is noisy.
        attempts.append(
            {
                "label": "tiktok-appinfo-anon-fallback",
                "use_cookie": False,
                "extractor_args": {
                    "tiktok": {
                        "app_info": [install_id],
                        "device_id": [device_id],
                        "api_hostname": [TIKTOK_API_HOSTNAME_CANDIDATES[0]],
                    }
                },
            }
        )
        if impersonation_available:
            attempts.append(
                {
                    "label": "tiktok-generic-impersonate",
                    "use_cookie": False,
                    "impersonate": "chrome",
                    "force_generic_extractor": True,
                }
            )
        return attempts

    if is_dailymotion:
        dailymotion_targets = IMPERSONATION_TARGET_MATRIX.get("dailymotion", [])
        if impersonation_available:
            for target in dailymotion_targets:
                attempts.append(
                    {
                        "label": f"dailymotion-impersonate-{target}",
                        "use_cookie": has_cookie and cookie_integrity_ok,
                        "impersonate": target,
                        "extractor_args": {"dailymotion": {"impersonate": [target]}},
                    }
                )
                attempts.append(
                    {
                        "label": f"dailymotion-anon-impersonate-{target}",
                        "use_cookie": False,
                        "impersonate": target,
                        "extractor_args": {"dailymotion": {"impersonate": [target]}},
                    }
                )
        attempts.append(
            {
                "label": "dailymotion-no-impersonate",
                "use_cookie": has_cookie and cookie_integrity_ok,
                "extractor_args": {"dailymotion": {"impersonate": ["false"]}},
            }
        )
        return attempts

    if platform is None:
        cookie_modes = [True, False] if has_cookie and cookie_integrity_ok else [False]
        for use_cookie in cookie_modes:
            prefix = "cookie" if use_cookie else "anon"

            attempts.append(
                {
                    "label": f"generic-{prefix}-progressive",
                    "use_cookie": use_cookie,
                    "format_override": "best[acodec!=none][vcodec!=none][protocol!*=m3u8]/best[protocol!*=m3u8]/best",
                    "ydl_overrides": {
                        "abort_on_unavailable_fragments": True,
                        "skip_unavailable_fragments": False,
                    },
                }
            )

            if impersonation_available:
                attempts.append(
                    {
                        "label": f"generic-{prefix}-progressive-impersonate-chrome",
                        "use_cookie": use_cookie,
                        "impersonate": "chrome",
                        "format_override": "best[acodec!=none][vcodec!=none][protocol!*=m3u8]/best[protocol!*=m3u8]/best",
                        "ydl_overrides": {
                            "abort_on_unavailable_fragments": True,
                            "skip_unavailable_fragments": False,
                        },
                    }
                )

            attempts.append(
                {
                    "label": f"generic-{prefix}-default",
                    "use_cookie": use_cookie,
                }
            )

            attempts.append(
                {
                    "label": f"generic-{prefix}-hls-ffmpeg-strict",
                    "use_cookie": use_cookie,
                    "ydl_overrides": {
                        "hls_prefer_native": False,
                        "external_downloader": "ffmpeg",
                        "abort_on_unavailable_fragments": True,
                        "skip_unavailable_fragments": False,
                    },
                }
            )
        return attempts

    attempts.append({"label": "default-primary", "use_cookie": has_cookie and cookie_integrity_ok})
    if not impersonation_available:
        attempts.append(
            {
                "label": "default-no-impersonate",
                "use_cookie": has_cookie and cookie_integrity_ok,
                "extractor_args": IMPERSONATION_DISABLE_EXTRACTOR_ARGS,
            }
        )
        attempts.append(
            {
                "label": "default-generic-no-impersonate",
                "use_cookie": has_cookie and cookie_integrity_ok,
                "extractor_args": IMPERSONATION_DISABLE_EXTRACTOR_ARGS,
                "force_generic_extractor": True,
            }
        )
    return attempts


def _load_or_create_tiktok_device_id() -> str:
    runtime_dir = os.path.join(os.path.expanduser("~"), ".arsivinyo_local_runtime")
    os.makedirs(runtime_dir, exist_ok=True)
    file_path = os.path.join(runtime_dir, "tiktok_device_id.txt")
    try:
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                existing = f.read().strip()
            if existing.isdigit() and len(existing) >= 10:
                return existing
    except Exception:
        pass

    device_id = str(random.randint(10**18, 10**19 - 1))
    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(device_id)
    except Exception:
        pass
    return device_id


def _load_or_create_tiktok_install_id() -> str:
    runtime_dir = os.path.join(os.path.expanduser("~"), ".arsivinyo_local_runtime")
    os.makedirs(runtime_dir, exist_ok=True)
    file_path = os.path.join(runtime_dir, "tiktok_install_id.txt")
    try:
        if os.path.exists(file_path):
            with open(file_path, "r", encoding="utf-8") as f:
                existing = f.read().strip()
            if existing.isdigit() and len(existing) >= 10:
                return existing
    except Exception:
        pass

    install_id = str(random.randint(10**18, 10**19 - 1))
    try:
        with open(file_path, "w", encoding="utf-8") as f:
            f.write(install_id)
    except Exception:
        pass
    return install_id


def _build_tiktok_app_info(install_id: str, app_name: str, app_version: str, manifest: str, aid: str) -> str:
    return f"{install_id}/{app_name}/{app_version}/{manifest}/{aid}"


def _perform_attempts(
    *,
    phase: str,
    normalized_url: str,
    platform: Optional[str],
    attempts: List[Dict[str, Any]],
    selected_cookie_file: Optional[str],
    ffmpeg_location: Optional[str],
    user_agent: str,
    download: bool,
    max_file_size_mb: int,
    merge_capable: bool,
    impersonation_available: bool,
    output_dir: Optional[str] = None,
    progress_hooks: Optional[List[Any]] = None,
    debug_logging: bool = False,
) -> Tuple[Optional[Dict[str, Any]], Optional[str], Optional[str], Optional[str]]:
    last_error_code: Optional[str] = None
    last_error_message: Optional[str] = None
    last_strategy: Optional[str] = None
    for index, strategy in enumerate(attempts, start=1):
        guarded_codes = strategy.get("guarded_for_codes")
        if guarded_codes and last_error_code not in guarded_codes:
            continue

        attempt_id = str(uuid.uuid4())[:8]
        use_cookie = bool(strategy.get("use_cookie")) and bool(selected_cookie_file)
        active_cookie = selected_cookie_file if use_cookie else None
        label = strategy.get("label", f"{platform or 'generic'}-{index}")
        extractor_args = strategy.get("extractor_args")
        impersonate = strategy.get("impersonate")
        disable_impersonation = not impersonation_available
        if not impersonation_available:
            extractor_args = _merge_extractor_args(extractor_args, IMPERSONATION_DISABLE_EXTRACTOR_ARGS)
            impersonate = None
        include_reddit_context = bool(strategy.get("include_reddit_context", False))
        force_generic_extractor = bool(strategy.get("force_generic_extractor", False))
        ydl_overrides = strategy.get("ydl_overrides") or {}
        format_override = strategy.get("format_override")
        last_strategy = label
        _set_runtime_diag("platformStrategyLast", label)

        opts = _common_ydl_opts(
            normalized_url,
            platform,
            active_cookie,
            ffmpeg_location,
            user_agent,
            extractor_args=extractor_args,
            include_reddit_context=include_reddit_context,
            impersonate=impersonate,
            disable_impersonation=disable_impersonation,
            debug_strategy_label=label,
            debug_attempt_id=attempt_id,
            debug_logging=debug_logging,
        )
        opts["format"] = format_override or _build_format_selector(max_file_size_mb, merge_capable)
        if merge_capable:
            opts["merge_output_format"] = "mp4"
        if ydl_overrides:
            opts.update(ydl_overrides)
        if output_dir:
            opts["outtmpl"] = os.path.join(output_dir, "%(title)s.%(ext)s")
        if progress_hooks:
            opts["progress_hooks"] = progress_hooks
        if force_generic_extractor:
            opts["force_generic_extractor"] = True

        _append_diag_target(impersonate)

        _push_attempt_trace(
            {
                "timeMs": _now_ms(),
                "phase": phase,
                "attemptId": attempt_id,
                "strategy": label,
                "url": normalized_url,
                "platform": platform,
                "cookieUsed": bool(active_cookie),
                "retryIndex": index,
                "extractorArgs": extractor_args or {},
                "impersonate": impersonate,
                "forceGenericExtractor": force_generic_extractor,
                "format": opts.get("format"),
            }
        )

        try:
            with yt_dlp.YoutubeDL(opts) as ydl:
                info = _extract_info_with_retry(
                    ydl,
                    normalized_url,
                    download=download,
                    debug_logging=debug_logging,
                    strategy_label=label,
                    attempt_id=attempt_id,
                )
                if "entries" in info and info["entries"]:
                    info = info["entries"][0]
                if download:
                    downloaded_file = _resolve_downloaded_file(info, output_dir)
                    if not downloaded_file or not os.path.exists(downloaded_file):
                        raise RuntimeError("Download finished but output file could not be found")
                    if os.path.getsize(downloaded_file) <= 0:
                        raise RuntimeError("The downloaded file is empty")
                _set_runtime_diag("lastExtractorKey", info.get("extractor_key"))
                if impersonate:
                    _set_runtime_diag("impersonationResolvedTargetLast", impersonate)
                    _debug_log(debug_logging, f"IMP_TARGET_SELECTED target={impersonate} strategy={label}")
                _push_attempt_trace(
                    {
                        "timeMs": _now_ms(),
                        "phase": phase,
                        "attemptId": attempt_id,
                        "strategy": label,
                        "status": "success",
                        "extractorKey": info.get("extractor_key"),
                    }
                )
                return info, None, None, label
        except Exception as exc:
            code, message = _classify_exception(exc, "PREFLIGHT_FAILED" if phase == "preflight" else "DOWNLOAD_FAILED", platform=platform)
            if _is_impersonation_unavailable_message(message):
                required_extractor = _extract_error_extractor_key(message)
                required_targets = _extract_required_targets_from_message(message)
                if required_extractor:
                    _set_runtime_diag("impersonationRequiredByExtractorLast", required_extractor)
                    _debug_log(debug_logging, f"IMP_TARGET_REQUIRED extractor={required_extractor} targets={required_targets}")
                if code in {"IMPERSONATION_DEPENDENCY_MISSING", "IMPERSONATION_RUNTIME_UNAVAILABLE", "IMPERSONATION_BOOTSTRAP_FAILED"}:
                    _set_runtime_diag("impersonationRuntimeAvailable", False)
                    _set_runtime_diag("impersonationEnabled", False)
                # Some extractors force impersonation (for example dailymotion: firefox).
                # Retry once with explicit per-extractor no-impersonate args before failing.
                forced_args: Dict[str, Dict[str, List[str]]] = dict(IMPERSONATION_DISABLE_EXTRACTOR_ARGS)
                extractor_key = required_extractor
                if extractor_key:
                    forced_args[extractor_key] = {"impersonate": ["false"]}

                retry_id = str(uuid.uuid4())[:8]
                retry_label = f"{label}-no-impersonate-retry"
                retry_extractor_args = _merge_extractor_args(extractor_args, forced_args)
                retry_opts = _common_ydl_opts(
                    normalized_url,
                    platform,
                    active_cookie,
                    ffmpeg_location,
                    user_agent,
                    extractor_args=retry_extractor_args,
                    include_reddit_context=include_reddit_context,
                    impersonate=None,
                    disable_impersonation=True,
                    debug_strategy_label=retry_label,
                    debug_attempt_id=retry_id,
                    debug_logging=debug_logging,
                )
                retry_opts["format"] = format_override or _build_format_selector(max_file_size_mb, merge_capable)
                if merge_capable:
                    retry_opts["merge_output_format"] = "mp4"
                if ydl_overrides:
                    retry_opts.update(ydl_overrides)
                if output_dir:
                    retry_opts["outtmpl"] = os.path.join(output_dir, "%(title)s.%(ext)s")
                if progress_hooks:
                    retry_opts["progress_hooks"] = progress_hooks
                if force_generic_extractor:
                    retry_opts["force_generic_extractor"] = True

                _push_attempt_trace(
                    {
                        "timeMs": _now_ms(),
                        "phase": phase,
                        "attemptId": retry_id,
                        "strategy": retry_label,
                        "url": normalized_url,
                        "platform": platform,
                        "cookieUsed": bool(active_cookie),
                        "retryIndex": index,
                        "extractorArgs": retry_extractor_args or {},
                        "impersonate": None,
                        "forceGenericExtractor": force_generic_extractor,
                    }
                )

                try:
                    with yt_dlp.YoutubeDL(retry_opts) as ydl:
                        retry_info = _extract_info_with_retry(
                            ydl,
                            normalized_url,
                            download=download,
                            debug_logging=debug_logging,
                            strategy_label=retry_label,
                            attempt_id=retry_id,
                        )
                        if "entries" in retry_info and retry_info["entries"]:
                            retry_info = retry_info["entries"][0]
                        _set_runtime_diag("lastExtractorKey", retry_info.get("extractor_key"))
                        _set_runtime_diag("platformStrategyLast", retry_label)
                        _set_runtime_diag("impersonationResolvedTargetLast", None)
                        _push_attempt_trace(
                            {
                                "timeMs": _now_ms(),
                                "phase": phase,
                                "attemptId": retry_id,
                                "strategy": retry_label,
                                "status": "success",
                                "extractorKey": retry_info.get("extractor_key"),
                            }
                        )
                        return retry_info, None, None, retry_label
                except Exception as retry_exc:
                    code, message = _classify_exception(
                        retry_exc,
                        "PREFLIGHT_FAILED" if phase == "preflight" else "DOWNLOAD_FAILED",
                        platform=platform,
                    )
                    if _is_impersonation_unavailable_message(message) and required_extractor:
                        _set_runtime_diag("impersonationRequiredByExtractorLast", required_extractor)
            redacted = _redact_text(message)
            _set_runtime_diag("lastRawYtDlpError", redacted)
            _push_attempt_trace(
                {
                    "timeMs": _now_ms(),
                    "phase": phase,
                    "attemptId": attempt_id,
                    "strategy": label,
                    "status": "failure",
                    "errorCode": code,
                    "errorMessage": redacted,
                }
            )
            if _should_replace_last_error(last_error_code, last_error_message, code, message):
                last_error_code = code
                last_error_message = message

    return None, last_error_code, last_error_message, last_strategy


def _sanitize_filename(name: str) -> str:
    name = re.sub(r"[^a-zA-Z0-9._-]", "_", name).strip("._")
    return name[:200] if name else "download"


def _resolve_downloaded_file(info: Dict[str, Any], output_dir: Optional[str]) -> Optional[str]:
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

    if not downloaded_file and output_dir:
        candidate = os.path.join(output_dir, f"{_sanitize_filename(info.get('title') or 'download')}.{info.get('ext') or 'mp4'}")
        base, _ = os.path.splitext(candidate)
        mp4_candidate = f"{base}.mp4"
        downloaded_file = mp4_candidate if os.path.exists(mp4_candidate) else candidate

    if downloaded_file and os.path.exists(downloaded_file):
        return downloaded_file
    return None


def _write_progress(progress_file_path: Optional[str], progress_percent: Optional[float], message: str, status: str) -> None:
    if not progress_file_path:
        return
    try:
        payload: Dict[str, Any] = {
            "message": message,
            "status": status,
        }
        if progress_percent is not None:
            payload["progressPercent"] = max(0.0, min(100.0, float(progress_percent)))

        target_dir = os.path.dirname(progress_file_path)
        if target_dir:
            os.makedirs(target_dir, exist_ok=True)
        tmp_path = f"{progress_file_path}.tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(payload, f, ensure_ascii=False)
        os.replace(tmp_path, progress_file_path)
    except Exception:
        # Progress reporting should never fail the download.
        return


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
    max_file_size_mb: int = 0,
    ffmpeg_path: Optional[str] = None,
    cookie_file: Optional[str] = None,
    force_no_cookie: bool = False,
    merge_capable: bool = True,
    user_agent: str = DEFAULT_HTTP_USER_AGENT,
    debug_logging: bool = False,
) -> str:
    try:
        _reset_attempt_trace()
        _debug_log(
            debug_logging,
            f"preflight start url={url} ffmpeg_path={ffmpeg_path} cookie_file={'yes' if cookie_file else 'no'} "
            f"force_no_cookie={force_no_cookie} merge_capable={merge_capable}",
        )
        platform = _detect_cookie_platform(url)
        normalized_url, normalize_error = _normalize_input_url(url, platform, user_agent, debug_logging)
        if normalize_error:
            _set_runtime_diag("normalizedUrlLast", url)
            return _result(False, "REDDIT_SHARE_URL_RESOLUTION_FAILED", f"Could not resolve Reddit share URL: {normalize_error}")
        normalized_url = normalized_url or url
        _set_runtime_diag("normalizedUrlLast", normalized_url)
        platform = _detect_cookie_platform(normalized_url)

        selected_cookie_file = cookie_file if cookie_file and os.path.exists(cookie_file) else None
        if not selected_cookie_file and not force_no_cookie:
            selected_cookie_file = _resolve_cookie_file(cookies_dir, platform, cookie_profile)

        cookie_check = _inspect_cookie_file(selected_cookie_file, platform)
        _set_runtime_diag("lastCookieCheck", cookie_check)
        cookie_issue = _cookie_integrity_error(cookie_check)
        if cookie_issue:
            return _result(False, cookie_issue[0], cookie_issue[1], platform=platform)

        ffmpeg_location = _resolve_ffmpeg_location(ffmpeg_path)
        effective_merge_capable, merge_reason = _resolve_merge_capability(ffmpeg_location, merge_capable, debug_logging)
        impersonation_available = _is_impersonation_runtime_available(debug_logging)

        attempts = _build_platform_attempts(
            platform=platform,
            normalized_url=normalized_url,
            has_cookie=bool(selected_cookie_file),
            cookie_integrity_ok=cookie_issue is None,
            impersonation_available=impersonation_available,
        )
        if platform == "reddit" and not attempts:
            return _result(False, "REDDIT_COOKIE_REQUIRED", "Reddit download requires a valid Reddit cookie profile.")

        info, fail_code, fail_message, strategy = _perform_attempts(
            phase="preflight",
            normalized_url=normalized_url,
            platform=platform,
            attempts=attempts,
            selected_cookie_file=selected_cookie_file,
            ffmpeg_location=ffmpeg_location,
            user_agent=user_agent,
            download=False,
            max_file_size_mb=max_file_size_mb,
            merge_capable=effective_merge_capable,
            impersonation_available=impersonation_available,
            debug_logging=debug_logging,
        )
        if info is None:
            return _result(False, fail_code or "PREFLIGHT_FAILED", fail_message or "Preflight failed", platform=platform)

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
        if max_file_size_mb > 0 and size_mb > 0 and size_mb > max_file_size_mb:
            return _result(
                False,
                "FILE_TOO_LARGE",
                f"File size ({size_mb:.1f}MB) exceeds local limit ({max_file_size_mb}MB)",
                estimated_size_mb=round(size_mb, 1),
                platform=platform,
            )

        extractor_key = str(info.get("extractor_key") or "")
        if platform == "reddit" and extractor_key.lower() == "generic":
            return _result(
                False,
                "REDDIT_EXTRACTOR_ROUTE_FAILED",
                "Reddit URL resolved through generic extractor and remained blocked.",
                platform=platform,
                normalized_url=normalized_url,
            )

        return _result(
            True,
            "PREFLIGHT_OK",
            "Preflight successful",
            estimated_size_mb=round(size_mb, 1) if size_mb > 0 else None,
            platform=platform,
            normalized_url=normalized_url,
            strategy=strategy,
            extractor_key=extractor_key,
        )
    except Exception as exc:
        code, message = _classify_exception(exc, "PREFLIGHT_FAILED", platform=_detect_cookie_platform(url))
        _debug_log(debug_logging, f"preflight exception code={code} message={message}")
        return _result(False, code, message)


def run_download(
    url: str,
    output_dir: str,
    cookies_dir: str,
    cookie_profile: Optional[str] = None,
    max_file_size_mb: int = 0,
    cancel_flag_path: Optional[str] = None,
    progress_file_path: Optional[str] = None,
    ffmpeg_path: Optional[str] = None,
    cookie_file: Optional[str] = None,
    force_no_cookie: bool = False,
    merge_capable: bool = True,
    user_agent: str = DEFAULT_HTTP_USER_AGENT,
    debug_logging: bool = False,
) -> str:
    try:
        _reset_attempt_trace()
        _debug_log(
            debug_logging,
            f"download start url={url} output_dir={output_dir} ffmpeg_path={ffmpeg_path} "
            f"cookie_file={'yes' if cookie_file else 'no'} force_no_cookie={force_no_cookie} merge_capable={merge_capable}",
        )
        _write_progress(progress_file_path, 0.0, "Preparing download", "starting")
        if _is_cancel_requested(cancel_flag_path):
            return _result(False, "DOWNLOAD_CANCELLED", "Cancellation requested")

        platform = _detect_cookie_platform(url)
        normalized_url, normalize_error = _normalize_input_url(url, platform, user_agent, debug_logging)
        if normalize_error:
            _set_runtime_diag("normalizedUrlLast", url)
            return _result(False, "REDDIT_SHARE_URL_RESOLUTION_FAILED", f"Could not resolve Reddit share URL: {normalize_error}")
        normalized_url = normalized_url or url
        _set_runtime_diag("normalizedUrlLast", normalized_url)
        platform = _detect_cookie_platform(normalized_url)

        selected_cookie_file = cookie_file if cookie_file and os.path.exists(cookie_file) else None
        if not selected_cookie_file and not force_no_cookie:
            selected_cookie_file = _resolve_cookie_file(cookies_dir, platform, cookie_profile)

        cookie_check = _inspect_cookie_file(selected_cookie_file, platform)
        _set_runtime_diag("lastCookieCheck", cookie_check)
        cookie_issue = _cookie_integrity_error(cookie_check)
        if cookie_issue:
            return _result(False, cookie_issue[0], cookie_issue[1], platform=platform)

        os.makedirs(output_dir, exist_ok=True)

        ffmpeg_location = _resolve_ffmpeg_location(ffmpeg_path)
        effective_merge_capable, merge_reason = _resolve_merge_capability(ffmpeg_location, merge_capable, debug_logging)
        impersonation_available = _is_impersonation_runtime_available(debug_logging)

        attempts = _build_platform_attempts(
            platform=platform,
            normalized_url=normalized_url,
            has_cookie=bool(selected_cookie_file),
            cookie_integrity_ok=cookie_issue is None,
            impersonation_available=impersonation_available,
        )
        if platform == "reddit" and not attempts:
            return _result(False, "REDDIT_COOKIE_REQUIRED", "Reddit download requires a valid Reddit cookie profile.")

        def _progress_hook(progress: Dict[str, Any]) -> None:
            if _is_cancel_requested(cancel_flag_path):
                raise RuntimeError("DOWNLOAD_CANCELLED")
            status = str(progress.get("status") or "").lower()
            if status == "downloading":
                percent: Optional[float] = None
                downloaded = progress.get("downloaded_bytes")
                total = progress.get("total_bytes") or progress.get("total_bytes_estimate")
                try:
                    if isinstance(downloaded, (int, float)) and isinstance(total, (int, float)) and float(total) > 0:
                        percent = (float(downloaded) / float(total)) * 100.0
                    else:
                        percent_str = str(progress.get("_percent_str") or "").strip().replace("%", "")
                        if percent_str:
                            percent = float(percent_str)
                except (TypeError, ValueError):
                    percent = None
                if percent is not None:
                    _write_progress(progress_file_path, percent, "Downloading media", "downloading")
            elif status == "finished":
                _write_progress(progress_file_path, 99.0, "Processing media", "processing")

        preflight_info, preflight_fail_code, preflight_fail_message, preflight_strategy = _perform_attempts(
            phase="preflight",
            normalized_url=normalized_url,
            platform=platform,
            attempts=attempts,
            selected_cookie_file=selected_cookie_file,
            ffmpeg_location=ffmpeg_location,
            user_agent=user_agent,
            download=False,
            max_file_size_mb=max_file_size_mb,
            merge_capable=effective_merge_capable,
            impersonation_available=impersonation_available,
            debug_logging=debug_logging,
        )
        if _is_cancel_requested(cancel_flag_path):
            return _result(False, "DOWNLOAD_CANCELLED", "Cancellation requested")
        if preflight_info is None:
            return _result(
                False,
                preflight_fail_code or "DOWNLOAD_FAILED",
                preflight_fail_message or "Download preflight failed",
                platform=platform,
            )

        info = preflight_info

        if not effective_merge_capable and not _has_progressive_format(info):
            _debug_log(debug_logging, "download failed: no progressive format and merge unavailable")
            return _result(
                False,
                "MERGE_DEPENDENCY_MISSING",
                merge_reason
                or "This media requires stream merge but ffmpeg/ffprobe merge runtime is unavailable.",
            )

        estimated_mb, _ = _estimate_file_size_mb(info)
        if max_file_size_mb > 0 and estimated_mb > 0 and estimated_mb > max_file_size_mb:
            return _result(
                False,
                "FILE_TOO_LARGE",
                f"File size ({estimated_mb:.1f}MB) exceeds local limit ({max_file_size_mb}MB)",
                estimated_size_mb=round(estimated_mb, 1),
            )

        if _is_cancel_requested(cancel_flag_path):
            return _result(False, "DOWNLOAD_CANCELLED", "Cancellation requested")

        info, download_fail_code, download_fail_message, download_strategy = _perform_attempts(
            phase="download",
            normalized_url=normalized_url,
            platform=platform,
            attempts=attempts,
            selected_cookie_file=selected_cookie_file,
            ffmpeg_location=ffmpeg_location,
            user_agent=user_agent,
            download=True,
            max_file_size_mb=max_file_size_mb,
            merge_capable=effective_merge_capable,
            impersonation_available=impersonation_available,
            output_dir=output_dir,
            progress_hooks=[_progress_hook],
            debug_logging=debug_logging,
        )
        if _is_cancel_requested(cancel_flag_path):
            return _result(False, "DOWNLOAD_CANCELLED", "Cancellation requested")
        if info is None:
            return _result(
                False,
                download_fail_code or "DOWNLOAD_FAILED",
                download_fail_message or "Download failed",
                platform=platform,
            )

        if _is_cancel_requested(cancel_flag_path):
            return _result(False, "DOWNLOAD_CANCELLED", "Cancellation requested")

        downloaded_file = _resolve_downloaded_file(info, output_dir)
        if not downloaded_file:
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
        _write_progress(progress_file_path, 100.0, "Completed", "completed")
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
            normalized_url=normalized_url,
            preflight_strategy=preflight_strategy,
            strategy=download_strategy,
            extractor_key=info.get("extractor_key"),
        )
    except Exception as exc:
        if "DOWNLOAD_CANCELLED" in str(exc):
            return _result(False, "DOWNLOAD_CANCELLED", "Cancellation requested")

        code, message = _classify_exception(exc, "DOWNLOAD_FAILED", platform=_detect_cookie_platform(url))
        _debug_log(debug_logging, f"download exception code={code} message={message}")
        return _result(False, code, message)

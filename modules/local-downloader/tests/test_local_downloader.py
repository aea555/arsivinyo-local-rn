import os
import importlib
import json
import tempfile
import unittest
import unittest.mock
import time

try:
    import sys
    from pathlib import Path

    python_src = Path(__file__).resolve().parent.parent / "android" / "src" / "main" / "python"
    sys.path.insert(0, str(python_src))
    import local_downloader as ld
except Exception:  # pragma: no cover
    ld = None

try:
    import sys
    from pathlib import Path

    python_src = Path(__file__).resolve().parent.parent / "android" / "src" / "main" / "python"
    sys.path.insert(0, str(python_src))
    import yt_dlp_override_bootstrap as yb
except Exception:  # pragma: no cover
    yb = None


def _write_fake_ytdlp_package(root, version):
    package_dir = os.path.join(root, "yt_dlp")
    os.makedirs(package_dir, exist_ok=True)
    with open(os.path.join(package_dir, "__init__.py"), "w", encoding="utf-8") as f:
        f.write("")
    with open(os.path.join(package_dir, "version.py"), "w", encoding="utf-8") as f:
        f.write(f'__version__ = "{version}"\n')


@unittest.skipIf(yb is None, "yt_dlp override bootstrap unavailable in this environment")
class YtDlpOverrideBootstrapTests(unittest.TestCase):
    def tearDown(self):
        yb._clear_ytdlp_modules()

    def test_pending_override_promotes_to_active(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundled = os.path.join(tmp, "bundled")
            override_root = os.path.join(tmp, "overrides")
            version_dir = os.path.join(override_root, "versions", "2026.3.17")
            manifest_path = os.path.join(override_root, "manifest.json")
            _write_fake_ytdlp_package(bundled, "2026.2.4")
            _write_fake_ytdlp_package(version_dir, "2026.3.17")
            os.makedirs(override_root, exist_ok=True)
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump({"schemaVersion": 1, "pendingVersion": "2026.3.17", "installed": {}}, f)

            sys.path.insert(0, bundled)
            try:
                payload = json.loads(yb.activate(override_root, manifest_path))
            finally:
                sys.path.remove(bundled)

            self.assertEqual(payload["source"], "override")
            self.assertEqual(payload["activeVersion"], "2026.3.17")
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            self.assertEqual(manifest["activeVersion"], "2026.3.17")
            self.assertIsNone(manifest["pendingVersion"])

    def test_pending_override_accepts_zero_padded_runtime_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundled = os.path.join(tmp, "bundled")
            override_root = os.path.join(tmp, "overrides")
            version_dir = os.path.join(override_root, "versions", "2026.3.17")
            manifest_path = os.path.join(override_root, "manifest.json")
            _write_fake_ytdlp_package(bundled, "2026.02.04")
            _write_fake_ytdlp_package(version_dir, "2026.03.17")
            os.makedirs(override_root, exist_ok=True)
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump({"schemaVersion": 1, "pendingVersion": "2026.3.17", "installed": {}}, f)

            sys.path.insert(0, bundled)
            try:
                payload = json.loads(yb.activate(override_root, manifest_path))
            finally:
                sys.path.remove(bundled)

            self.assertEqual(payload["source"], "override")
            self.assertEqual(payload["activeVersion"], "2026.03.17")
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            self.assertEqual(manifest["activeVersion"], "2026.3.17")
            self.assertIsNone(manifest["pendingVersion"])
            self.assertIsNone(manifest["failedVersion"])
            self.assertIsNone(manifest["failedReason"])

    def test_failed_zero_padded_mismatch_is_retried_once(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundled = os.path.join(tmp, "bundled")
            override_root = os.path.join(tmp, "overrides")
            version_dir = os.path.join(override_root, "versions", "2026.3.17")
            manifest_path = os.path.join(override_root, "manifest.json")
            _write_fake_ytdlp_package(bundled, "2026.02.04")
            _write_fake_ytdlp_package(version_dir, "2026.03.17")
            os.makedirs(override_root, exist_ok=True)
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump(
                    {
                        "schemaVersion": 1,
                        "activeVersion": None,
                        "pendingVersion": None,
                        "failedVersion": "2026.3.17",
                        "failedReason": "OVERRIDE_VERSION_MISMATCH:2026.03.17",
                        "installed": {},
                    },
                    f,
                )

            sys.path.insert(0, bundled)
            try:
                payload = json.loads(yb.activate(override_root, manifest_path))
            finally:
                sys.path.remove(bundled)

            self.assertEqual(payload["source"], "override")
            self.assertEqual(payload["activeVersion"], "2026.03.17")
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            self.assertEqual(manifest["activeVersion"], "2026.3.17")
            self.assertIsNone(manifest["pendingVersion"])
            self.assertIsNone(manifest["failedVersion"])
            self.assertIsNone(manifest["failedReason"])

    def test_missing_pending_override_falls_back_to_bundled(self):
        with tempfile.TemporaryDirectory() as tmp:
            bundled = os.path.join(tmp, "bundled")
            override_root = os.path.join(tmp, "overrides")
            manifest_path = os.path.join(override_root, "manifest.json")
            _write_fake_ytdlp_package(bundled, "2026.2.4")
            os.makedirs(override_root, exist_ok=True)
            with open(manifest_path, "w", encoding="utf-8") as f:
                json.dump({"schemaVersion": 1, "pendingVersion": "2026.3.17", "installed": {}}, f)

            sys.path.insert(0, bundled)
            try:
                payload = json.loads(yb.activate(override_root, manifest_path))
            finally:
                sys.path.remove(bundled)

            self.assertEqual(payload["source"], "bundled")
            self.assertEqual(payload["activeVersion"], "2026.2.4")
            with open(manifest_path, "r", encoding="utf-8") as f:
                manifest = json.load(f)
            self.assertIsNone(manifest["pendingVersion"])
            self.assertEqual(manifest["failedVersion"], "2026.3.17")


@unittest.skipIf(ld is None, "local_downloader module unavailable in this environment")
class LocalDownloaderUnitTests(unittest.TestCase):
    def test_build_format_selector_uses_limit(self):
        merged_selector = ld._build_format_selector(50, True)
        progressive_selector = ld._build_format_selector(50, False)
        self.assertIn("<50M", merged_selector)
        self.assertIn("bestvideo+bestaudio", merged_selector)
        self.assertIn("acodec!=none", progressive_selector)

    def test_build_format_selector_unlimited(self):
        merged_selector = ld._build_format_selector(0, True)
        progressive_selector = ld._build_format_selector(0, False)
        self.assertEqual(merged_selector, "bestvideo+bestaudio/best")
        self.assertEqual(progressive_selector, "best[acodec!=none][vcodec!=none]/best")

    def test_build_platform_attempts_youtube_chunk_profiles(self):
        attempts = ld._build_platform_attempts(
            "youtube",
            "https://www.youtube.com/watch?v=abc123",
            has_cookie=True,
            cookie_integrity_ok=True,
            impersonation_available=False,
        )
        labels = [attempt.get("label") for attempt in attempts]
        self.assertEqual(labels[:3], ["youtube-chunk-10m", "youtube-chunk-4m", "youtube-default"])
        self.assertEqual(
            attempts[0].get("ydl_overrides", {}).get("http_chunk_size"),
            ld.YOUTUBE_HTTP_CHUNK_SIZE_PRIMARY,
        )
        self.assertEqual(
            attempts[1].get("ydl_overrides", {}).get("http_chunk_size"),
            ld.YOUTUBE_HTTP_CHUNK_SIZE_FALLBACK,
        )
        self.assertEqual(
            attempts[0].get("ydl_overrides", {}).get("throttledratelimit"),
            ld.YOUTUBE_THROTTLED_RATE_LIMIT,
        )

    def test_should_emit_progress_update_throttles_small_changes(self):
        self.assertFalse(
            ld._should_emit_progress_update(
                current_status="downloading",
                current_percent=10.2,
                now_ms=1400,
                last_status="downloading",
                last_percent=10.0,
                last_emit_ms=1000,
            )
        )
        self.assertTrue(
            ld._should_emit_progress_update(
                current_status="downloading",
                current_percent=10.6,
                now_ms=1400,
                last_status="downloading",
                last_percent=10.0,
                last_emit_ms=1000,
            )
        )
        self.assertTrue(
            ld._should_emit_progress_update(
                current_status="downloading",
                current_percent=10.2,
                now_ms=1600,
                last_status="downloading",
                last_percent=10.0,
                last_emit_ms=1000,
            )
        )
        self.assertTrue(
            ld._should_emit_progress_update(
                current_status="processing",
                current_percent=99.0,
                now_ms=1200,
                last_status="downloading",
                last_percent=98.5,
                last_emit_ms=1100,
            )
        )

    def test_coerce_monotonic_download_percent(self):
        self.assertEqual(ld._coerce_monotonic_download_percent(42.0, None), 42.0)
        self.assertEqual(ld._coerce_monotonic_download_percent(78.0, 80.0), 80.0)
        self.assertEqual(ld._coerce_monotonic_download_percent(102.0, 80.0), 100.0)
        self.assertEqual(ld._coerce_monotonic_download_percent(-3.0, 15.0), 15.0)

    def test_ytdlp_verbose_toggle_from_env(self):
        with unittest.mock.patch.dict(os.environ, {"ARSIVINYO_YTDLP_VERBOSE_DEV": "1"}, clear=False):
            mod = importlib.reload(ld)
            self.assertTrue(mod.YTDLP_VERBOSE_DEV)
        with unittest.mock.patch.dict(os.environ, {"ARSIVINYO_YTDLP_VERBOSE_DEV": "0"}, clear=False):
            mod = importlib.reload(ld)
            self.assertFalse(mod.YTDLP_VERBOSE_DEV)
        importlib.reload(ld)

    def test_failure_classification(self):
        code, _ = ld._classify_exception(Exception("HTTP Error 403: Blocked"), "DOWNLOAD_FAILED")
        self.assertEqual(code, "SITE_BLOCKED_403")

        code, _ = ld._classify_exception(Exception("Please sign in to confirm your age"), "DOWNLOAD_FAILED")
        self.assertEqual(code, "COOKIE_STALE_OR_INVALID")

        code, _ = ld._classify_exception(Exception("ffmpeg is not installed"), "DOWNLOAD_FAILED")
        self.assertEqual(code, "MERGE_DEPENDENCY_MISSING")

        code, _ = ld._classify_exception(
            Exception("ERROR: Unsupported URL: https://example.com/watch/123"),
            "PREFLIGHT_FAILED",
            platform=None,
        )
        self.assertEqual(code, "UNSUPPORTED_PLATFORM")

        code, _ = ld._classify_exception(
            Exception("ERROR: [TikTok] 123: Video not available, status code 0"),
            "PREFLIGHT_FAILED",
            platform="tiktok",
        )
        self.assertEqual(code, "TIKTOK_API_STATUS_ZERO")

        code, _ = ld._classify_exception(
            Exception("ERROR: [generic] Unable to download webpage: HTTP Error 403: Blocked"),
            "PREFLIGHT_FAILED",
            platform="reddit",
        )
        self.assertEqual(code, "REDDIT_EXTRACTOR_ROUTE_FAILED")

        code, _ = ld._classify_exception(
            Exception("ERROR: [generic] Unable to download webpage: HTTP Error 403: Blocked"),
            "PREFLIGHT_FAILED",
            platform="reddit",
            context_url="https://www.reddit.com/r/PublicFreakout/s/YG1awl66Ls",
        )
        self.assertEqual(code, "SITE_BLOCKED_403")

        code, _ = ld._classify_exception(
            Exception("The extractor is attempting impersonation, but none of these impersonate targets are available: firefox"),
            "PREFLIGHT_FAILED",
            platform=None,
        )
        self.assertEqual(code, "IMPERSONATION_TARGET_REQUIRED_UNAVAILABLE")

    def test_extract_required_impersonation_targets(self):
        targets = ld._extract_required_targets_from_message(
            "none of these impersonate targets are available: firefox, chrome."
        )
        self.assertEqual(targets, ["firefox", "chrome"])

    def test_tiktok_url_is_canonicalized_without_tracking_query(self):
        normalized, error = ld._normalize_input_url(
            "https://www.tiktok.com/@sample/video/7612119485763374344?_r=1&_t=ZS-94NO5RAMPOH",
            "tiktok",
            ld.DEFAULT_HTTP_USER_AGENT,
            debug_logging=False,
        )
        self.assertIsNone(error)
        self.assertEqual(
            normalized,
            "https://www.tiktok.com/@sample/video/7612119485763374344",
        )

    def test_reddit_share_soft_fallback_on_403(self):
        share_url = "https://www.reddit.com/r/PublicFreakout/s/YG1awl66Ls"
        with unittest.mock.patch.object(
            ld,
            "_resolve_reddit_share_url",
            return_value=(None, "HTTP Error 403: Blocked"),
        ):
            normalized, error = ld._normalize_input_url(
                share_url,
                "reddit",
                ld.DEFAULT_HTTP_USER_AGENT,
                cookie_file=None,
                debug_logging=False,
            )
        self.assertIsNone(error)
        self.assertEqual(normalized, share_url)
        diag = ld._RUNTIME_DIAGNOSTICS.get("redditShareResolutionLast")
        self.assertEqual(diag.get("mode"), "fallback_original")

    def test_reddit_share_canonicalization_success(self):
        share_url = "https://www.reddit.com/r/PublicFreakout/s/YG1awl66Ls"
        canonical_url = "https://www.reddit.com/r/PublicFreakout/comments/abc123/title/"
        with unittest.mock.patch.object(
            ld,
            "_resolve_reddit_share_url",
            return_value=(canonical_url, None),
        ):
            normalized, error = ld._normalize_input_url(
                share_url,
                "reddit",
                ld.DEFAULT_HTTP_USER_AGENT,
                cookie_file=None,
                debug_logging=False,
            )
        self.assertIsNone(error)
        self.assertEqual(normalized, canonical_url)
        diag = ld._RUNTIME_DIAGNOSTICS.get("redditShareResolutionLast")
        self.assertEqual(diag.get("mode"), "canonicalized")

    def test_reddit_share_non_reddit_redirect_fails(self):
        share_url = "https://www.reddit.com/r/PublicFreakout/s/YG1awl66Ls"
        with unittest.mock.patch.object(
            ld,
            "_resolve_reddit_share_url",
            return_value=("https://example.com/not-reddit", None),
        ):
            normalized, error = ld._normalize_input_url(
                share_url,
                "reddit",
                ld.DEFAULT_HTTP_USER_AGENT,
                cookie_file=None,
                debug_logging=False,
            )
        self.assertIsNone(normalized)
        self.assertIsNotNone(error)
        self.assertIn("resolved host is not reddit", error)

    def test_reddit_share_resolution_receives_cookie_file(self):
        share_url = "https://www.reddit.com/r/PublicFreakout/s/YG1awl66Ls"
        with unittest.mock.patch.object(
            ld,
            "_resolve_reddit_share_url",
            return_value=("https://www.reddit.com/r/PublicFreakout/comments/abc123/title/", None),
        ) as resolver:
            normalized, error = ld._normalize_input_url(
                share_url,
                "reddit",
                ld.DEFAULT_HTTP_USER_AGENT,
                cookie_file="/tmp/runtime_cookie.txt",
                debug_logging=False,
            )
        self.assertIsNone(error)
        self.assertIn("/comments/", normalized)
        self.assertEqual(resolver.call_args.kwargs.get("cookie_file"), "/tmp/runtime_cookie.txt")

    def test_reddit_generic_route_guard_respects_share_fallback(self):
        self.assertTrue(
            ld._should_fail_reddit_generic_route(
                "reddit",
                "https://www.reddit.com/r/PublicFreakout/comments/abc123/title/",
                "generic",
            )
        )
        self.assertFalse(
            ld._should_fail_reddit_generic_route(
                "reddit",
                "https://www.reddit.com/r/PublicFreakout/s/YG1awl66Ls",
                "generic",
            )
        )

    def test_error_replacement_keeps_specific_over_generic(self):
        should_replace = ld._should_replace_last_error(
            "TIKTOK_API_STATUS_ZERO",
            "ERROR: [TikTok] Video not available, status code 0",
            "PREFLIGHT_FAILED",
            "PREFLIGHT_FAILED",
        )
        self.assertFalse(should_replace)

    def test_generic_media_candidate_discovery(self):
        html_blob = """
            <script>
                const src = "https:\\/\\/cdn.example.com\\/video\\/master.m3u8?token=abc";
            </script>
            <video src="/media/fallback.mp4"></video>
        """
        with unittest.mock.patch.object(ld, "_fetch_page_text", return_value=(html_blob, None)):
            candidates = ld._discover_generic_media_candidates(
                "https://example.com/page",
                ld.DEFAULT_HTTP_USER_AGENT,
                debug_logging=False,
            )
        self.assertGreaterEqual(len(candidates), 2)
        self.assertTrue(any(".m3u8" in item for item in candidates))
        self.assertTrue(any(".mp4" in item for item in candidates))

    def test_cancel_requested_detection(self):
        self.assertFalse(ld._is_cancel_requested(None))

        with tempfile.TemporaryDirectory() as tmp:
            flag = os.path.join(tmp, "cancel.flag")
            self.assertFalse(ld._is_cancel_requested(flag))
            with open(flag, "w", encoding="utf-8") as f:
                f.write("cancel")
            self.assertTrue(ld._is_cancel_requested(flag))

    def test_merge_capability_requires_runtime_binaries(self):
        capable, reason = ld._resolve_merge_capability("/tmp/does-not-exist", True)
        self.assertFalse(capable)
        self.assertIsNotNone(reason)
        self.assertIn("missing", reason.lower())

    def test_reddit_headers_include_referer(self):
        headers = ld._build_http_headers(
            "https://www.reddit.com/r/test/comments/abc",
            ld.DEFAULT_HTTP_USER_AGENT,
            "reddit",
            include_reddit_context=True,
        )
        self.assertEqual(headers.get("Referer"), "https://www.reddit.com/")

    def test_cookie_file_integrity_checks(self):
        with tempfile.TemporaryDirectory() as tmp:
            cookie_path = os.path.join(tmp, "cookie.txt")
            now = int(time.time())
            with open(cookie_path, "w", encoding="utf-8") as f:
                f.write("# Netscape HTTP Cookie File\n")
                f.write(f".reddit.com\tTRUE\t/\tTRUE\t{now + 3600}\tsession\tabc\n")

            check = ld._inspect_cookie_file(cookie_path, "reddit")
            self.assertTrue(check["hasCookieFile"])
            self.assertGreater(check["unexpiredCount"], 0)
            self.assertTrue(any(d.endswith("reddit.com") for d in check["domainCoverage"]))
            self.assertIsNone(ld._cookie_integrity_error(check))

            mismatch = ld._inspect_cookie_file(cookie_path, "tiktok")
            code, _ = ld._cookie_integrity_error(mismatch)
            self.assertEqual(code, "COOKIE_DOMAIN_MISMATCH")

    def test_build_cookie_header_from_file(self):
        with tempfile.TemporaryDirectory() as tmp:
            cookie_path = os.path.join(tmp, "cookie.txt")
            now = int(time.time())
            with open(cookie_path, "w", encoding="utf-8") as f:
                f.write("# Netscape HTTP Cookie File\n")
                f.write(f".reddit.com\tTRUE\t/\tTRUE\t{now + 3600}\tsession\tabc\n")
                f.write(f".example.com\tTRUE\t/\tTRUE\t{now + 3600}\tother\tdef\n")

            header, count = ld._build_cookie_header_from_file(cookie_path, "www.reddit.com")
            self.assertEqual(count, 1)
            self.assertEqual(header, "session=abc")


if __name__ == "__main__":
    unittest.main()

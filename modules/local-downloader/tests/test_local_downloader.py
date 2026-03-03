import os
import tempfile
import unittest
import time

try:
    import sys
    from pathlib import Path

    python_src = Path(__file__).resolve().parent.parent / "android" / "src" / "main" / "python"
    sys.path.insert(0, str(python_src))
    import local_downloader as ld
except Exception:  # pragma: no cover
    ld = None


@unittest.skipIf(ld is None, "local_downloader module unavailable in this environment")
class LocalDownloaderUnitTests(unittest.TestCase):
    def test_build_format_selector_uses_limit(self):
        merged_selector = ld._build_format_selector(50, True)
        progressive_selector = ld._build_format_selector(50, False)
        self.assertIn("<50M", merged_selector)
        self.assertIn("bestvideo+bestaudio", merged_selector)
        self.assertIn("acodec!=none", progressive_selector)

    def test_failure_classification(self):
        code, _ = ld._classify_exception(Exception("HTTP Error 403: Blocked"), "DOWNLOAD_FAILED")
        self.assertEqual(code, "SITE_BLOCKED_403")

        code, _ = ld._classify_exception(Exception("Please sign in to confirm your age"), "DOWNLOAD_FAILED")
        self.assertEqual(code, "COOKIE_STALE_OR_INVALID")

        code, _ = ld._classify_exception(Exception("ffmpeg is not installed"), "DOWNLOAD_FAILED")
        self.assertEqual(code, "MERGE_DEPENDENCY_MISSING")

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


if __name__ == "__main__":
    unittest.main()

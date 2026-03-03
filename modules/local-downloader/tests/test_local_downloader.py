import os
import tempfile
import unittest

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
        headers = ld._build_http_headers("https://www.reddit.com/r/test/comments/abc", ld.DEFAULT_HTTP_USER_AGENT)
        self.assertEqual(headers.get("Referer"), "https://www.reddit.com/")


if __name__ == "__main__":
    unittest.main()

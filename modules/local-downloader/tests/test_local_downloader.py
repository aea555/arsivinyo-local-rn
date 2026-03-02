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
        self.assertIn("<50M", ld._build_format_selector(50))
        self.assertIn("<2048M", ld._build_format_selector(2048))

    def test_cancel_requested_detection(self):
        self.assertFalse(ld._is_cancel_requested(None))

        with tempfile.TemporaryDirectory() as tmp:
            flag = os.path.join(tmp, "cancel.flag")
            self.assertFalse(ld._is_cancel_requested(flag))
            with open(flag, "w", encoding="utf-8") as f:
                f.write("cancel")
            self.assertTrue(ld._is_cancel_requested(flag))


if __name__ == "__main__":
    unittest.main()

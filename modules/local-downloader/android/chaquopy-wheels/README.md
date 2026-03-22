# Local Downloader Impersonation Wheels

This directory is for vendored Android wheels used by Chaquopy to enable yt-dlp impersonation support on-device.

## Required ABI coverage

- `arm64-v8a`

Default coverage is `arm64-v8a` only.
Add `x86_64` by providing matching Android wheels and setting `ABI_LIST` / `reactNativeArchitectures` explicitly.

`ABI_LIST` can override this during build/verification when additional ABIs are available.

## Required package

- `curl-cffi` (pinned in `VERSIONS.json`)

## Policy

1. Do not download wheels during app builds.
2. Keep `SHA256SUMS` updated for every wheel file in this directory.
3. Keep `VERSIONS.json` in sync with pinned versions in:
   - `modules/local-downloader/app.plugin.js`
   - `modules/local-downloader/android/src/main/python/local_downloader.py`
4. Run:
   - `bash scripts/verify-impersonation-wheels.sh`
   - `npm run verify:prebuild`
   before release builds.

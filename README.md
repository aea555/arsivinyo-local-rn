# Arsivinyo Local RN

Android-first Expo app that downloads media on-device using a local native module (Kotlin + Python + yt-dlp), with background queueing and private vault support.

This repo is designed for engineers who need to build, modify, and ship their own version from scratch.

## Table of Contents

1. [What This Project Is](#what-this-project-is)
2. [Feature Overview](#feature-overview)
3. [Architecture](#architecture)
4. [Tech Stack and Version Pins](#tech-stack-and-version-pins)
5. [Prerequisites](#prerequisites)
6. [Quick Start (Existing Contributors)](#quick-start-existing-contributors)
7. [Build From Scratch (New Machine)](#build-from-scratch-new-machine)
8. [Required Binary/Wheel Artifacts](#required-binarywheel-artifacts)
9. [Verification Workflow](#verification-workflow)
10. [Common Customization Paths](#common-customization-paths)
11. [Troubleshooting](#troubleshooting)
12. [Security, Privacy, and Legal Notes](#security-privacy-and-legal-notes)

## What This Project Is

`arsivinyo-local-rn` is a React Native (Expo) mobile app where media downloading happens locally on the Android device instead of a remote API backend.

Primary goals:
- Keep UI/UX in React Native.
- Run extraction/download pipeline natively on Android.
- Support protected-platform flows (cookies, impersonation runtime, diagnostics).
- Support long-running background downloads with foreground service notifications.

Current runtime focus:
- Android local downloader path is the main supported runtime.
- iOS/web are not the primary target for downloader behavior in this repository.

## Feature Overview

- On-device media extraction/download through `yt-dlp` (Python runtime via Chaquopy).
- Background download foreground-service flow with sticky notification controls.
- Queueing for quick background downloads.
- Private mode downloads into an app-private vault with gated access.
- In-app private video playback via `expo-video`.
- Cookie profile management (platform-bound and custom-domain).
- Diagnostics screen for runtime health (yt-dlp, FFmpeg, impersonation, cookies, vault).

## Architecture

High-level data flow:

```text
React Native UI (Expo Router screens)
  -> src/api/* wrappers
  -> Expo local module bridge (modules/local-downloader/src/*)
  -> Kotlin module (task orchestration, service, notifications, storage)
  -> Python runtime via Chaquopy (yt-dlp strategies + normalization)
  -> FFmpeg/FFprobe binaries/libraries for merge/remux/probing
```

Important integration points:
- Config plugin: `modules/local-downloader/app.plugin.js`
  - Injects Chaquopy Gradle config, pip installs, ABI filters, manifest entries.
- Python downloader core:
  - `modules/local-downloader/android/src/main/python/local_downloader.py`
- Kotlin native module and background service/controller:
  - `modules/local-downloader/android/src/main/java/expo/modules/localdownloader/LocalDownloaderModule.kt`

## Tech Stack and Version Pins

- Expo SDK: `~54.0.33`
- React Native: `0.81.5`
- Expo Router: `~6.0.23`
- Video playback: `expo-video ~3.0.16`
- Chaquopy Gradle plugin: `15.0.1`
- Python runtime target: `3.11`
- `yt-dlp`: latest stable from PyPI at Android build time
- `curl-cffi` pin (impersonation runtime): `0.14.0`
- Gradle wrapper: `8.14.3`
- Android ABI default for local-downloader pipeline: `arm64-v8a` (`x86_64` is opt-in when matching wheels are available)

Version pin sources that must stay aligned:
- `modules/local-downloader/app.plugin.js`
- `modules/local-downloader/android/chaquopy-wheels/VERSIONS.json`

## Prerequisites

Required:
- Node.js + npm
- Android Studio + Android SDK tooling
- JDK 17+
- Python 3.11 (for local Python tests and wheel build helpers)
- Bash shell utilities (`unzip`, `sha256sum`)

Recommended device/emulator coverage:
- Physical device: `arm64-v8a`
- Emulator: `x86_64`

Notes:
- Expo Go is not enough because this project requires custom native module code.
- Native Android project (`android/`) is generated/maintained through Expo prebuild and plugin injection.

## Quick Start (Existing Contributors)

```bash
npm install
npx expo prebuild --platform android
npx expo run:android
```

If you changed local-downloader plugin/build wiring, run:

```bash
npm run verify:prebuild
```

## Build From Scratch (New Machine)

This is the reproducible path for a clean environment.

1. Install JS dependencies

```bash
npm install
```

2. Prepare required downloader artifacts (see full matrix below):
- FFmpeg/FFprobe native libs in `jniLibs`
- Optional fallback tool binaries in `assets/ffmpeg`
- Chaquopy wheels for impersonation runtime

3. Build/collect wheels (if you maintain your own Chaquopy recipe environment)

```bash
export CHAQUOPY_PYPI_DIR="/absolute/path/to/chaquopy/server/pypi"
npm run build:impersonation-wheels
```

4. Verify wheels

```bash
npm run verify:impersonation-wheels
```

5. Verify prebuild + injected Gradle/manifest + merged native libs

```bash
npm run verify:prebuild
```

6. Run Android app

```bash
npm run android
```

Minimum viable vs recommended:
- Minimum viable: app can compile without impersonation wheels.
- Recommended: keep arm64 wheel coverage complete so impersonation stays enabled on production devices.
- Optional expansion: add x86_64 wheel coverage, then set `reactNativeArchitectures=arm64-v8a,x86_64` for emulator-focused builds.
  - For prebuild-driven setup, use: `LOCAL_DOWNLOADER_ABIS=arm64-v8a,x86_64 npx expo prebuild --clean --platform android --no-install`

## Required Binary/Wheel Artifacts

The downloader stack depends on external binary artifacts not fetched automatically during app build.

| Artifact | Required | ABI(s) | Expected path(s) | Notes |
|---|---|---|---|---|
| `libffmpeg.so` | Yes | `arm64-v8a`, `x86_64` | `modules/local-downloader/android/src/main/jniLibs/<abi>/libffmpeg.so` | Used as primary native runtime FFmpeg binary. |
| `libffprobe.so` | Yes | `arm64-v8a`, `x86_64` | `modules/local-downloader/android/src/main/jniLibs/<abi>/libffprobe.so` | Required for probing/merge capability checks. |
| `ffmpeg` fallback tool | Optional | `arm64-v8a`, `x86_64` | `modules/local-downloader/android/src/main/assets/ffmpeg/<abi>/ffmpeg` | Used only if native-lib runtime path is unavailable. |
| `ffprobe` fallback tool | Optional | `arm64-v8a`, `x86_64` | `modules/local-downloader/android/src/main/assets/ffmpeg/<abi>/ffprobe` | Fallback pair with `ffmpeg`. |
| `curl-cffi` Android wheel | Recommended | `arm64-v8a` (default), `x86_64` (optional) | `modules/local-downloader/android/chaquopy-wheels/curl_cffi-*.whl` | Enables impersonation runtime used by stricter extractors. |
| `SHA256SUMS` | Required (if wheels present) | N/A | `modules/local-downloader/android/chaquopy-wheels/SHA256SUMS` | Must include valid checksums for wheel files. |
| `VERSIONS.json` | Required | N/A | `modules/local-downloader/android/chaquopy-wheels/VERSIONS.json` | Source of truth for ABI coverage + pinned dependency versions. |

ABI alignment rule:
- Plugin/runtime defaults target `arm64-v8a`.
- Enable `x86_64` only when matching Android wheels are present for every impersonation dependency.
- Keep ABI coverage synchronized across:
  - plugin (`app.plugin.js`)
  - verification scripts (`scripts/*impersonation*`, `verify-local-downloader-prebuild.sh`)
  - wheel metadata (`VERSIONS.json`)
  - runtime diagnostics (`local_downloader.py` / diagnostics screen)

## Verification Workflow

Run these before release builds and after native/plugin changes:

```bash
npm run verify:impersonation-wheels
npm run verify:prebuild
npm run test:python
```

What they validate:
- `verify:impersonation-wheels`
  - Required ABI wheel coverage, checksum validity, Android wheel shape.
- `verify:prebuild`
  - Expo prebuild idempotency (runs twice), generated Gradle markers, manifest entries, ABI filters, merged native libs.
- `test:python`
  - Python-side downloader tests under `modules/local-downloader/tests/`.

Why `verify:prebuild` is mandatory after plugin/ABI changes:
- `app.plugin.js` injects generated blocks into Gradle/Manifest.
- A local build can appear to work while generated config drifts.
- The verifier catches drift and missing binary coverage early.

## Common Customization Paths

UI/UX:
- Home, private vault, settings, diagnostics:
  - `app/(tabs)/index.tsx`
  - `app/private-videos.tsx`
  - `app/private-player.tsx`
  - `app/settings.tsx`
  - `app/diagnostics.tsx`

Downloader behavior:
- Python extraction strategy and error mapping:
  - `modules/local-downloader/android/src/main/python/local_downloader.py`
- Kotlin orchestration, background behavior, storage, auth-gated private flows:
  - `modules/local-downloader/android/src/main/java/expo/modules/localdownloader/LocalDownloaderModule.kt`

Type/API surface:
- TS bridge types:
  - `modules/local-downloader/src/LocalDownloader.types.ts`
- JS wrappers:
  - `src/api/localDownloader.ts`
  - `src/api/download.ts`

When you change version pins, update all together:
- `modules/local-downloader/app.plugin.js`
- `modules/local-downloader/android/src/main/python/local_downloader.py`
- `modules/local-downloader/android/chaquopy-wheels/VERSIONS.json`

## Troubleshooting

1. `verify:impersonation-wheels` fails with missing ABI wheel
- Ensure Android-tagged `curl_cffi` wheel exists for default `arm64-v8a`.
- If you enabled `x86_64`, also provide `x86_64` wheel coverage.
- Rebuild wheels and regenerate `SHA256SUMS`.

2. Prebuild verification fails on generated markers
- Run `npx expo prebuild --clean --platform android --no-install`.
- Confirm plugin-generated blocks are present exactly once.

3. FFmpeg runtime unavailable / merge failures
- Verify `libffmpeg.so` and `libffprobe.so` under required ABI directories.
- Check diagnostics screen values for runtime source, ABI, and probe errors.

4. Extraction quality differs by site
- Check cookie profile defaults in Settings.
- Check diagnostics for impersonation runtime availability and attempted targets.

5. Background actions not behaving as expected
- Confirm notification permission granted.
- Check foreground service and receiver entries in generated manifest.

For deeper internal docs:
- `devdocs/API_GUIDE.md`
- `devdocs/VIP_GUIDE.md`

## Security, Privacy, and Legal Notes

- This project handles sensitive user inputs (URLs, cookies, private vault content). Avoid logging sensitive values in production builds.
- Private vault content is app-private and auth-gated in-app; still treat rooted/compromised devices as out-of-scope for full confidentiality guarantees.
- Keep any secrets out of source control (`.env`, keystores, private creds are gitignored).
- Ensure legal compliance for content downloading/distribution in your jurisdiction and target markets.
- If you ship modified FFmpeg binaries, review codec/library licensing obligations.

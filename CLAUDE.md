# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install
npx expo prebuild --platform android      # regenerate native android/ from app.config.js + plugins
npm run android                            # build + run on Android (expo run:android)
npm run start                              # Metro bundler (rarely useful alone; this app needs custom native)
npm run lint                               # expo lint (eslint-config-expo flat)

# Local-downloader native pipeline verification
npm run verify:prebuild                    # MUST run after any change to app.plugin.js or ABI/manifest wiring
npm run verify:impersonation-wheels        # validates curl_cffi wheels + SHA256SUMS + VERSIONS.json
npm run build:impersonation-wheels         # requires CHAQUOPY_PYPI_DIR env var
npm run test:python                        # python3 -m unittest modules/local-downloader/tests/test_local_downloader.py

# Run a single Python test
python3 -m unittest modules.local-downloader.tests.test_local_downloader.<ClassName>.<test_method>
```

Expo Go cannot run this project — the local-downloader native module is required. Always use `expo run:android` (or a custom dev client build).

Optional emulator support: `LOCAL_DOWNLOADER_ABIS=arm64-v8a,x86_64 npx expo prebuild --clean --platform android --no-install` — only valid when matching `x86_64` wheels and FFmpeg `.so`s are present.

## Architecture

This is an Android-first Expo app whose downloader pipeline runs **entirely on-device**. There is no backend. The flow is layered:

```
app/ (Expo Router screens)
  └─> src/api/*           TS wrappers, typed responses, error mapping
       └─> modules/local-downloader/src/   Expo native module bridge (TS)
            └─> ...android/.../LocalDownloaderModule.kt   Kotlin orchestration
                 ├─> DownloadForegroundService.kt          background service + sticky notification
                 ├─> DownloadActionReceiver.kt             notification action intents
                 ├─> QuickDownloadCaptureActivity.kt       share-sheet / clipboard entry
                 ├─> PrivateVaultImportActivity.kt         gated private-vault import
                 └─> Chaquopy → python/local_downloader.py yt-dlp strategies + normalization
                      └─> FFmpeg/FFprobe (jniLibs .so, optional assets/ffmpeg fallback)
```

Cross-cutting things to know before editing:

- **`modules/local-downloader/app.plugin.js` is the source of truth for native wiring.** It injects Chaquopy gradle config, pip targets (`yt-dlp`, `curl-cffi==0.14.0`), ABI filters, the foreground service, the action receiver, and the two activities into the generated `android/` project via tagged `// @generated begin/end ...` blocks. Never hand-edit files under `android/` — they are produced by prebuild and the plugin. After changing the plugin, run `npx expo prebuild --clean --platform android --no-install && npm run verify:prebuild`.

- **ABI coverage is an invariant that spans four locations.** Default ABI is `arm64-v8a`. If you add `x86_64` (or any other), you must update all of: `app.plugin.js` (`DEFAULT_REACT_NATIVE_ARCHITECTURES`), `modules/local-downloader/android/chaquopy-wheels/VERSIONS.json`, the verifier scripts under `scripts/`, and provide matching wheels + FFmpeg `.so` pairs. The verifiers will catch drift.

- **Two FFmpeg runtimes exist by design.** Primary path is `jniLibs/<abi>/libffmpeg.so` + `libffprobe.so` loaded as native libraries. Fallback is `assets/ffmpeg/<abi>/{ffmpeg,ffprobe}` extracted to private storage. The diagnostics screen (`app/diagnostics.tsx`) reports which one is active.

- **Public API surface for the downloader is `src/api/index.ts`.** Screens should not import from `modules/local-downloader/*` directly; go through `src/api/localDownloader.ts` and `src/api/download.ts`. Types live in `src/api/types.ts` and `modules/local-downloader/src/LocalDownloader.types.ts` — keep these aligned with the Kotlin module's exposed functions.

- **Routing is Expo Router with typed routes enabled** (`experiments.typedRoutes: true` in `app.config.js`). Tabs live in `app/(tabs)/`, modal/card screens at `app/*.tsx`. Root layout in `app/_layout.tsx` wires `I18nextProvider` → `ThemeProvider` → `Stack`.

- **Styling is NativeWind (Tailwind for RN).** `global.css` is the entry, configured via `metro.config.js` and `tailwind.config.js`. The path alias `@/*` maps to repo root (see `tsconfig.json`), so imports look like `@/src/components`, `@/global.css`.

- **i18n** is `i18next` + `react-i18next`, initialized in `src/i18n` and provided at root. Translation keys are used throughout screen titles and UI.

- **Private vault flow** is auth-gated inside Kotlin (`LocalDownloaderModule.authenticateLocalPrivateAccess`) before TS can list, decrypt, or stream content via `expo-video`. The vault path is app-private storage.

## Versioning

`app.config.js` is the **single source of truth** for both the app's `version` (string) and `android.versionCode` (integer). `expo prebuild` propagates both into `android/app/build.gradle`. Do not hand-edit the generated `versionCode`/`versionName` in `build.gradle`.

- **Scheme.** SemVer: `MAJOR.MINOR.PATCH`. Prereleases use a `-beta.N` suffix (e.g. `2.1.0-beta.1` → `2.1.0-beta.2` → `2.1.0`).
- **versionCode** is a monotonic integer; bump on every Play Store upload (not every dev build). The initial recalibrated value is `20100`. The scheme is documentation-only — just keep it monotonic.
- **CHANGELOG.md** at the repo root is updated together with every version bump (Keep-a-Changelog format).
- **Git tags** use the `v` prefix (`v2.1.0-beta.1`, `v2.1.0`). Stable releases also get a GitHub release with the changelog entry copy-pasted.
- **In-app surface.** The diagnostics screen displays `version`, `versionCode`, and `channel` (derived: `'beta'` if version contains `-beta.`, else `'stable'`). Read these via `BUILD_CONFIG` from `src/config.ts`.
- **package.json `version`** is kept in sync cosmetically (Expo does not consume it).

## Version-pin coupling

When bumping any of these, update all together (the verifier will not catch every drift):

- `modules/local-downloader/app.plugin.js` — Chaquopy version, Python version, `curl-cffi` pin
- `modules/local-downloader/android/src/main/python/local_downloader.py` — yt-dlp call sites
- `modules/local-downloader/android/chaquopy-wheels/VERSIONS.json` — pinned dependency versions + ABI matrix
- `modules/local-downloader/android/chaquopy-wheels/SHA256SUMS` — regenerate after wheel changes

## Notes from README worth keeping in mind

- `newArchEnabled: true` and `reactCompiler: true` are on (see `app.config.js`).
- A set of Android storage permissions are explicitly **blocked** in `app.config.js` (`READ_EXTERNAL_STORAGE`, `READ_MEDIA_*`, etc.) — the app uses scoped/private storage and `expo-media-library`'s explicit-save flow instead. Don't re-enable these without understanding the privacy posture.
- iOS and web are not supported runtimes for the downloader pipeline. iOS scaffolding exists but the native module is Android-only.

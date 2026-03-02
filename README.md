# Arsivinyo Local RN

Android-first Expo app which keeps Arsivinyo UI/UX while running media downloads on-device (no remote FastAPI server).

## Current Scope

- Android only for local downloads
- Single active download task at a time
- Cookie profile import per platform (YouTube, Instagram, Facebook, X/Twitter, Reddit)
- Local diagnostics screen (hidden in Settings, tap Version 7x)

## Tech Stack

- Expo SDK 54 + Expo Router
- Local Expo module: `modules/local-downloader`
- Kotlin task manager + Python downloader runtime (Chaquopy)
- `yt-dlp` pinned via Android Gradle Python config

## Setup

1. Install dependencies

```bash
npm install
```

2. Generate native Android project with plugins

```bash
npx expo prebuild --platform android
```

3. Build and run on Android device/emulator

```bash
npx expo run:android
```

## Notes

- Expo Go is not sufficient for this app because it requires custom native code.
- For best success on protected platforms, import valid cookie files in Settings.
- FFmpeg binaries are not bundled yet; add them under `modules/local-downloader/android/src/main/assets/ffmpeg/` if needed.

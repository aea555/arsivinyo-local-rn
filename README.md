# Arsivinyo

Media downloading and an encrypted private vault, running **entirely on the device** — no
backend, no remote API. Downloads are routed into an authenticated, AES-encrypted store,
played back without ever writing plaintext to disk, and organised with tags and folders.

Licensed under **GPL-3.0-or-later**.

## What is here

| | |
|---|---|
| [`mobile/`](mobile/) | The Android app — Expo, with a Kotlin native module wrapping yt-dlp and FFmpeg. This is the app that exists today. |
| `desktop/` | The desktop app. Not started. |
| `shared/` | What both apps must agree on, chiefly the device-pairing protocol. |

Each app is self-contained: `mobile/` has its own `package.json`, dependencies and build
scripts, so its commands run from `mobile/` rather than from here.

**Start with [`mobile/README.md`](mobile/README.md)** — it covers the architecture, the
vault internals, the version pins, and how to build the app from scratch on a new machine.

## Status

The Android app is the working product. A desktop app and per-device pairing between the
two are planned but not begun; the layout above exists so they have somewhere to go.

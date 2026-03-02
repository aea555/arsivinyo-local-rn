Place Android ffmpeg binaries in these ABI folders with filename exactly `ffmpeg`:
- arm64-v8a/ffmpeg
- armeabi-v7a/ffmpeg
- x86_64/ffmpeg

The native module extracts ABI-matched binary to app-internal storage and uses it for yt-dlp merge/remux.

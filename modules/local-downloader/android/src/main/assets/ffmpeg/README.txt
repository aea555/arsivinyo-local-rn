Place Android ffmpeg tool binaries in these ABI folders with filenames exactly:
- arm64-v8a/ffmpeg
- arm64-v8a/ffprobe
- armeabi-v7a/ffmpeg
- armeabi-v7a/ffprobe
- x86_64/ffmpeg
- x86_64/ffprobe

The native module extracts ABI-matched tools to app-internal storage and uses them for yt-dlp merge/remux.

# Rebuilding the bundled FFmpeg binaries

The app ships `libffmpeg.so` / `libffprobe.so` (and identical copies under
`assets/ffmpeg/<abi>/`). They are **not** in this repository — they are ~57 MB of build
output. This directory holds the small, irreplaceable part: the changes needed to make
upstream produce them at all.

## Provenance

| | |
|---|---|
| Upstream | [arthenica/ffmpeg-kit](https://github.com/arthenica/ffmpeg-kit) |
| Tag | `v6.0.LTS` |
| Commit | `d6be56d` |
| Licence | LGPL v3 (no `--enable-gpl` in the build) |

Upstream was archived and its prebuilt binaries withdrawn, so treat this patch as the
only reliable route back to a working build.

## Rebuilding

```bash
git clone --depth 1 --branch v6.0.LTS https://github.com/arthenica/ffmpeg-kit.git
cd ffmpeg-kit
git apply /path/to/local-modifications.patch
./android.sh --lts --enable-android-media-codec   # plus whatever ABIs you need
```

Then copy the resulting `ffmpeg` / `ffprobe` into both locations the app expects:

- `modules/local-downloader/android/src/main/jniLibs/<abi>/libffmpeg.so` (primary path,
  loaded from the native library dir)
- `modules/local-downloader/android/src/main/assets/ffmpeg/<abi>/ffmpeg` (fallback path,
  extracted to private storage)

The two copies are byte-identical; see the "Two FFmpeg runtimes" note in CLAUDE.md for
why both exist.

## What the patch changes, and why each matters

**`scripts/android/ffmpeg.sh` — enables the CLI programs.** Upstream builds FFmpeg with
`--disable-programs`, which produces libraries and no executables. This app's whole
architecture depends on *executing* `ffmpeg` and `ffprobe` as child processes, so the
patch swaps that for `--enable-ffmpeg --enable-ffprobe --disable-ffplay`. Without this
single change there is no binary to spawn and the downloader, the audio conversion, and
the preset renderer all have nothing to run.

The same file also switches the build from shared to static libraries
(`--enable-static --disable-shared`), so the programs link into self-contained binaries
rather than depending on separate `.so` files at runtime.

**`android/jni/Android.mk` — unblocks the compile.** Adds
`-Wno-error=single-bit-bitfield-constant-conversion`. Newer NDK Clang promotes that
conversion to an error, which stops the build outright; the flag returns it to a
warning. This is the "doesn't build as-is" fix.

**`android/jni/Application.mk` — new file.** Upstream ships no `Application.mk`; this
supplies the ndk-build settings (`APP_ABI`, `APP_PLATFORM := android-24`,
`APP_STL := none`, optimisation flags). Note it carries a baked-in
`FFMPEG_KIT_BUILD_DATE`, which is cosmetic and safe to update.

**`android/ffmpeg-kit-android-lib/build.gradle` — one blank line.** No functional
effect; captured only so the patch applies cleanly against pristine upstream.

## Feature notes relevant to this app

The resulting build has no `libmp3lame` and no image encoders, which is why audio
downloads target FLAC or M4A rather than MP3, and why cover art is stored as a sidecar
file rather than embedded. It **does** include the FLAC and ALAC encoders and the full
native filter set. See `_apply_audio_postprocessing` in `local_downloader.py`.

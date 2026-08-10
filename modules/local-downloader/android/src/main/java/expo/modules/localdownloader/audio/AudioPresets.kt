package expo.modules.localdownloader.audio

import android.util.Log

/**
 * Kotlin binding for the native audio-preset renderer (`libaudiopresets.so`).
 *
 * The native side takes PARAMETERS, never a preset name. Built-in presets, user-created
 * ones, and any slider adjustments all live in TypeScript and arrive here as a flat
 * `key=value;` spec, so adding or editing a preset never requires a native change.
 *
 * Rendering decodes the source with the bundled ffmpeg into raw float PCM, runs the DSP
 * in native code, and pipes the result into a second ffmpeg that writes the final file.
 * The DSP owns the sound; ffmpeg is used only for container and codec work.
 *
 * Every call blocks for the length of the render, so callers must be off the main
 * thread. A five-minute track is a few seconds of work.
 */
object AudioPresets {

  /**
   * Whether the native library loaded. False on a device whose ABI we did not build
   * for, in which case the whole preset feature degrades instead of crashing.
   */
  @JvmStatic
  val isAvailable: Boolean = try {
    System.loadLibrary("audiopresets")
    true
  } catch (e: UnsatisfiedLinkError) {
    Log.w(TAG, "libaudiopresets.so unavailable: ${e.message}")
    false
  }

  /** Native library identifier, for the diagnostics screen. Null when unavailable. */
  @JvmStatic
  fun version(): String? = if (isAvailable) runCatching { nativeVersion() }.getOrNull() else null

  /**
   * Render [inputPath] through the preset described by [paramsSpec] into [outputPath].
   *
   * @param outputFormat `"flac"` (lossless, the default) or `"m4a"`.
   * @param progressFilePath optional; native rewrites `{"percent":N}` here as it works.
   * @param cancelFlagPath optional; creating that file aborts the render and removes
   *   any partial output.
   * @return null on success, or a message describing the failure.
   */
  @JvmStatic
  fun applyPreset(
    ffmpegPath: String,
    ffprobePath: String,
    inputPath: String,
    outputPath: String,
    paramsSpec: String,
    outputFormat: String = FORMAT_FLAC,
    title: String? = null,
    artist: String? = null,
    progressFilePath: String? = null,
    cancelFlagPath: String? = null,
  ): String? {
    if (!isAvailable) return ERR_NATIVE_UNAVAILABLE
    return try {
      nativeApplyPreset(
        ffmpegPath,
        ffprobePath,
        inputPath,
        outputPath,
        paramsSpec,
        if (outputFormat == FORMAT_M4A) FORMAT_M4A else FORMAT_FLAC,
        title,
        artist,
        progressFilePath,
        cancelFlagPath,
      )
    } catch (e: Throwable) {
      // A native crash must surface as a failed render, not take the app down.
      Log.e(TAG, "applyPreset threw", e)
      e.message ?: ERR_RENDER_FAILED
    }
  }

  // NOT @JvmStatic. On a Kotlin `object`, a private @JvmStatic external fun is
  // ambiguous about whether the native method binds as a static or an instance method,
  // which shows up only at runtime as UnsatisfiedLinkError. Declared plainly, these
  // bind as instance methods of the object and the C++ side takes a jobject to match.
  // The exported symbol name is the same either way.
  private external fun nativeApplyPreset(
    ffmpegPath: String,
    ffprobePath: String,
    inputPath: String,
    outputPath: String,
    paramsSpec: String,
    outputFormat: String,
    title: String?,
    artist: String?,
    progressFilePath: String?,
    cancelFlagPath: String?,
  ): String?

  private external fun nativeVersion(): String

  const val FORMAT_FLAC = "flac"
  const val FORMAT_M4A = "m4a"
  const val ERR_NATIVE_UNAVAILABLE = "AUDIO_PRESETS_NATIVE_UNAVAILABLE"
  const val ERR_RENDER_FAILED = "AUDIO_PRESET_RENDER_FAILED"
  private const val TAG = "AudioPresets"
}

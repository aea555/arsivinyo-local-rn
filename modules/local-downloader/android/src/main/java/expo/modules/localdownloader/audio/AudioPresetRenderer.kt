package expo.modules.localdownloader.audio

import android.content.Context
import android.net.Uri
import android.util.Log
import expo.modules.localdownloader.sounds.SoundsStore
import java.io.BufferedOutputStream
import java.io.File
import java.io.IOException
import java.util.UUID

/**
 * Applies an audio preset to a library track and files the result as a new entry.
 *
 * The source track is never modified. A render therefore stays reversible (delete the
 * result) and can always be redone from the original, which is why renders are never
 * chained on top of one another.
 *
 * Output quality tier mirrors the source: a lossless source produces 16-bit FLAC with
 * dither, a lossy one produces AAC. See [outputFormatFor].
 */
class AudioPresetRenderer(
  private val context: Context,
  private val soundsStore: SoundsStore,
) {

  data class Request(
    val songId: String,
    val presetId: String,
    val paramsSpec: String,
    /** Appended to the source title, e.g. " (Slowed + Reverb)". */
    val titleSuffix: String,
    val ffmpegPath: String,
    val ffprobePath: String,
    val progressFilePath: String? = null,
    val cancelFlagPath: String? = null,
  )

  /**
   * Render one track. Blocks for the length of the render, so callers must be off the
   * main thread. Throws [IllegalStateException] with a diagnosable message on failure.
   */
  fun render(request: Request): Map<String, Any?> {
    val song = soundsStore.findSong(request.songId)
      ?: throw IllegalStateException(ERR_SOURCE_NOT_FOUND)

    val fileName = song["fileName"] as? String ?: throw IllegalStateException(ERR_SOURCE_NOT_FOUND)
    val contentUri = (song["contentUri"] as? String)?.takeUnless { it.isBlank() }
      ?: throw IllegalStateException(ERR_SOURCE_NOT_FOUND)
    val title = (song["title"] as? String)?.takeUnless { it.isBlank() } ?: fileNameStem(fileName)
    val artist = (song["artist"] as? String)?.takeUnless { it.isBlank() }

    val sourceExtension = extensionOf(fileName)
    val outputFormat = outputFormatFor(sourceExtension)

    val workDir = workDir()
    val staged = File(workDir, "src_${UUID.randomUUID()}.${sourceExtension.ifBlank { "audio" }}")
    val rendered = File(workDir, "out_${UUID.randomUUID()}.$outputFormat")

    try {
      // ffmpeg cannot open a content:// URI, and the library's files are reachable only
      // through the content resolver under the MediaStore owner model. Staging a copy
      // into app-private cache is the predictable way across it. Passing a
      // ParcelFileDescriptor as /proc/self/fd/N would avoid the copy but depends on the
      // descriptor surviving fork/exec, which is not something to rely on.
      stageSource(Uri.parse(contentUri), staged)

      val error = AudioPresets.applyPreset(
        ffmpegPath = request.ffmpegPath,
        ffprobePath = request.ffprobePath,
        inputPath = staged.absolutePath,
        outputPath = rendered.absolutePath,
        paramsSpec = request.paramsSpec,
        outputFormat = outputFormat,
        title = title + request.titleSuffix,
        artist = artist,
        progressFilePath = request.progressFilePath,
        cancelFlagPath = request.cancelFlagPath,
      )
      if (error != null) {
        Log.w(TAG, "render failed for ${request.songId}: $error")
        throw IllegalStateException(error)
      }
      if (!rendered.exists() || rendered.length() <= 0L) {
        throw IllegalStateException(ERR_RENDER_EMPTY)
      }

      val displayName = "${sanitizeFileName(title + request.titleSuffix)}.$outputFormat"
      return soundsStore.registerProcessedSound(
        sourceFilePath = rendered.absolutePath,
        displayName = displayName,
        sourceSongId = request.songId,
        presetId = request.presetId,
      )
    } finally {
      // Both temporaries are large; leaving either behind would quietly fill the cache.
      runCatching { staged.delete() }
      runCatching { rendered.delete() }
    }
  }

  private fun stageSource(uri: Uri, destination: File) {
    context.contentResolver.openInputStream(uri)?.use { input ->
      destination.outputStream().use { raw ->
        BufferedOutputStream(raw, STREAM_BUFFER).use { input.copyTo(it, STREAM_BUFFER) }
      }
    } ?: throw IOException(ERR_SOURCE_UNREADABLE)
    if (destination.length() <= 0L) throw IOException(ERR_SOURCE_UNREADABLE)
  }

  private fun workDir(): File = File(context.cacheDir, WORK_DIRNAME).apply { mkdirs() }

  private fun fileNameStem(name: String): String {
    val dot = name.lastIndexOf('.')
    return if (dot > 0) name.substring(0, dot) else name
  }

  private fun extensionOf(name: String): String {
    val dot = name.lastIndexOf('.')
    if (dot <= 0 || dot >= name.length - 1) return ""
    return name.substring(dot + 1).lowercase()
  }

  /**
   * Strip characters MediaStore rejects in a display name. Kept deliberately close to
   * the Python side's rule so a rendered title behaves like a downloaded one.
   */
  private fun sanitizeFileName(name: String): String {
    val cleaned = name.replace(ILLEGAL_FILENAME_CHARS, "").trim()
    val collapsed = cleaned.ifBlank { "audio" }
    return if (collapsed.length > 150) collapsed.substring(0, 150).trim() else collapsed
  }

  companion object {
    private const val TAG = "AudioPresetRenderer"
    private const val WORK_DIRNAME = "audio_preset_work"
    private const val STREAM_BUFFER = 1 shl 16

    const val ERR_SOURCE_NOT_FOUND = "PRESET_SOURCE_NOT_FOUND"
    const val ERR_SOURCE_UNREADABLE = "PRESET_SOURCE_UNREADABLE"
    const val ERR_RENDER_EMPTY = "PRESET_RENDER_EMPTY"

    private val ILLEGAL_FILENAME_CHARS = Regex("[/\\\\:*?\"<>|]")

    /**
     * Containers that hold audio without loss. Mirrors SoundsStore's list.
     */
    private val LOSSLESS_EXTENSIONS = setOf("flac", "alac", "wav", "aiff", "aif")

    /**
     * Pick the output container from the SOURCE's tier.
     *
     * Lossless in, lossless out. Lossy in, lossy out — re-encoding an already-lossy
     * track to FLAC would roughly triple its size while recovering nothing the original
     * encoder discarded; it only avoids a second generation of loss, which is a poor
     * trade at these bitrates. The lossy branch encodes at 320k (above the downloader's
     * 256k) precisely because it IS a second generation.
     *
     * The match is by tier rather than exact format: the bundled FFmpeg has no MP3
     * encoder, so an MP3 or Opus source necessarily lands on AAC.
     */
    fun outputFormatFor(sourceExtension: String): String =
      if (sourceExtension.lowercase() in LOSSLESS_EXTENSIONS) {
        AudioPresets.FORMAT_FLAC
      } else {
        AudioPresets.FORMAT_M4A
      }
  }
}

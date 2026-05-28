package expo.modules.localdownloader.vault

import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import com.chaquo.python.Python
import java.io.ByteArrayOutputStream
import java.io.File
import kotlin.math.min
import kotlin.math.roundToLong

/**
 * Generate a JPEG thumbnail from a plaintext source video file.
 *
 * Used at vault import time, BEFORE the source is encrypted into v4. This is the only
 * point where the plaintext bytes are on disk under our control, so it's also the cheap
 * point to extract a thumbnail without ever decrypting a vault item back to disk later.
 *
 * Strategy:
 *   1. `MediaMetadataRetriever.getFrameAtTime(offsetUs, OPTION_CLOSEST_SYNC)` — fast,
 *      uses the same MediaCodec stack as ExoPlayer.
 *   2. Fallback to Chaquopy → ffmpeg via `local_downloader.generate_video_thumbnail`
 *      when MMR returns null or throws. Covers VP9/WebM and pre-Q AV1 cases.
 *
 * Offset heuristic: `min(duration / 4, 10s)`. A fixed 1s offset lands on black intro
 * frames for a meaningful share of downloaded content.
 *
 * Output: 480x270 JPEG, quality 80.
 */
object ThumbnailGenerator {
  const val DEFAULT_WIDTH = 480
  const val DEFAULT_HEIGHT = 270
  private const val DEFAULT_JPEG_QUALITY = 80
  private const val FFMPEG_JPEG_QUALITY = 5
  private const val FFMPEG_TIMEOUT_SEC = 30.0
  private const val FALLBACK_OFFSET_SEC = 1.0
  private const val OFFSET_CAP_SEC = 10.0

  data class Result(
    val data: ByteArray,
    val source: Source,
    val width: Int,
    val height: Int,
  )

  enum class Source { MEDIA_METADATA_RETRIEVER, FFMPEG, NONE }

  /**
   * Returns the generated thumbnail or null if both paths failed.
   *
   * @param plaintextSource the unencrypted video file (e.g. import temp file).
   * @param ffmpegPath absolute path to ffmpeg executable (from `resolveBundledFfmpegPath`).
   *                   When null, the ffmpeg fallback is skipped.
   * @param durationSec optional total duration (used to pick the seek offset).
   */
  /**
   * Quick metadata-only extraction of the video's total duration in seconds.
   *
   * Returns null if the duration can't be determined. Implemented via
   * [MediaMetadataRetriever] because metadata reads succeed in many cases where
   * frame extraction fails (e.g. unsupported codec but valid container header).
   */
  fun extractDuration(plaintextSource: File): Double? {
    if (!plaintextSource.exists() || plaintextSource.length() == 0L) return null
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(plaintextSource.absolutePath)
      val durationMs = retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
      if (durationMs != null && durationMs > 0) durationMs / 1000.0 else null
    } catch (t: Throwable) {
      null
    } finally {
      runCatching { retriever.release() }
    }
  }

  fun generate(
    plaintextSource: File,
    ffmpegPath: String?,
    durationSec: Double?,
    targetWidth: Int = DEFAULT_WIDTH,
    targetHeight: Int = DEFAULT_HEIGHT,
  ): Result? {
    if (!plaintextSource.exists() || plaintextSource.length() == 0L) {
      return null
    }
    val offsetSec = pickOffset(durationSec)

    val mmrResult = runCatching {
      extractViaMmr(plaintextSource, offsetSec, targetWidth, targetHeight)
    }.getOrNull()
    if (mmrResult != null) {
      return mmrResult
    }

    if (ffmpegPath != null) {
      val ff = runCatching {
        extractViaFfmpeg(plaintextSource, ffmpegPath, offsetSec, targetWidth, targetHeight)
      }.getOrNull()
      if (ff != null) {
        return ff
      }
    }
    return null
  }

  private fun pickOffset(durationSec: Double?): Double {
    if (durationSec == null || !durationSec.isFinite() || durationSec <= 0.0) {
      return FALLBACK_OFFSET_SEC
    }
    return min(durationSec / 4.0, OFFSET_CAP_SEC).coerceAtLeast(0.0)
  }

  private fun extractViaMmr(
    source: File,
    offsetSec: Double,
    targetWidth: Int,
    targetHeight: Int,
  ): Result? {
    val retriever = MediaMetadataRetriever()
    return try {
      retriever.setDataSource(source.absolutePath)
      val offsetUs = (offsetSec * 1_000_000.0).roundToLong().coerceAtLeast(0L)
      val frame = retriever.getFrameAtTime(offsetUs, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
        ?: return null
      val scaled = scaleBitmap(frame, targetWidth, targetHeight)
      val bytes = ByteArrayOutputStream(64 * 1024).use { out ->
        scaled.compress(Bitmap.CompressFormat.JPEG, DEFAULT_JPEG_QUALITY, out)
        out.toByteArray()
      }
      if (scaled !== frame) frame.recycle()
      scaled.recycle()
      if (bytes.isEmpty()) null else Result(bytes, Source.MEDIA_METADATA_RETRIEVER, /* width */ -1, /* height */ -1)
    } catch (t: Throwable) {
      null
    } finally {
      runCatching { retriever.release() }
    }
  }

  private fun scaleBitmap(source: Bitmap, targetWidth: Int, targetHeight: Int): Bitmap {
    val sourceWidth = source.width
    val sourceHeight = source.height
    if (sourceWidth <= targetWidth && sourceHeight <= targetHeight) return source
    val ratio = minOf(
      targetWidth.toFloat() / sourceWidth.toFloat(),
      targetHeight.toFloat() / sourceHeight.toFloat(),
    )
    val outWidth = (sourceWidth * ratio).toInt().coerceAtLeast(1)
    val outHeight = (sourceHeight * ratio).toInt().coerceAtLeast(1)
    return Bitmap.createScaledBitmap(source, outWidth, outHeight, true)
  }

  private fun extractViaFfmpeg(
    source: File,
    ffmpegPath: String,
    offsetSec: Double,
    targetWidth: Int,
    targetHeight: Int,
  ): Result? {
    val py = Python.getInstance()
    val module = py.getModule("local_downloader")
    val pyBytes = module.callAttr(
      "generate_video_thumbnail",
      source.absolutePath,
      ffmpegPath,
      offsetSec,
      targetWidth,
      targetHeight,
      FFMPEG_JPEG_QUALITY,
      FFMPEG_TIMEOUT_SEC,
    )
    val asJavaBytes = pyBytes.toJava(ByteArray::class.java) as? ByteArray
    if (asJavaBytes == null || asJavaBytes.isEmpty()) return null
    return Result(asJavaBytes, Source.FFMPEG, /* width */ -1, /* height */ -1)
  }
}

package expo.modules.localdownloader.vault

import java.io.Closeable
import java.nio.channels.SeekableByteChannel

/**
 * Resources resolved by the host module when the loopback server is handling a request.
 *
 * The server itself is dumb — it parses HTTP, validates tokens, and ranges bytes.
 * Everything that requires knowledge of the vault index, on-disk paths, or the v4 DEK
 * is delegated through [VaultLoopbackProvider].
 */
data class VaultVideoResource(
  val channel: SeekableByteChannel,
  val contentType: String,
  val plaintextLength: Long,
) : Closeable {
  override fun close() {
    runCatching { channel.close() }
  }
}

data class VaultThumbnailResource(
  val data: ByteArray,
  val contentType: String,
) {
  override fun equals(other: Any?): Boolean {
    if (this === other) return true
    if (other !is VaultThumbnailResource) return false
    return contentType == other.contentType && data.contentEquals(other.data)
  }

  override fun hashCode(): Int = 31 * contentType.hashCode() + data.contentHashCode()
}

interface VaultLoopbackProvider {
  /** Called per /v/{token}/{id} request after the token is verified. Returns null to 404. */
  fun openVideoResource(entryId: String): VaultVideoResource?

  /** Called per /t/{token}/{id} request after the token is verified. Returns null to 404. */
  fun loadThumbnailResource(entryId: String): VaultThumbnailResource?
}

/**
 * A single per-playback session that authorizes one entry's video stream over the
 * loopback server. Tokens are 32 random URL-safe bytes (base64url encoded).
 *
 * Thumbnails do NOT use per-entry sessions — see [VaultLoopbackServer.thumbnailToken].
 */
data class VaultVideoSession(
  val token: String,
  val entryId: String,
  val createdAt: Long,
  /** Non-null once this session has been invalidated. Server keeps it briefly so that
   *  ExoPlayer's in-flight requests fail with 410 instead of hanging. */
  @Volatile var evictedAt: Long? = null,
)

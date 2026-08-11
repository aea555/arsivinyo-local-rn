package expo.modules.localdownloader.backup

import java.io.IOException
import java.io.InputStream
import java.io.OutputStream
import java.util.concurrent.ArrayBlockingQueue

/**
 * Runs the two halves of a backup on separate threads so they overlap.
 *
 * Measured on a 12.5 GB vault, an export spent 43 s reading and decrypting the vault and a
 * further 28 s encrypting and writing the backup — strictly one after the other, so the
 * section cost their sum. Neither half is wasteful on its own; buffers were already at the
 * point of diminishing returns (raising them 16x bought 2.4%). The remaining win is not to
 * make either side faster but to stop them waiting for each other, which brings a section
 * down to roughly the slower of the two.
 *
 * Both classes hand whole buffers between the threads through a small fixed pool, so the
 * work per chunk is one `System.arraycopy` and no allocation. Order is preserved because a
 * single consumer drains a FIFO queue, which matters: the SHA-256 of every item is computed
 * as the bytes go past, and a reordered stream would produce a hash that fails on restore.
 */
internal object BackupPipeline {

  /** Buffers in flight. Four of 1 MB is enough to keep both sides busy without bloat. */
  private const val DEFAULT_DEPTH = 4

  private class Chunk(val buffer: ByteArray, val length: Int)

  /**
   * An [OutputStream] whose writes are handed to a background thread.
   *
   * The caller's thread returns as soon as the bytes are copied into a pooled buffer, so it
   * can go back to reading its source while the previous chunk is still being encrypted and
   * written.
   *
   * [close] drains the queue and waits for the consumer before returning, so anything after
   * it — the entry trailer, in this case — is written strictly after the payload. It does
   * **not** close [delegate]; the caller owns that.
   */
  class ParallelOutputStream(
    private val delegate: OutputStream,
    bufferSize: Int,
    depth: Int = DEFAULT_DEPTH,
    /** Applied to each chunk on the consumer thread, in order. Used for the digest. */
    private val onChunk: ((ByteArray, Int, Int) -> Unit)? = null,
  ) : OutputStream() {

    private val free = ArrayBlockingQueue<ByteArray>(depth)
    private val filled = ArrayBlockingQueue<Chunk>(depth)
    private val poison = Chunk(ByteArray(0), -1)

    @Volatile private var failure: Throwable? = null
    @Volatile private var closed = false

    private val worker = Thread({
      try {
        while (true) {
          val chunk = filled.take()
          if (chunk.length < 0) break
          onChunk?.invoke(chunk.buffer, 0, chunk.length)
          delegate.write(chunk.buffer, 0, chunk.length)
          free.put(chunk.buffer)
        }
      } catch (error: Throwable) {
        failure = error
        // Release anything the producer may be blocked waiting for, or it deadlocks here
        // rather than seeing the error.
        free.clear()
        repeat(depth) { free.offer(ByteArray(0)) }
      }
    }, "avsbck-write").apply { isDaemon = true }

    init {
      repeat(depth) { free.put(ByteArray(bufferSize)) }
      worker.start()
    }

    private fun checkFailure() {
      failure?.let { throw IOException("backup write pipeline failed", it) }
    }

    /**
     * The buffer being filled, and how much of it is used.
     *
     * Chunks are accumulated until a buffer is actually full rather than handed over per
     * `write` call. Callers write at whatever size suits them — the vault decrypt path uses
     * 64 KB — and giving each of those its own megabyte buffer meant the pool held a
     * sixteenth of the data it was sized for, and the queue saw sixteen times the
     * hand-offs. The two threads then spent their time blocking on each other instead of
     * overlapping, which made an export slower than doing the work serially.
     */
    private var current: ByteArray? = null
    private var used = 0

    private fun takeBuffer(): ByteArray {
      val buffer = free.take()
      checkFailure()
      // A zero-length buffer is the signal the worker died; do not try to use it.
      if (buffer.isEmpty()) throw IOException("backup write pipeline stopped")
      return buffer
    }

    private fun handOver() {
      val buffer = current ?: return
      if (used == 0) return
      filled.put(Chunk(buffer, used))
      current = null
      used = 0
    }

    override fun write(b: Int) {
      checkFailure()
      val buffer = current ?: takeBuffer().also { current = it; used = 0 }
      buffer[used++] = b.toByte()
      if (used == buffer.size) handOver()
    }

    override fun write(b: ByteArray, off: Int, len: Int) {
      checkFailure()
      var offset = off
      var remaining = len
      while (remaining > 0) {
        val buffer = current ?: takeBuffer().also { current = it; used = 0 }
        val take = minOf(buffer.size - used, remaining)
        System.arraycopy(b, offset, buffer, used, take)
        used += take
        offset += take
        remaining -= take
        if (used == buffer.size) handOver()
      }
    }

    override fun flush() {
      checkFailure()
    }

    /** Waits for every queued chunk to reach [delegate]. Does not close [delegate]. */
    override fun close() {
      if (closed) return
      closed = true
      // The tail of the last buffer still has to go.
      runCatching { handOver() }
      runCatching { filled.put(poison) }
      worker.join()
      checkFailure()
    }
  }

  /**
   * An [InputStream] that reads ahead from [delegate] on a background thread.
   *
   * The mirror of the above, for a restore: decryption of the next chunk runs while the
   * caller is still writing the previous one into the library.
   *
   * [close] stops the reader but does **not** close [delegate].
   */
  class ParallelInputStream(
    private val delegate: InputStream,
    bufferSize: Int,
    depth: Int = DEFAULT_DEPTH,
  ) : InputStream() {

    private val free = ArrayBlockingQueue<ByteArray>(depth)
    private val filled = ArrayBlockingQueue<Chunk>(depth)
    private val endOfStream = Chunk(ByteArray(0), -1)

    @Volatile private var failure: Throwable? = null
    @Volatile private var stopped = false

    private var current: Chunk? = null
    private var position = 0
    private var finished = false

    private val worker = Thread({
      try {
        while (!stopped) {
          val buffer = free.take()
          if (stopped) break
          val read = delegate.read(buffer)
          if (read < 0) {
            filled.put(endOfStream)
            break
          }
          if (read > 0) filled.put(Chunk(buffer, read)) else free.put(buffer)
        }
      } catch (error: Throwable) {
        failure = error
        filled.offer(endOfStream)
      }
    }, "avsbck-read").apply { isDaemon = true }

    init {
      repeat(depth) { free.put(ByteArray(bufferSize)) }
      worker.start()
    }

    private fun ensureChunk(): Boolean {
      failure?.let { throw IOException("backup read pipeline failed", it) }
      if (finished) return false
      val chunk = current
      if (chunk != null && position < chunk.length) return true
      if (chunk != null) {
        free.put(chunk.buffer)
        current = null
      }
      val next = filled.take()
      failure?.let { throw IOException("backup read pipeline failed", it) }
      if (next.length < 0) {
        finished = true
        return false
      }
      current = next
      position = 0
      return true
    }

    override fun read(): Int {
      if (!ensureChunk()) return -1
      val chunk = current!!
      return chunk.buffer[position++].toInt() and 0xFF
    }

    override fun read(b: ByteArray, off: Int, len: Int): Int {
      if (len == 0) return 0
      if (!ensureChunk()) return -1
      val chunk = current!!
      val take = minOf(len, chunk.length - position)
      System.arraycopy(chunk.buffer, position, b, off, take)
      position += take
      return take
    }

    override fun close() {
      if (stopped) return
      stopped = true
      // Unblock the worker whichever queue it is sitting on.
      free.offer(ByteArray(0))
      filled.poll()
      worker.join(1_000)
    }
  }
}

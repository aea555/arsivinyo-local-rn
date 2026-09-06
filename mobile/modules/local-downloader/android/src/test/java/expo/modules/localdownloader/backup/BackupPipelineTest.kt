package expo.modules.localdownloader.backup

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.IOException
import java.io.InputStream
import java.io.OutputStream

/**
 * Tests for the read-ahead and write-behind streams.
 *
 * This is the only concurrent code in the backup path, and its failure mode is not a crash
 * but a corrupted archive: bytes arriving out of order still produce a valid-looking file
 * whose hashes disagree on restore. Order and completeness are therefore checked at sizes
 * that straddle the buffer boundary, where an off-by-one would hide.
 */
class BackupPipelineTest {

  private fun bytes(n: Int, seed: Long): ByteArray =
    ByteArray(n).also { java.util.Random(seed).nextBytes(it) }

  // ------------------------------------------------------------------ writing

  @Test
  fun everyByteArrivesInOrderAcrossBufferBoundaries() {
    val bufferSize = 1024
    // Either side of one buffer, several buffers, and a size that is not a multiple.
    listOf(0, 1, bufferSize - 1, bufferSize, bufferSize + 1, bufferSize * 7, bufferSize * 7 + 13)
      .forEach { size ->
        val payload = bytes(size, size.toLong())
        val sink = ByteArrayOutputStream()
        BackupPipeline.ParallelOutputStream(sink, bufferSize).use { it.write(payload) }
        assertArrayEquals("failed at $size bytes", payload, sink.toByteArray())
      }
  }

  @Test
  fun manySmallWritesArriveInOrder() {
    // A caller that writes a few bytes at a time must not be reordered by the hand-off.
    val sink = ByteArrayOutputStream()
    val expected = ByteArrayOutputStream()
    BackupPipeline.ParallelOutputStream(sink, 64).use { stream ->
      repeat(500) { i ->
        val chunk = bytes(1 + (i % 17), i.toLong())
        stream.write(chunk)
        expected.write(chunk)
      }
    }
    assertArrayEquals(expected.toByteArray(), sink.toByteArray())
  }

  @Test
  fun singleByteWritesAreSupported() {
    val sink = ByteArrayOutputStream()
    BackupPipeline.ParallelOutputStream(sink, 8).use { stream ->
      (0 until 40).forEach { stream.write(it) }
    }
    assertArrayEquals(ByteArray(40) { it.toByte() }, sink.toByteArray())
  }

  @Test
  fun theChunkHookSeesEveryByteExactlyOnceInOrder() {
    // The SHA-256 of each item is computed through this hook. If it saw chunks out of order
    // or twice, every restore would fail its hash check — after the backup was written.
    val payload = bytes(5000, 3L)
    val seen = ByteArrayOutputStream()
    val sink = ByteArrayOutputStream()
    BackupPipeline.ParallelOutputStream(
      sink,
      bufferSize = 256,
      onChunk = { buffer, off, len -> seen.write(buffer, off, len) },
    ).use { it.write(payload) }

    assertArrayEquals(payload, seen.toByteArray())
    assertArrayEquals(payload, sink.toByteArray())
  }

  @Test
  fun closeWaitsForEverythingToReachTheDelegate() {
    // The entry trailer is written straight after close(). If close returned early the
    // trailer would land in the middle of the payload.
    val sink = ByteArrayOutputStream()
    val slow = object : OutputStream() {
      override fun write(b: Int) = sink.write(b)
      override fun write(b: ByteArray, off: Int, len: Int) {
        Thread.sleep(2)
        sink.write(b, off, len)
      }
    }
    val payload = bytes(8192, 4L)
    BackupPipeline.ParallelOutputStream(slow, 512).use { it.write(payload) }
    assertEquals("close() returned before the sink had everything", payload.size, sink.size())
  }

  @Test
  fun aFailingDelegateSurfacesRatherThanHanging() {
    val exploding = object : OutputStream() {
      var written = 0
      override fun write(b: Int) = Unit
      override fun write(b: ByteArray, off: Int, len: Int) {
        written += len
        if (written > 4096) throw IOException("disk full")
      }
    }
    try {
      BackupPipeline.ParallelOutputStream(exploding, 512).use { stream ->
        // Far more than the failure threshold, so the producer keeps going after the break.
        repeat(200) { stream.write(bytes(512, it.toLong())) }
      }
      fail("expected the delegate failure to surface")
    } catch (e: IOException) {
      assertTrue("cause should be preserved: ${e.cause}", e.cause is IOException)
    }
  }

  @Test
  fun closeIsIdempotent() {
    val sink = ByteArrayOutputStream()
    val stream = BackupPipeline.ParallelOutputStream(sink, 128)
    stream.write(bytes(300, 5L))
    stream.close()
    stream.close()
    assertEquals(300, sink.size())
  }

  @Test
  fun theDelegateIsNotClosed() {
    // Several entries share one encrypting stream; closing it after the first would end the
    // section.
    var closed = false
    val sink = object : ByteArrayOutputStream() {
      override fun close() {
        closed = true
        super.close()
      }
    }
    BackupPipeline.ParallelOutputStream(sink, 64).use { it.write(bytes(100, 6L)) }
    assertTrue("the shared stream must stay open", !closed)
  }

  @Test
  fun smallWritesAreAccumulatedIntoFullBuffers() {
    // The regression this pins: handing a whole pooled buffer over per write() call meant a
    // caller writing 64 KB blocks used a sixteenth of each megabyte buffer, so the pool held
    // a sixteenth of the data it was sized for and the queue saw sixteen times the
    // hand-offs. The threads then blocked on each other and the export came out slower than
    // doing the work serially. Correctness tests all still passed, which is why this one
    // counts hand-offs rather than bytes.
    val bufferSize = 1024 * 1024
    val writeSize = 64 * 1024
    val writes = 64 // 4 MB total, so exactly 4 full buffers
    var handOffs = 0

    val sink = ByteArrayOutputStream()
    BackupPipeline.ParallelOutputStream(
      sink,
      bufferSize = bufferSize,
      onChunk = { _, _, _ -> handOffs += 1 },
    ).use { stream ->
      repeat(writes) { stream.write(bytes(writeSize, it.toLong())) }
    }

    assertEquals(writes * writeSize, sink.size())
    // One per filled buffer, not one per write.
    assertTrue(
      "expected about ${writes * writeSize / bufferSize} hand-offs, got $handOffs",
      handOffs <= (writes * writeSize / bufferSize) + 1,
    )
  }

  @Test
  fun theTailOfAPartlyFilledBufferIsNotLost() {
    // Accumulating means the last buffer is usually incomplete when close() arrives.
    val sink = ByteArrayOutputStream()
    val payload = bytes(1500, 11L)
    BackupPipeline.ParallelOutputStream(sink, bufferSize = 1024).use { it.write(payload) }
    assertArrayEquals(payload, sink.toByteArray())
  }

  @Test
  fun singleByteWritesAlsoAccumulate() {
    var handOffs = 0
    val sink = ByteArrayOutputStream()
    BackupPipeline.ParallelOutputStream(
      sink,
      bufferSize = 256,
      onChunk = { _, _, _ -> handOffs += 1 },
    ).use { stream -> repeat(1000) { stream.write(it and 0xFF) } }

    assertEquals(1000, sink.size())
    assertTrue("one hand-off per byte would be $handOffs", handOffs <= 1000 / 256 + 1)
  }

  // ------------------------------------------------------------------ reading

  @Test
  fun readAheadReturnsTheSameBytes() {
    val bufferSize = 1024
    listOf(0, 1, bufferSize - 1, bufferSize, bufferSize + 1, bufferSize * 5 + 7).forEach { size ->
      val payload = bytes(size, size.toLong())
      val stream = BackupPipeline.ParallelInputStream(ByteArrayInputStream(payload), bufferSize)
      val readBack = stream.use { it.readBytes() }
      assertArrayEquals("failed at $size bytes", payload, readBack)
    }
  }

  @Test
  fun readAheadSupportsSingleByteReads() {
    val payload = bytes(300, 7L)
    val stream = BackupPipeline.ParallelInputStream(ByteArrayInputStream(payload), 32)
    val out = ByteArrayOutputStream()
    stream.use {
      while (true) {
        val value = it.read()
        if (value < 0) break
        out.write(value)
      }
    }
    assertArrayEquals(payload, out.toByteArray())
  }

  @Test
  fun readAheadHonoursPartialReads() {
    // The caller asks for less than a whole buffer; the remainder must not be dropped.
    val payload = bytes(4096, 8L)
    val stream = BackupPipeline.ParallelInputStream(ByteArrayInputStream(payload), 1024)
    val out = ByteArrayOutputStream()
    stream.use {
      val small = ByteArray(100)
      while (true) {
        val read = it.read(small, 0, small.size)
        if (read < 0) break
        out.write(small, 0, read)
      }
    }
    assertArrayEquals(payload, out.toByteArray())
  }

  @Test
  fun aFailingSourceSurfaces() {
    val exploding = object : InputStream() {
      var served = 0
      override fun read(): Int = throw IOException("unreadable")
      override fun read(b: ByteArray, off: Int, len: Int): Int {
        served += len
        if (served > 2048) throw IOException("unreadable")
        return len
      }
    }
    try {
      BackupPipeline.ParallelInputStream(exploding, 512).use { it.readBytes() }
      fail("expected the source failure to surface")
    } catch (e: IOException) {
      assertTrue(e.message?.contains("read pipeline") == true || e.cause is IOException)
    }
  }

  @Test
  fun closingEarlyDoesNotHang() {
    // A restore that stops partway through an item must not leave a thread waiting forever.
    val endless = object : InputStream() {
      override fun read(): Int = 0
      override fun read(b: ByteArray, off: Int, len: Int): Int = len
    }
    val stream = BackupPipeline.ParallelInputStream(endless, 256)
    stream.read(ByteArray(10))
    stream.close()
    stream.close()
  }

  @Test
  fun readAheadDoesNotCloseTheDelegate() {
    var closed = false
    val source = object : InputStream() {
      private val inner = ByteArrayInputStream(bytes(200, 9L))
      override fun read(): Int = inner.read()
      override fun read(b: ByteArray, off: Int, len: Int): Int = inner.read(b, off, len)
      override fun close() {
        closed = true
      }
    }
    BackupPipeline.ParallelInputStream(source, 64).use { it.readBytes() }
    assertTrue("the section stream must stay open", !closed)
  }

  // ------------------------------------------------------------------ round trip

  @Test
  fun writeThenReadThroughBothPipelinesIsLossless() {
    val payload = bytes(300_000, 10L)
    val encoded = ByteArrayOutputStream()
    BackupPipeline.ParallelOutputStream(encoded, 4096).use { it.write(payload) }

    val decoded = BackupPipeline
      .ParallelInputStream(ByteArrayInputStream(encoded.toByteArray()), 4096)
      .use { it.readBytes() }

    assertArrayEquals(payload, decoded)
  }
}

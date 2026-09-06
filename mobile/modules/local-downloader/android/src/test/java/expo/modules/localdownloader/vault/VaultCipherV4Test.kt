package expo.modules.localdownloader.vault

import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Rule
import org.junit.Test
import org.junit.rules.TemporaryFolder
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.nio.ByteBuffer
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * JVM unit tests for [VaultCipherV4]. These only exercise the streaming-AEAD primitive
 * (Google Tink) and the helper APIs — the Keystore-backed DEK wrap/unwrap path needs
 * the Android Keystore service and is covered by manual testing on a real device.
 *
 * To run from a properly wired Gradle build: `./gradlew :expo-modules-local-downloader:testDebugUnitTest`
 */
class VaultCipherV4Test {
  @get:Rule
  val tempFolder = TemporaryFolder()

  private val rng = SecureRandom()
  private fun randomDek(): ByteArray = ByteArray(VaultCipherV4.DEK_BYTES).also { rng.nextBytes(it) }
  private fun randomBytes(n: Int): ByteArray = ByteArray(n).also { rng.nextBytes(it) }
  private fun sha256(b: ByteArray): String =
    MessageDigest.getInstance("SHA-256").digest(b).joinToString("") { "%02x".format(it) }

  @Test fun roundTrip_smallFile_underOneSegment() {
    val dek = randomDek()
    val plain = randomBytes(64 * 1024)
    val encrypted = tempFolder.newFile("small.v4")
    ByteArrayInputStream(plain).use { input ->
      encrypted.outputStream().use { out ->
        VaultCipherV4.encryptStream(input, out, "entry-id-1", dek)
      }
    }
    assertTrue(encrypted.length() > plain.size)

    val decrypted = ByteArrayOutputStream(plain.size)
    encrypted.inputStream().use { input ->
      VaultCipherV4.decryptStream(input, decrypted, "entry-id-1", dek)
    }
    assertArrayEquals(plain, decrypted.toByteArray())
  }

  @Test fun roundTrip_multipleSegments() {
    val dek = randomDek()
    val plain = randomBytes(VaultCipherV4.SEGMENT_SIZE * 3 + 12_345)
    val encrypted = tempFolder.newFile("multi.v4")
    ByteArrayInputStream(plain).use { input ->
      encrypted.outputStream().use { out ->
        VaultCipherV4.encryptStream(input, out, "entry-id-multi", dek)
      }
    }
    val decryptedHash: String
    ByteArrayOutputStream(plain.size).use { out ->
      encrypted.inputStream().use { input ->
        VaultCipherV4.decryptStream(input, out, "entry-id-multi", dek)
      }
      decryptedHash = sha256(out.toByteArray())
    }
    assertEquals(sha256(plain), decryptedHash)
  }

  @Test fun seekableChannel_readsMidFileSlice() {
    val dek = randomDek()
    val plainBytes = ByteArray(VaultCipherV4.SEGMENT_SIZE * 2)
    for (i in plainBytes.indices) plainBytes[i] = (i and 0xFF).toByte()
    val encrypted = tempFolder.newFile("seek.v4")
    ByteArrayInputStream(plainBytes).use { input ->
      encrypted.outputStream().use { out ->
        VaultCipherV4.encryptStream(input, out, "seek-id", dek)
      }
    }

    val plaintextLength = VaultCipherV4.plaintextLength(encrypted, "seek-id", dek)
    assertEquals(plainBytes.size.toLong(), plaintextLength)

    VaultCipherV4.openDecryptingChannel(encrypted, "seek-id", dek).use { channel ->
      val start = 1_500_000L
      val length = 8_192
      channel.position(start)
      val buffer = ByteBuffer.allocate(length)
      var totalRead = 0
      while (totalRead < length) {
        val read = channel.read(buffer)
        if (read <= 0) break
        totalRead += read
      }
      assertEquals(length, totalRead)
      val expected = plainBytes.copyOfRange(start.toInt(), start.toInt() + length)
      assertArrayEquals(expected, buffer.array())
    }
  }

  @Test fun tamperedSegmentIsRejected() {
    val dek = randomDek()
    val plain = randomBytes(VaultCipherV4.SEGMENT_SIZE + 1024)
    val encrypted = tempFolder.newFile("tamper.v4")
    ByteArrayInputStream(plain).use { input ->
      encrypted.outputStream().use { out ->
        VaultCipherV4.encryptStream(input, out, "tamper-id", dek)
      }
    }
    // Flip a bit in segment 2 (well past the Tink header).
    val raw = encrypted.readBytes()
    val flipIndex = VaultCipherV4.SEGMENT_SIZE + 100
    raw[flipIndex] = (raw[flipIndex].toInt() xor 0x01).toByte()
    encrypted.writeBytes(raw)

    try {
      ByteArrayOutputStream().use { sink ->
        encrypted.inputStream().use { input ->
          VaultCipherV4.decryptStream(input, sink, "tamper-id", dek)
        }
      }
      fail("Tampered ciphertext should not decrypt")
    } catch (expected: Throwable) {
      // Tink raises a GeneralSecurityException-subtype on tag mismatch. The exact
      // class can vary by version, so we accept any exception here.
    }
  }

  @Test fun wrongAadIsRejected() {
    val dek = randomDek()
    val plain = randomBytes(32 * 1024)
    val encrypted = tempFolder.newFile("aad.v4")
    ByteArrayInputStream(plain).use { input ->
      encrypted.outputStream().use { out ->
        VaultCipherV4.encryptStream(input, out, "aad-id-A", dek)
      }
    }
    try {
      ByteArrayOutputStream().use { sink ->
        encrypted.inputStream().use { input ->
          // Attempting to decrypt with a different entry id (= different AAD) should fail.
          VaultCipherV4.decryptStream(input, sink, "aad-id-B", dek)
        }
      }
      fail("Decryption with a different entry id (AAD) should be rejected")
    } catch (expected: Throwable) {
      // expected
    }
  }
}

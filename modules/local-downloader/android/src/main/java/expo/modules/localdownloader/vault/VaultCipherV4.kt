package expo.modules.localdownloader.vault

import com.google.crypto.tink.subtle.AesGcmHkdfStreaming
import java.io.File
import java.io.FileOutputStream
import java.io.InputStream
import java.io.OutputStream
import java.nio.channels.FileChannel
import java.nio.channels.SeekableByteChannel
import java.nio.file.StandardOpenOption
import java.security.SecureRandom
import javax.crypto.Cipher
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Cipher v4 — Tink AesGcmHkdfStreaming with 1 MB segments.
 *
 * Each file is encrypted using a vault-wide DEK (32 bytes). The DEK is wrapped with the
 * existing Keystore-backed master key (AES-GCM) and persisted at
 * `private_vault/keys/dek.v4.bin`. Per-segment AES-256-GCM keys are derived inside Tink
 * via HKDF(salt || segment_index). Each segment carries its own GCM auth tag, giving both
 * integrity (the v3 CTR mode had none) and seekable random-access reads — required by the
 * loopback playback server for Range requests.
 *
 * AAD = the vault entry id bytes. This binds a ciphertext to its index entry; swapping
 * one encrypted file for another in `private_vault/objects/` is detected at decrypt time.
 */
object VaultCipherV4 {
  const val VERSION_TAG = "v4"
  const val SEGMENT_SIZE: Int = 1 * 1024 * 1024
  const val DEK_BYTES: Int = 32

  private const val GCM_IV_BYTES = 12
  private const val GCM_TAG_BITS = 128
  private const val HKDF_ALG = "HmacSha256"
  private const val DEK_DIR = "keys"
  private const val DEK_FILE = "dek.v4.bin"
  private const val WRITE_BUFFER_BYTES = 64 * 1024

  private val secureRandom = SecureRandom()

  fun getOrCreateVaultDek(vaultRoot: File, masterKeyProvider: () -> SecretKey): ByteArray {
    val dir = File(vaultRoot, DEK_DIR).apply { if (!exists()) mkdirs() }
    val file = File(dir, DEK_FILE)
    if (file.exists() && file.length() > 0L) {
      return unwrapDek(file, masterKeyProvider())
    }
    val dek = ByteArray(DEK_BYTES).also { secureRandom.nextBytes(it) }
    wrapDek(dek, file, masterKeyProvider())
    return dek
  }

  fun encryptStream(input: InputStream, output: OutputStream, entryId: String, dek: ByteArray) {
    openEncryptingStream(output, entryId, dek).use { encrypting ->
      val buf = ByteArray(WRITE_BUFFER_BYTES)
      while (true) {
        val read = input.read(buf)
        if (read <= 0) break
        encrypting.write(buf, 0, read)
      }
    }
  }

  /**
   * Open a streaming v4 encrypter that wraps [output]. Caller writes plaintext into
   * the returned stream and MUST close it to flush the final GCM segment. Useful when
   * the plaintext is produced by a push-mode source (e.g. the existing
   * `decryptPrivateVaultFileV3ToStream` flow during migration).
   */
  fun openEncryptingStream(output: OutputStream, entryId: String, dek: ByteArray): OutputStream {
    val streamingAead = AesGcmHkdfStreaming(dek, HKDF_ALG, DEK_BYTES, SEGMENT_SIZE, 0)
    val aad = aadFor(entryId)
    return streamingAead.newEncryptingStream(output, aad)
  }

  fun decryptStream(input: InputStream, output: OutputStream, entryId: String, dek: ByteArray) {
    val streamingAead = AesGcmHkdfStreaming(dek, HKDF_ALG, DEK_BYTES, SEGMENT_SIZE, 0)
    val aad = aadFor(entryId)
    streamingAead.newDecryptingStream(input, aad).use { decrypting ->
      val buf = ByteArray(WRITE_BUFFER_BYTES)
      while (true) {
        val read = decrypting.read(buf)
        if (read <= 0) break
        output.write(buf, 0, read)
      }
    }
  }

  fun openDecryptingChannel(file: File, entryId: String, dek: ByteArray): SeekableByteChannel {
    val streamingAead = AesGcmHkdfStreaming(dek, HKDF_ALG, DEK_BYTES, SEGMENT_SIZE, 0)
    val aad = aadFor(entryId)
    val fileChannel = FileChannel.open(file.toPath(), StandardOpenOption.READ)
    return streamingAead.newSeekableDecryptingChannel(fileChannel, aad)
  }

  fun plaintextLength(file: File, entryId: String, dek: ByteArray): Long {
    openDecryptingChannel(file, entryId, dek).use { channel ->
      return channel.size()
    }
  }

  private fun wrapDek(dek: ByteArray, output: File, masterKey: SecretKey) {
    // The vault master key is Keystore-backed with `setRandomizedEncryptionRequired(true)`,
    // which forbids caller-supplied IVs on ENCRYPT_MODE. We let Keystore generate the IV
    // and read it back via `cipher.iv` — the same pattern used by `encryptFileForPrivateVaultV3`.
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.ENCRYPT_MODE, masterKey)
    val wrapped = cipher.doFinal(dek)
    val iv = cipher.iv
    if (iv == null || iv.size != GCM_IV_BYTES) {
      throw IllegalStateException("Unexpected Keystore IV size: ${iv?.size}")
    }
    val tmp = File(output.parentFile, "${output.name}.tmp")
    FileOutputStream(tmp).use { out ->
      out.write(iv)
      out.write(wrapped)
      out.fd.sync()
    }
    if (output.exists() && !output.delete()) {
      tmp.delete()
      throw IllegalStateException("Could not replace vault DEK file")
    }
    if (!tmp.renameTo(output)) {
      tmp.delete()
      throw IllegalStateException("Could not persist vault DEK")
    }
  }

  private fun unwrapDek(input: File, masterKey: SecretKey): ByteArray {
    val raw = input.readBytes()
    if (raw.size <= GCM_IV_BYTES + (GCM_TAG_BITS / 8)) {
      throw IllegalStateException("Vault DEK file truncated (${raw.size} bytes)")
    }
    val iv = raw.copyOfRange(0, GCM_IV_BYTES)
    val ciphertext = raw.copyOfRange(GCM_IV_BYTES, raw.size)
    val cipher = Cipher.getInstance("AES/GCM/NoPadding")
    cipher.init(Cipher.DECRYPT_MODE, masterKey, GCMParameterSpec(GCM_TAG_BITS, iv))
    val dek = cipher.doFinal(ciphertext)
    if (dek.size != DEK_BYTES) {
      throw IllegalStateException("Vault DEK wrong size after unwrap: ${dek.size}")
    }
    return dek
  }

  private fun aadFor(entryId: String): ByteArray = entryId.toByteArray(Charsets.UTF_8)
}

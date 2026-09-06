package expo.modules.localdownloader.backup

import com.google.crypto.tink.subtle.AesGcmHkdfStreaming
import com.google.crypto.tink.subtle.Hkdf
import org.bouncycastle.crypto.generators.Argon2BytesGenerator
import org.bouncycastle.crypto.params.Argon2Parameters
import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream
import java.security.MessageDigest
import java.security.SecureRandom

/**
 * Key derivation and section encryption for `.avsbck`.
 *
 * **Why Argon2id and not PBKDF2.** A backup is a single file that may sit on cloud storage
 * for years, which is exactly the threat model where an attacker gets unlimited offline
 * guesses. PBKDF2 is only computationally hard, so GPUs and ASICs run it far cheaper than
 * we do. Argon2id is *memory*-hard: every guess costs the attacker the same 64 MB it costs
 * us, which is what keeps a human-typed secret viable. The cipher choice barely matters
 * next to this.
 *
 * **Why AES-GCM and not XChaCha20-Poly1305.** XChaCha20's selling point is a nonce large
 * enough to pick at random without bookkeeping. [AesGcmHkdfStreaming] removes that problem
 * a different way — it derives a fresh key per 1 MB segment via HKDF, so there is no nonce
 * for this code to manage and none to reuse. It is also the primitive already guarding the
 * private vault ([expo.modules.localdownloader.vault.VaultCipherV4]), it streams by design
 * so a multi-GB video never lands in memory, and ARMv8 runs AES in hardware. Reusing a
 * construction already proven on the device spends the risk budget on framing and error
 * handling, which is where backup formats actually go wrong.
 *
 * **Key hierarchy.** One Argon2id run per key slot produces a master key; every section
 * key is an HKDF child of it, labelled with the section id:
 *
 * ```
 *   secret --Argon2id(salt)--> masterKey --HKDF("avsbck/section/music")--> sectionKey
 *                                        --HKDF("avsbck/verify")-------> verifier
 * ```
 *
 * That gives "one passphrase for everything" for free, while per-section secrets are just
 * additional slots with their own salt and their own Argon2id run. Nothing about the file
 * layout has to change to support them.
 */
object BackupCrypto {
  const val KDF_ARGON2ID = "argon2id"

  const val MASTER_KEY_BYTES = 32
  const val SECTION_KEY_BYTES = 32
  const val VERIFIER_BYTES = 32
  const val SALT_BYTES = 16

  /** Matches the vault's segment size; large enough that per-segment overhead is noise. */
  const val SEGMENT_SIZE: Int = 1 * 1024 * 1024

  private const val HKDF_ALG = "HMACSHA256"
  private const val HKDF_MAC = "HmacSha256"

  private const val INFO_VERIFY = "avsbck/verify/v1"
  private const val INFO_SECTION_PREFIX = "avsbck/section/v1/"

  private val secureRandom = SecureRandom()

  /**
   * Argon2id cost. Written into every file's header — a future build must be able to
   * reproduce *today's* derivation, so these are read back from the header on import and
   * never assumed.
   *
   * Defaults are RFC 9106's second recommended profile (64 MiB, t=3, p=4), measured at
   * ~150 ms on a desktop and expected in the 0.5–1 s range on the target phone.
   *
   * Note that BouncyCastle's Argon2 is single-threaded: `parallelism` changes the lane
   * layout and therefore the output, but it does not make our own derivation faster. It is
   * kept at 4 to match the published profile rather than for any speed it buys us.
   */
  data class KdfParams(
    val id: String = KDF_ARGON2ID,
    val version: Int = Argon2Parameters.ARGON2_VERSION_13,
    val memoryKiB: Int = 64 * 1024,
    val iterations: Int = 3,
    val parallelism: Int = 4,
  ) {
    fun validate() {
      if (id != KDF_ARGON2ID) {
        throw BackupFormatException("This backup uses an unsupported key derivation ('$id')")
      }
      // Guard against a header that would have us allocate gigabytes or spin forever.
      if (memoryKiB !in 8 * 1024..1024 * 1024) {
        throw BackupFormatException("Backup KDF memory parameter is out of range ($memoryKiB KiB)")
      }
      if (iterations !in 1..16) {
        throw BackupFormatException("Backup KDF iteration count is out of range ($iterations)")
      }
      if (parallelism !in 1..16) {
        throw BackupFormatException("Backup KDF parallelism is out of range ($parallelism)")
      }
    }
  }

  fun encodeKdfParams(params: KdfParams): JSONObject = JSONObject().apply {
    put("id", params.id)
    put("version", params.version)
    put("memoryKiB", params.memoryKiB)
    put("iterations", params.iterations)
    put("parallelism", params.parallelism)
  }

  fun decodeKdfParams(json: JSONObject): KdfParams {
    val params = KdfParams(
      id = json.optString("id").ifBlank { KDF_ARGON2ID },
      version = json.optInt("version", Argon2Parameters.ARGON2_VERSION_13),
      memoryKiB = json.optInt("memoryKiB", 0),
      iterations = json.optInt("iterations", 0),
      parallelism = json.optInt("parallelism", 0),
    )
    params.validate()
    return params
  }

  fun randomSalt(): ByteArray = ByteArray(SALT_BYTES).also { secureRandom.nextBytes(it) }

  // ---------------------------------------------------------------- derivation

  /**
   * Run Argon2id over [secret]. Deliberately slow — expect this to block for around a
   * second, so callers must be off the main thread.
   *
   * [secret] is a `CharArray` rather than a `String` so the caller can wipe it; a `String`
   * would sit in the heap until GC and could survive into a memory dump. This function does
   * not wipe it — the caller owns it, and may need it for a second slot.
   */
  fun deriveMasterKey(secret: CharArray, salt: ByteArray, params: KdfParams): ByteArray {
    params.validate()
    if (salt.size < SALT_BYTES) {
      throw BackupFormatException("Backup key slot has a missing or short salt")
    }
    val argonParams = Argon2Parameters.Builder(Argon2Parameters.ARGON2_id)
      .withVersion(params.version)
      .withMemoryAsKB(params.memoryKiB)
      .withIterations(params.iterations)
      .withParallelism(params.parallelism)
      .withSalt(salt)
      .build()
    val generator = Argon2BytesGenerator().apply { init(argonParams) }
    val out = ByteArray(MASTER_KEY_BYTES)
    generator.generateBytes(secret, out)
    return out
  }

  /**
   * A tag proving a master key is the right one, so a wrong passphrase can be reported as
   * a wrong passphrase instead of surfacing as a corrupt-file error several megabytes later.
   *
   * It is an HKDF child of the master key on a fixed label, so it reveals nothing about the
   * key itself and nothing about the sections.
   */
  fun verifierFor(masterKey: ByteArray): ByteArray =
    Hkdf.computeHkdf(HKDF_ALG, masterKey, null, INFO_VERIFY.toByteArray(Charsets.UTF_8), VERIFIER_BYTES)

  /** Constant-time compare — a verifier check must not leak position through timing. */
  fun verifierMatches(masterKey: ByteArray, expected: ByteArray): Boolean =
    MessageDigest.isEqual(verifierFor(masterKey), expected)

  fun sectionKey(masterKey: ByteArray, sectionId: String): ByteArray = Hkdf.computeHkdf(
    HKDF_ALG,
    masterKey,
    null,
    (INFO_SECTION_PREFIX + sectionId).toByteArray(Charsets.UTF_8),
    SECTION_KEY_BYTES,
  )

  // ---------------------------------------------------------------- section streams

  /**
   * AAD is the section id, which binds a payload to the slot it is declared under. Moving
   * the music ciphertext into the vault section's offsets fails the tag rather than
   * decrypting into the wrong place.
   */
  private fun aadFor(sectionId: String): ByteArray = sectionId.toByteArray(Charsets.UTF_8)

  private fun streamingAead(sectionKey: ByteArray) =
    AesGcmHkdfStreaming(sectionKey, HKDF_MAC, SECTION_KEY_BYTES, SEGMENT_SIZE, 0)

  /** Caller must close the returned stream to flush the final GCM segment. */
  fun openSectionEncryptingStream(
    output: OutputStream,
    sectionKey: ByteArray,
    sectionId: String,
  ): OutputStream = streamingAead(sectionKey).newEncryptingStream(output, aadFor(sectionId))

  fun openSectionDecryptingStream(
    input: InputStream,
    sectionKey: ByteArray,
    sectionId: String,
  ): InputStream = streamingAead(sectionKey).newDecryptingStream(input, aadFor(sectionId))

  /** Overwrite key material once it is no longer needed. */
  fun wipe(vararg secrets: ByteArray?) {
    secrets.forEach { it?.fill(0) }
  }

  fun wipe(secret: CharArray?) {
    secret?.fill('\u0000')
  }
}

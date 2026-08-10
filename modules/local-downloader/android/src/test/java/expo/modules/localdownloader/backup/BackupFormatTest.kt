package expo.modules.localdownloader.backup

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.security.SecureRandom

/**
 * JVM unit tests for the `.avsbck` container: header codec, key derivation, section
 * encryption and entry framing. No Android services are involved, so these run on the
 * plain JVM the same way [expo.modules.localdownloader.vault.VaultCipherV4Test] does.
 *
 * Argon2id is deliberately expensive, so every test here uses [fastKdf] rather than the
 * shipping parameters. One test ([defaultKdfParamsAreTheIntendedProfile]) pins the real
 * defaults so a careless edit to them cannot pass unnoticed.
 */
class BackupFormatTest {

  /** Cheapest parameters `KdfParams.validate()` accepts — enough to prove wiring. */
  private fun fastKdf() = BackupCrypto.KdfParams(memoryKiB = 8 * 1024, iterations = 1, parallelism = 1)

  private fun bytes(n: Int, seed: Long = 1L): ByteArray {
    val out = ByteArray(n)
    java.util.Random(seed).nextBytes(out)
    return out
  }

  // ------------------------------------------------------------------ KDF

  @Test
  fun defaultKdfParamsAreTheIntendedProfile() {
    // RFC 9106's second recommended profile. Lowering these silently would weaken every
    // backup written afterwards, and nothing else in the codebase would complain.
    val params = BackupCrypto.KdfParams()
    assertEquals(BackupCrypto.KDF_ARGON2ID, params.id)
    assertEquals(64 * 1024, params.memoryKiB)
    assertEquals(3, params.iterations)
    assertEquals(4, params.parallelism)
  }

  @Test
  fun derivationIsDeterministicForTheSameSaltAndParams() {
    val salt = bytes(16)
    val a = BackupCrypto.deriveMasterKey("correct horse".toCharArray(), salt, fastKdf())
    val b = BackupCrypto.deriveMasterKey("correct horse".toCharArray(), salt, fastKdf())
    assertArrayEquals(a, b)
    assertEquals(BackupCrypto.MASTER_KEY_BYTES, a.size)
  }

  @Test
  fun differentSaltGivesDifferentKey() {
    val secret = "correct horse".toCharArray()
    val a = BackupCrypto.deriveMasterKey(secret, bytes(16, 1L), fastKdf())
    val b = BackupCrypto.deriveMasterKey(secret, bytes(16, 2L), fastKdf())
    assertFalse("Same secret under different salts must not collide", a.contentEquals(b))
  }

  @Test
  fun differentParamsGiveDifferentKey() {
    // If this failed, the parameters would not really be bound to the output and a header
    // could be downgraded to a cheaper cost without invalidating the file.
    val salt = bytes(16)
    val secret = "correct horse".toCharArray()
    val a = BackupCrypto.deriveMasterKey(secret, salt, fastKdf())
    val b = BackupCrypto.deriveMasterKey(secret, salt, fastKdf().copy(iterations = 2))
    assertFalse(a.contentEquals(b))
  }

  @Test
  fun kdfParamsOutOfRangeAreRejected() {
    val cases = listOf(
      fastKdf().copy(memoryKiB = 1024) to "memory below the floor",
      fastKdf().copy(memoryKiB = 4 * 1024 * 1024) to "memory that would exhaust the heap",
      fastKdf().copy(iterations = 0) to "zero iterations",
      fastKdf().copy(iterations = 999) to "absurd iteration count",
      fastKdf().copy(parallelism = 0) to "zero parallelism",
      fastKdf().copy(id = "pbkdf2") to "an unsupported KDF id",
    )
    cases.forEach { (params, what) ->
      try {
        params.validate()
        fail("Expected $what to be rejected")
      } catch (expected: BackupFormatException) {
        // A corrupt or hostile header must not steer us into a huge allocation.
      }
    }
  }

  @Test
  fun verifierAcceptsTheRightKeyAndRejectsTheWrong() {
    val salt = bytes(16)
    val right = BackupCrypto.deriveMasterKey("right secret".toCharArray(), salt, fastKdf())
    val wrong = BackupCrypto.deriveMasterKey("wrong secret".toCharArray(), salt, fastKdf())
    val stored = BackupCrypto.verifierFor(right)

    assertTrue(BackupCrypto.verifierMatches(right, stored))
    assertFalse(BackupCrypto.verifierMatches(wrong, stored))
  }

  @Test
  fun verifierDoesNotRevealTheMasterKey() {
    val key = bytes(32)
    val verifier = BackupCrypto.verifierFor(key)
    assertFalse("Verifier must not be the key itself", verifier.contentEquals(key))
  }

  @Test
  fun sectionKeysDifferPerSection() {
    val master = bytes(32)
    val keys = BackupFormat.ALL_SECTIONS.map { BackupCrypto.sectionKey(master, it) }
    keys.forEachIndexed { i, a ->
      keys.forEachIndexed { j, b ->
        if (i != j) assertFalse("Sections $i and $j share a key", a.contentEquals(b))
      }
    }
    // Same input must still be stable across calls, or a file would not decrypt twice.
    assertArrayEquals(keys[0], BackupCrypto.sectionKey(master, BackupFormat.ALL_SECTIONS[0]))
  }

  // ------------------------------------------------------------------ header codec

  private fun sampleHeader() = BackupFormat.Header(
    formatVersion = BackupFormat.FORMAT_VERSION,
    createdAt = 1_754_870_400_000L,
    appVersion = "2.4.0-beta.1",
    appVersionCode = 20400,
    kdf = fastKdf(),
    keySlots = listOf(
      BackupFormat.KeySlot(
        id = BackupFormat.DEFAULT_KEY_SLOT,
        salt = bytes(16, 7L),
        verifier = bytes(32, 8L),
        secretKind = BackupFormat.SECRET_KIND_PASSPHRASE,
      )
    ),
    sections = listOf(
      BackupFormat.SectionEntry(BackupFormat.SECTION_MUSIC, BackupFormat.DEFAULT_KEY_SLOT, 12, 900_000L),
      BackupFormat.SectionEntry(BackupFormat.SECTION_VAULT, BackupFormat.DEFAULT_KEY_SLOT, 3, 8_000_000L),
    ),
  )

  @Test
  fun headerRoundTrips() {
    val original = sampleHeader()
    val decoded = BackupFormat.decodeHeader(BackupFormat.encodeHeader(original))

    assertEquals(original.formatVersion, decoded.formatVersion)
    assertEquals(original.createdAt, decoded.createdAt)
    assertEquals(original.appVersion, decoded.appVersion)
    assertEquals(original.appVersionCode, decoded.appVersionCode)
    assertEquals(original.kdf, decoded.kdf)
    assertEquals(original.keySlots, decoded.keySlots)
    assertEquals(original.sections.size, decoded.sections.size)

    val music = decoded.section(BackupFormat.SECTION_MUSIC)!!
    assertEquals(12, music.itemCount)
    assertEquals(900_000L, music.plaintextBytes)
    assertEquals(BackupFormat.DEFAULT_KEY_SLOT, music.keySlot)

    // Section order is what pairs a header entry with its payload, so it must survive.
    assertEquals(
      listOf(BackupFormat.SECTION_MUSIC, BackupFormat.SECTION_VAULT),
      decoded.sections.map { it.id },
    )
  }

  @Test
  fun headerSurvivesAFullPreambleRoundTrip() {
    val header = sampleHeader()
    val encoded = BackupFormat.encodeHeader(header)
    val file = ByteArrayOutputStream().also { BackupFormat.writePreamble(it, encoded) }.toByteArray()

    // The payload origin has to agree with how many bytes the preamble actually wrote,
    // or every section offset in the file is wrong by a constant.
    assertEquals(BackupFormat.payloadOrigin(encoded.size), file.size.toLong())

    val decoded = BackupFormat.readHeader(ByteArrayInputStream(file))
    assertEquals(header.sections.size, decoded.sections.size)
    assertArrayEquals(header.keySlots[0].salt, decoded.slot(BackupFormat.DEFAULT_KEY_SLOT)!!.salt)
  }

  @Test
  fun readHeaderRejectsFilesThatAreNotBackups() {
    val notABackup = "just some text file contents, definitely not a backup".toByteArray()
    try {
      BackupFormat.readHeader(ByteArrayInputStream(notABackup))
      fail("Expected a non-backup file to be rejected")
    } catch (e: BackupFormatException) {
      assertTrue(
        "Message should be understandable by a user: ${e.message}",
        e.message!!.contains("not an Arsivinyo backup")
      )
    }
  }

  @Test
  fun readHeaderRejectsAnEmptyOrTruncatedFile() {
    listOf(ByteArray(0), BackupFormat.MAGIC.copyOfRange(0, 3)).forEach { truncated ->
      try {
        BackupFormat.readHeader(ByteArrayInputStream(truncated))
        fail("Expected truncated input to be rejected")
      } catch (expected: BackupFormatException) {
      }
    }
  }

  @Test
  fun readHeaderRejectsANewerFormatVersion() {
    val encoded = BackupFormat.encodeHeader(sampleHeader())
    val file = ByteArrayOutputStream().also { BackupFormat.writePreamble(it, encoded) }.toByteArray()
    // Bump the on-disk format version past what this build knows.
    file[BackupFormat.MAGIC.size + 1] = (BackupFormat.FORMAT_VERSION + 1).toByte()

    try {
      BackupFormat.readHeader(ByteArrayInputStream(file))
      fail("Expected a newer format version to be refused")
    } catch (e: BackupFormatException) {
      assertTrue(
        "The user needs to be told to update, not that the file is broken: ${e.message}",
        e.message!!.contains("newer version")
      )
    }
  }

  @Test
  fun headerWithASectionPointingAtAnUnknownSlotIsRejected() {
    val broken = sampleHeader().let { header ->
      header.copy(
        sections = listOf(
          BackupFormat.SectionEntry(BackupFormat.SECTION_MUSIC, "no-such-slot", 1, 1L)
        )
      )
    }
    try {
      BackupFormat.decodeHeader(BackupFormat.encodeHeader(broken))
      fail("Expected a dangling key slot reference to be rejected")
    } catch (expected: BackupFormatException) {
    }
  }

  @Test
  fun base64RoundTripsAtEveryPaddingLength() {
    // All three padding cases, since the tail handling is where hand-rolled base64 breaks.
    (0..64).forEach { n ->
      val original = bytes(n, n.toLong())
      val decoded = BackupFormat.Base64Codec.decode(BackupFormat.Base64Codec.encode(original))
      assertArrayEquals("Round trip failed at length $n", original, decoded)
    }
  }

  // ------------------------------------------------------------------ chunk framing

  @Test
  fun chunkFramingRoundTripsAcrossChunkBoundaries() {
    // Sizes either side of the chunk boundary, since off-by-one there would corrupt every
    // backup larger than one chunk.
    val chunk = 1024
    listOf(0, 1, chunk - 1, chunk, chunk + 1, chunk * 3, chunk * 3 + 7).forEach { size ->
      val payload = bytes(size, size.toLong())
      val sink = ByteArrayOutputStream()
      BackupFormat.ChunkedOutputStream(sink, chunk).use { it.write(payload) }

      val readBack = BackupFormat.ChunkedInputStream(ByteArrayInputStream(sink.toByteArray())).readBytes()
      assertArrayEquals("Round trip failed at $size bytes", payload, readBack)
    }
  }

  @Test
  fun severalSectionsShareOneStreamWithoutOffsets() {
    // The whole reason for chunk framing: sections are written back to back into a stream
    // that cannot be seeked, and each must still know where it ends.
    val chunk = 256
    val payloads = listOf(bytes(700, 1L), bytes(0, 2L), bytes(300, 3L))

    val file = ByteArrayOutputStream()
    payloads.forEach { payload ->
      BackupFormat.ChunkedOutputStream(file, chunk).use { it.write(payload) }
    }

    val source = ByteArrayInputStream(file.toByteArray())
    payloads.forEachIndexed { i, expected ->
      val actual = BackupFormat.ChunkedInputStream(source).readBytes()
      assertArrayEquals("Section $i differs", expected, actual)
    }
    assertEquals("Every byte should have been consumed", 0, source.available())
  }

  @Test
  fun aSectionCanBeSkippedWithoutReadingIt() {
    // Restoring only music must not require decrypting — or even reading — the vault.
    val chunk = 128
    val file = ByteArrayOutputStream()
    BackupFormat.ChunkedOutputStream(file, chunk).use { it.write(bytes(5000, 1L)) }
    BackupFormat.ChunkedOutputStream(file, chunk).use { it.write("the second section".toByteArray()) }

    val source = ByteArrayInputStream(file.toByteArray())
    BackupFormat.ChunkedInputStream(source).skipSection()
    val second = BackupFormat.ChunkedInputStream(source).readBytes()

    assertEquals("the second section", String(second))
  }

  @Test
  fun closingASectionDoesNotCloseTheUnderlyingFile() {
    // Tink's encrypting stream closes what it wraps. If that propagated to the file, the
    // first section written would end the backup.
    var closed = false
    val sink = object : ByteArrayOutputStream() {
      override fun close() {
        closed = true
        super.close()
      }
    }
    BackupFormat.ChunkedOutputStream(sink).use { it.write("data".toByteArray()) }
    assertFalse("Section close must not close the backup file", closed)
  }

  @Test
  fun truncatedChunkFramingIsDetected() {
    val sink = ByteArrayOutputStream()
    BackupFormat.ChunkedOutputStream(sink, 256).use { it.write(bytes(1000, 4L)) }
    val truncated = sink.toByteArray().let { it.copyOfRange(0, it.size - 100) }

    try {
      BackupFormat.ChunkedInputStream(ByteArrayInputStream(truncated)).readBytes()
      fail("Expected truncated framing to be rejected")
    } catch (expected: BackupFormatException) {
    }
  }

  // ------------------------------------------------------------------ section streams

  @Test
  fun sectionRoundTripsThroughEncryption() {
    val key = bytes(32)
    val plaintext = bytes(3 * 1024 * 1024, 42L) // spans several 1 MB segments

    val encrypted = ByteArrayOutputStream()
    BackupCrypto.openSectionEncryptingStream(encrypted, key, BackupFormat.SECTION_MUSIC).use {
      it.write(plaintext)
    }

    val decrypted = BackupCrypto
      .openSectionDecryptingStream(
        ByteArrayInputStream(encrypted.toByteArray()), key, BackupFormat.SECTION_MUSIC
      )
      .use { it.readBytes() }

    assertArrayEquals(plaintext, decrypted)
    assertTrue("Ciphertext should not be shorter than plaintext", encrypted.size() > plaintext.size)
  }

  @Test
  fun sectionCiphertextIsBoundToItsSectionId() {
    // The section id is the AAD. Relabelling a payload — say, presenting the music blob at
    // the vault section's offsets — must fail rather than decrypt somewhere it does not
    // belong.
    val key = bytes(32)
    val encrypted = ByteArrayOutputStream()
    BackupCrypto.openSectionEncryptingStream(encrypted, key, BackupFormat.SECTION_MUSIC).use {
      it.write("some music".toByteArray())
    }

    try {
      BackupCrypto
        .openSectionDecryptingStream(
          ByteArrayInputStream(encrypted.toByteArray()), key, BackupFormat.SECTION_VAULT
        )
        .use { it.readBytes() }
      fail("Expected a section-id mismatch to fail authentication")
    } catch (expected: Exception) {
    }
  }

  @Test
  fun wrongSectionKeyFails() {
    val encrypted = ByteArrayOutputStream()
    BackupCrypto.openSectionEncryptingStream(encrypted, bytes(32, 1L), BackupFormat.SECTION_MUSIC).use {
      it.write("some music".toByteArray())
    }
    try {
      BackupCrypto
        .openSectionDecryptingStream(
          ByteArrayInputStream(encrypted.toByteArray()), bytes(32, 2L), BackupFormat.SECTION_MUSIC
        )
        .use { it.readBytes() }
      fail("Expected the wrong key to fail")
    } catch (expected: Exception) {
    }
  }

  @Test
  fun tamperedSectionCiphertextIsDetected() {
    val key = bytes(32)
    val encrypted = ByteArrayOutputStream()
    BackupCrypto.openSectionEncryptingStream(encrypted, key, BackupFormat.SECTION_SETTINGS).use {
      it.write(bytes(4096, 9L))
    }
    val corrupted = encrypted.toByteArray().also { it[it.size / 2] = (it[it.size / 2] + 1).toByte() }

    try {
      BackupCrypto
        .openSectionDecryptingStream(ByteArrayInputStream(corrupted), key, BackupFormat.SECTION_SETTINGS)
        .use { it.readBytes() }
      fail("Expected a flipped byte to be caught by the GCM tag")
    } catch (expected: Exception) {
    }
  }

  @Test
  fun truncatedSectionCiphertextIsDetected() {
    // Storage fills up mid-write, or a sync tool copies half a file. Silent truncation is
    // the failure mode that loses data without anyone noticing, so it must be loud.
    val key = bytes(32)
    val encrypted = ByteArrayOutputStream()
    BackupCrypto.openSectionEncryptingStream(encrypted, key, BackupFormat.SECTION_VAULT).use {
      it.write(bytes(2 * 1024 * 1024, 11L))
    }
    val full = encrypted.toByteArray()
    val truncated = full.copyOfRange(0, full.size - 4096)

    try {
      BackupCrypto
        .openSectionDecryptingStream(ByteArrayInputStream(truncated), key, BackupFormat.SECTION_VAULT)
        .use { it.readBytes() }
      fail("Expected truncated ciphertext to be rejected")
    } catch (expected: Exception) {
    }
  }

  // ------------------------------------------------------------------ entry framing

  @Test
  fun entriesRoundTripInsideASection() {
    val key = bytes(32)
    val payloads = listOf(
      "first track".toByteArray(),
      bytes(500_000, 3L),
      ByteArray(0), // a zero-length file must survive the framing too
    )
    val names = listOf("a.flac", "b.m4a", "empty.txt")

    val encrypted = ByteArrayOutputStream()
    BackupCrypto.openSectionEncryptingStream(encrypted, key, BackupFormat.SECTION_MUSIC).use { out ->
      payloads.forEachIndexed { i, payload ->
        BackupFormat.writeEntryHeader(
          out,
          BackupFormat.EntryHeader(
            name = names[i],
            size = payload.size.toLong(),
            kind = "audio",
            meta = JSONObject().apply { put("index", i) },
          ),
        )
        BackupFormat.ChunkedOutputStream(out).use { it.write(payload) }
        BackupFormat.writeEntryTrailer(
          out,
          BackupFormat.EntryTrailer(payload.size.toLong(), "hash$i"),
        )
      }
      BackupFormat.writeSectionTerminator(out)
    }

    val readBack = mutableListOf<Triple<BackupFormat.EntryHeader, ByteArray, BackupFormat.EntryTrailer>>()
    BackupCrypto
      .openSectionDecryptingStream(ByteArrayInputStream(encrypted.toByteArray()), key, BackupFormat.SECTION_MUSIC)
      .use { input ->
        while (true) {
          val header = BackupFormat.readEntryHeader(input) ?: break
          val payload = BackupFormat.ChunkedInputStream(input).readBytes()
          readBack.add(Triple(header, payload, BackupFormat.readEntryTrailer(input)))
        }
      }

    assertEquals(3, readBack.size)
    readBack.forEachIndexed { i, (header, payload, trailer) ->
      assertEquals(names[i], header.name)
      assertEquals("audio", header.kind)
      assertEquals(i, header.meta.optInt("index", -1))
      assertEquals("hash$i", trailer.sha256)
      assertEquals(payloads[i].size.toLong(), trailer.size)
      assertArrayEquals("Payload $i differs", payloads[i], payload)
    }
  }

  @Test
  fun terminatorEndsTheSection() {
    val out = ByteArrayOutputStream()
    BackupFormat.writeSectionTerminator(out)
    assertNull(BackupFormat.readEntryHeader(ByteArrayInputStream(out.toByteArray())))
  }

  @Test
  fun entryNamesAreNotVisibleInTheCiphertext() {
    // The point of framing entries inside the encrypted stream rather than listing them in
    // the plaintext header: a backup sitting in cloud storage must not leak what it holds.
    val key = bytes(32)
    val secretName = "unmistakable-private-filename.mp4"
    val encrypted = ByteArrayOutputStream()
    BackupCrypto.openSectionEncryptingStream(encrypted, key, BackupFormat.SECTION_VAULT).use { out ->
      BackupFormat.writeEntryHeader(
        out,
        BackupFormat.EntryHeader(secretName, 4L, "video"),
      )
      BackupFormat.ChunkedOutputStream(out).use { it.write("data".toByteArray()) }
      BackupFormat.writeSectionTerminator(out)
    }

    val haystack = String(encrypted.toByteArray(), Charsets.ISO_8859_1)
    assertFalse("Entry name leaked into the ciphertext", haystack.contains(secretName))
  }

  @Test
  fun oversizedEntryMetadataIsRejected() {
    val out = ByteArrayOutputStream()
    try {
      BackupFormat.writeEntryHeader(
        out,
        BackupFormat.EntryHeader("x".repeat(BackupFormat.MAX_ENTRY_HEADER_BYTES + 1), 0L, "video"),
      )
      fail("Expected oversized entry metadata to be rejected")
    } catch (expected: BackupFormatException) {
    }
  }

  @Test
  fun saltsAreRandomPerCall() {
    val seen = (0 until 32).map { BackupFormat.Base64Codec.encode(BackupCrypto.randomSalt()) }.toSet()
    assertEquals("randomSalt() must not repeat", 32, seen.size)
    assertEquals(BackupCrypto.SALT_BYTES, BackupCrypto.randomSalt().size)
  }

  @Test
  fun wipeClearsKeyMaterial() {
    val key = bytes(32)
    BackupCrypto.wipe(key)
    assertArrayEquals(ByteArray(32), key)

    val secret = "hunter2hunter2".toCharArray()
    val originalLength = secret.size
    BackupCrypto.wipe(secret)
    assertEquals("Wiping must not resize the array", originalLength, secret.size)
    assertTrue("Secret characters survived the wipe", secret.all { it == '\u0000' })
  }

  @Test
  fun deriveMasterKeyRejectsAShortSalt() {
    try {
      BackupCrypto.deriveMasterKey("secret".toCharArray(), ByteArray(4), fastKdf())
      fail("Expected a short salt to be rejected")
    } catch (expected: BackupFormatException) {
    }
  }

  @Test
  fun secureRandomSaltsAreNotAllZero() {
    val salt = BackupCrypto.randomSalt()
    assertNotEquals("Salt should not be all zeroes", 0, salt.count { it != 0.toByte() })
    // Sanity check that SecureRandom is actually reachable in this environment.
    assertEquals(BackupCrypto.SALT_BYTES, SecureRandom().generateSeed(0).size + BackupCrypto.SALT_BYTES)
  }
}

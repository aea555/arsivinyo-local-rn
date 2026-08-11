package expo.modules.localdownloader.backup

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Assert.fail
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream

/**
 * End-to-end tests over whole `.avsbck` files: write a multi-section backup, read it back,
 * and check the failure modes that matter — wrong secret, tampering, partial restore.
 *
 * These use the cheapest Argon2id parameters the validator allows. The derivation cost is
 * the point of the real defaults but only slows tests down.
 */
class BackupContainerTest {

  private fun fastKdf() =
    BackupCrypto.KdfParams(memoryKiB = 8 * 1024, iterations = 1, parallelism = 1)

  private fun bytes(n: Int, seed: Long): ByteArray =
    ByteArray(n).also { java.util.Random(seed).nextBytes(it) }

  private fun secret(text: String, slot: String = BackupFormat.DEFAULT_KEY_SLOT) =
    BackupContainer.SlotSecret(slot, text.toCharArray(), BackupFormat.SECRET_KIND_PASSPHRASE)

  /** name -> payload, per section. */
  private fun sectionOf(id: String, items: Map<String, ByteArray>, slot: String = BackupFormat.DEFAULT_KEY_SLOT) =
    BackupContainer.PlannedSection(
      id = id,
      keySlot = slot,
      itemCount = items.size,
      plaintextBytes = items.values.sumOf { it.size.toLong() },
      writeEntries = { sink ->
        items.forEach { (name, payload) ->
          sink.addStream(
            BackupFormat.EntryHeader(
              name = name,
              size = payload.size.toLong(),
              kind = id,
              meta = JSONObject().apply { put("origin", "test") },
            ),
            ByteArrayInputStream(payload),
          )
        }
      },
    )

  private fun writeBackup(
    sections: List<BackupContainer.PlannedSection>,
    secrets: List<BackupContainer.SlotSecret> = listOf(secret("a strong test passphrase")),
  ): ByteArray = ByteArrayOutputStream().also { out ->
    BackupContainer.write(
      output = out,
      secrets = secrets,
      sections = sections,
      appVersion = "2.4.0-beta.1",
      appVersionCode = 20400,
      createdAt = 1_754_870_400_000L,
      kdf = fastKdf(),
    )
  }.toByteArray()

  /** Restore and collect everything into section -> (name -> payload). */
  private fun restore(
    file: ByteArray,
    secrets: List<BackupContainer.SlotSecret>,
    sectionsToRestore: Set<String>,
  ): Map<String, MutableMap<String, ByteArray>> {
    val collected = mutableMapOf<String, MutableMap<String, ByteArray>>()
    val input: InputStream = ByteArrayInputStream(file)
    val header = BackupContainer.peek(input)
    BackupContainer.read(input, header, secrets, sectionsToRestore) { entry ->
      collected.getOrPut(entry.sectionId) { mutableMapOf() }[entry.header.name] = entry.payload.readBytes()
    }
    return collected
  }

  // ------------------------------------------------------------------ happy path

  @Test
  fun aMultiSectionBackupRoundTrips() {
    val music = mapOf(
      "track one.flac" to bytes(300_000, 1L),
      "track two.m4a" to bytes(120_000, 2L),
    )
    // Larger than one 1 MB Tink segment and one framing chunk, so the multi-chunk path runs.
    val vault = mapOf("private video.mp4" to bytes(2_500_000, 3L))
    val settings = mapOf("settings.json" to """{"theme":"midnight"}""".toByteArray())
    val cookies = mapOf("profile.txt" to "session=secret".toByteArray())

    val file = writeBackup(
      listOf(
        sectionOf(BackupFormat.SECTION_MUSIC, music),
        sectionOf(BackupFormat.SECTION_VAULT, vault),
        sectionOf(BackupFormat.SECTION_SETTINGS, settings),
        sectionOf(BackupFormat.SECTION_COOKIES, cookies),
      )
    )

    val restored = restore(
      file,
      listOf(secret("a strong test passphrase")),
      BackupFormat.ALL_SECTIONS.toSet(),
    )

    assertEquals(4, restored.size)
    assertArrayEquals(music["track one.flac"], restored[BackupFormat.SECTION_MUSIC]!!["track one.flac"])
    assertArrayEquals(music["track two.m4a"], restored[BackupFormat.SECTION_MUSIC]!!["track two.m4a"])
    assertArrayEquals(vault["private video.mp4"], restored[BackupFormat.SECTION_VAULT]!!["private video.mp4"])
    assertArrayEquals(settings["settings.json"], restored[BackupFormat.SECTION_SETTINGS]!!["settings.json"])
    assertArrayEquals(cookies["profile.txt"], restored[BackupFormat.SECTION_COOKIES]!!["profile.txt"])
  }

  @Test
  fun headerCanBeInspectedWithoutAnySecret() {
    // The import screen has to show what a file holds before it can ask for a passphrase.
    val file = writeBackup(
      listOf(
        sectionOf(BackupFormat.SECTION_MUSIC, mapOf("a.flac" to bytes(1000, 1L), "b.flac" to bytes(1000, 2L))),
        sectionOf(BackupFormat.SECTION_VAULT, mapOf("v.mp4" to bytes(5000, 3L))),
      )
    )

    val header = BackupContainer.peek(ByteArrayInputStream(file))

    assertEquals("2.4.0-beta.1", header.appVersion)
    assertEquals(20400, header.appVersionCode)
    assertEquals(1_754_870_400_000L, header.createdAt)
    assertEquals(listOf(BackupFormat.SECTION_MUSIC, BackupFormat.SECTION_VAULT), header.sections.map { it.id })
    assertEquals(2, header.section(BackupFormat.SECTION_MUSIC)!!.itemCount)
    assertEquals(2000L, header.section(BackupFormat.SECTION_MUSIC)!!.plaintextBytes)
    assertEquals(
      BackupFormat.SECRET_KIND_PASSPHRASE,
      header.slot(BackupFormat.DEFAULT_KEY_SLOT)!!.secretKind,
    )
  }

  @Test
  fun contentHashesTravelWithEntriesForDuplicateDetection() {
    val payload = bytes(50_000, 7L)
    val expected = BackupContainer.sha256(ByteArrayInputStream(payload))
    // The same bytes under a different name must hash the same, or import would treat a
    // renamed file as new.
    val file = writeBackup(
      listOf(sectionOf(BackupFormat.SECTION_MUSIC, mapOf("one.flac" to payload, "copy.flac" to payload)))
    )

    val hashes = mutableListOf<String>()
    val input = ByteArrayInputStream(file)
    val header = BackupContainer.peek(input)
    BackupContainer.read(
      input, header, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_MUSIC)
    ) { entry -> hashes.add(entry.verifiedTrailer().sha256) }

    assertEquals(listOf(expected, expected), hashes)
  }

  @Test
  fun aWrongAdvisorySizeDoesNotDesynchroniseTheReader() {
    // Plaintext size is not cheaply knowable for every vault cipher version, so the header's
    // size is advisory only. Getting it wrong must cost nothing but a bad progress estimate.
    val payload = bytes(40_000, 11L)
    val file = ByteArrayOutputStream().also { out ->
      BackupContainer.write(
        output = out,
        secrets = listOf(secret("a strong test passphrase")),
        sections = listOf(
          BackupContainer.PlannedSection(
            id = BackupFormat.SECTION_VAULT,
            itemCount = 2,
            plaintextBytes = 0L,
            writeEntries = { sink ->
              // Wildly wrong in both directions.
              sink.addStream(
                BackupFormat.EntryHeader("understated.mp4", 1L, "video"),
                ByteArrayInputStream(payload),
              )
              sink.addStream(
                BackupFormat.EntryHeader("overstated.mp4", 999_999_999L, "video"),
                ByteArrayInputStream(payload),
              )
            },
          )
        ),
        appVersion = "2.4.0-beta.1",
        appVersionCode = 20400,
        createdAt = 1L,
        kdf = fastKdf(),
      )
    }.toByteArray()

    val restored = restore(
      file,
      listOf(secret("a strong test passphrase")),
      setOf(BackupFormat.SECTION_VAULT),
    )

    assertArrayEquals(payload, restored[BackupFormat.SECTION_VAULT]!!["understated.mp4"])
    assertArrayEquals(payload, restored[BackupFormat.SECTION_VAULT]!!["overstated.mp4"])
  }

  @Test
  fun theTrailerRecordsWhatWasActuallyWritten() {
    // The trailer is authoritative precisely because the header is not.
    val payload = bytes(12_345, 12L)
    val file = ByteArrayOutputStream().also { out ->
      BackupContainer.write(
        output = out,
        secrets = listOf(secret("a strong test passphrase")),
        sections = listOf(
          BackupContainer.PlannedSection(
            id = BackupFormat.SECTION_MUSIC,
            itemCount = 1,
            plaintextBytes = 0L,
            writeEntries = { sink ->
              sink.addStream(BackupFormat.EntryHeader("x.flac", 7L, "audio"), ByteArrayInputStream(payload))
            },
          )
        ),
        appVersion = "v", appVersionCode = 1, createdAt = 1L, kdf = fastKdf(),
      )
    }.toByteArray()

    var trailer: BackupFormat.EntryTrailer? = null
    val input = ByteArrayInputStream(file)
    val header = BackupContainer.peek(input)
    BackupContainer.read(
      input, header, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_MUSIC)
    ) { entry -> trailer = entry.verifiedTrailer() }

    assertEquals(12_345L, trailer!!.size)
    assertEquals(BackupContainer.sha256(ByteArrayInputStream(payload)), trailer!!.sha256)
  }

  @Test
  fun aPayloadWrittenInManySmallWritesHashesTheSame() {
    // Collectors push through whatever buffer size their source hands them; the digest must
    // not depend on how the bytes were chunked.
    val payload = bytes(5_000, 13L)
    val file = ByteArrayOutputStream().also { out ->
      BackupContainer.write(
        output = out,
        secrets = listOf(secret("a strong test passphrase")),
        sections = listOf(
          BackupContainer.PlannedSection(
            id = BackupFormat.SECTION_SETTINGS,
            itemCount = 1,
            plaintextBytes = 0L,
            writeEntries = { sink ->
              sink.add(BackupFormat.EntryHeader("drip.bin", 5_000L, "blob")) { stream ->
                payload.forEach { stream.write(it.toInt()) } // one byte at a time
              }
            },
          )
        ),
        appVersion = "v", appVersionCode = 1, createdAt = 1L, kdf = fastKdf(),
      )
    }.toByteArray()

    var trailer: BackupFormat.EntryTrailer? = null
    val restored = mutableMapOf<String, ByteArray>()
    val input = ByteArrayInputStream(file)
    val header = BackupContainer.peek(input)
    BackupContainer.read(
      input, header, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_SETTINGS)
    ) { entry ->
      restored[entry.header.name] = entry.payload.readBytes()
      trailer = entry.verifiedTrailer()
    }

    assertArrayEquals(payload, restored["drip.bin"])
    assertEquals(BackupContainer.sha256(ByteArrayInputStream(payload)), trailer!!.sha256)
  }

  // ------------------------------------------------------------------ export failures

  @Test
  fun oneUnreadableItemDoesNotDestroyTheWholeBackup() {
    // The list of items is a snapshot taken before writing starts, so a file deleted while a
    // 20 GB export runs shows up as a read failure partway through. Losing the entire backup
    // to that would be the worst possible outcome.
    val good = bytes(50_000, 1L)
    val alsoGood = bytes(30_000, 2L)
    val file = ByteArrayOutputStream().also { out ->
      val failures = BackupContainer.write(
        output = out,
        secrets = listOf(secret("a strong test passphrase")),
        sections = listOf(
          BackupContainer.PlannedSection(
            id = BackupFormat.SECTION_MUSIC,
            itemCount = 3,
            plaintextBytes = 0L,
            writeEntries = { sink ->
              sink.addStream(
                BackupFormat.EntryHeader("first.flac", good.size.toLong(), "audio"),
                ByteArrayInputStream(good),
              )
              sink.add(BackupFormat.EntryHeader("deleted.flac", 99_999L, "audio")) { stream ->
                stream.write(bytes(4_000, 3L)) // some bytes land...
                throw java.io.FileNotFoundException("source file was deleted")
              }
              sink.addStream(
                BackupFormat.EntryHeader("third.flac", alsoGood.size.toLong(), "audio"),
                ByteArrayInputStream(alsoGood),
              )
            },
          )
        ),
        appVersion = "v", appVersionCode = 1, createdAt = 1L, kdf = fastKdf(),
      )

      assertEquals(1, failures.size)
      assertEquals("deleted.flac", failures.single().name)
      assertEquals(BackupFormat.SECTION_MUSIC, failures.single().sectionId)
      assertTrue(failures.single().error.contains("deleted"))
    }.toByteArray()

    // The two good items must still restore, and the failed one must not.
    val restored = restore(
      file,
      listOf(secret("a strong test passphrase")),
      setOf(BackupFormat.SECTION_MUSIC),
    )
    assertArrayEquals(good, restored[BackupFormat.SECTION_MUSIC]!!["first.flac"])
    assertArrayEquals(alsoGood, restored[BackupFormat.SECTION_MUSIC]!!["third.flac"])
  }

  @Test
  fun aTruncatedItemIsMarkedIncompleteRatherThanLookingIntact() {
    // The trap this closes: the trailer records the size and hash of what was *written*, so
    // a half-copied video verifies perfectly against its own hash. Without the flag a
    // restore would store half a file believing it sound.
    val partial = bytes(4_000, 7L)
    val file = ByteArrayOutputStream().also { out ->
      BackupContainer.write(
        output = out,
        secrets = listOf(secret("a strong test passphrase")),
        sections = listOf(
          BackupContainer.PlannedSection(
            id = BackupFormat.SECTION_VAULT,
            itemCount = 1,
            plaintextBytes = 0L,
            writeEntries = { sink ->
              sink.add(BackupFormat.EntryHeader("cut-short.mp4", 999_999L, "video")) { stream ->
                stream.write(partial)
                throw IllegalStateException("read failed")
              }
            },
          )
        ),
        appVersion = "v", appVersionCode = 1, createdAt = 1L, kdf = fastKdf(),
      )
    }.toByteArray()

    var trailer: BackupFormat.EntryTrailer? = null
    val input = ByteArrayInputStream(file)
    val header = BackupContainer.peek(input)
    BackupContainer.read(
      input, header, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_VAULT)
    ) { entry -> trailer = entry.verifiedTrailer() }

    // Size and hash are internally consistent — that is exactly the problem.
    assertEquals(partial.size.toLong(), trailer!!.size)
    assertEquals(BackupContainer.sha256(ByteArrayInputStream(partial)), trailer!!.sha256)
    // Only the flag reveals it.
    assertEquals(false, trailer!!.complete)
  }

  @Test
  fun aCompleteEntryIsNotMarkedIncomplete() {
    // Guards the inverse: if everything were flagged incomplete, restores would silently
    // stop working while every other test still passed.
    val payload = bytes(10_000, 8L)
    val file = ByteArrayOutputStream().also { out ->
      BackupContainer.write(
        output = out,
        secrets = listOf(secret("a strong test passphrase")),
        sections = listOf(
          BackupContainer.PlannedSection(
            id = BackupFormat.SECTION_MUSIC,
            itemCount = 1,
            plaintextBytes = 0L,
            writeEntries = { sink ->
              sink.addStream(
                BackupFormat.EntryHeader("fine.flac", payload.size.toLong(), "audio"),
                ByteArrayInputStream(payload),
              )
            },
          )
        ),
        appVersion = "v", appVersionCode = 1, createdAt = 1L, kdf = fastKdf(),
      )
    }.toByteArray()

    val input = ByteArrayInputStream(file)
    val header = BackupContainer.peek(input)
    BackupContainer.read(
      input, header, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_MUSIC)
    ) { entry -> assertEquals(true, entry.verifiedTrailer().complete) }
  }

  // ------------------------------------------------------------------ selective restore

  @Test
  fun onlyTheChosenSectionsAreDecrypted() {
    val file = writeBackup(
      listOf(
        sectionOf(BackupFormat.SECTION_MUSIC, mapOf("a.flac" to bytes(400_000, 1L))),
        sectionOf(BackupFormat.SECTION_VAULT, mapOf("v.mp4" to bytes(1_500_000, 2L))),
        sectionOf(BackupFormat.SECTION_SETTINGS, mapOf("s.json" to "{}".toByteArray())),
      )
    )

    val restored = restore(
      file,
      listOf(secret("a strong test passphrase")),
      setOf(BackupFormat.SECTION_SETTINGS),
    )

    assertEquals("Only the settings section should have been visited", setOf(BackupFormat.SECTION_SETTINGS), restored.keys)
    assertEquals("{}", String(restored[BackupFormat.SECTION_SETTINGS]!!["s.json"]!!))
  }

  @Test
  fun skippingAnEntirePayloadDoesNotDesynchroniseTheNextEntry() {
    // A visitor that ignores an item — a duplicate on import — must leave the stream in a
    // state where the following entry still parses.
    val items = mapOf(
      "first.flac" to bytes(200_000, 1L),
      "second.flac" to bytes(10, 2L),
      "third.flac" to bytes(150_000, 3L),
    )
    val file = writeBackup(listOf(sectionOf(BackupFormat.SECTION_MUSIC, items)))

    val seen = mutableMapOf<String, ByteArray>()
    val input = ByteArrayInputStream(file)
    val header = BackupContainer.peek(input)
    BackupContainer.read(
      input, header, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_MUSIC)
    ) { entry ->
      // Deliberately read nothing for the first item.
      if (entry.header.name != "first.flac") seen[entry.header.name] = entry.payload.readBytes()
    }

    assertEquals(setOf("second.flac", "third.flac"), seen.keys)
    assertArrayEquals(items["second.flac"], seen["second.flac"])
    assertArrayEquals(items["third.flac"], seen["third.flac"])
  }

  @Test
  fun aVisitorThatReadsOnlyPartOfAPayloadDoesNotBreakTheNextEntry() {
    val items = mapOf("big.mp4" to bytes(300_000, 4L), "after.flac" to bytes(2_000, 5L))
    val file = writeBackup(listOf(sectionOf(BackupFormat.SECTION_VAULT, items)))

    var after: ByteArray? = null
    val input = ByteArrayInputStream(file)
    val header = BackupContainer.peek(input)
    BackupContainer.read(
      input, header, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_VAULT)
    ) { entry ->
      if (entry.header.name == "big.mp4") entry.payload.read(ByteArray(100)) else after = entry.payload.readBytes()
    }

    assertArrayEquals(items["after.flac"], after)
  }

  @Test
  fun anEntryPayloadCannotReadPastItsOwnLength() {
    // Without the bound, a greedy visitor would swallow the next entry's header.
    val items = mapOf("a.bin" to bytes(1_000, 1L), "b.bin" to bytes(1_000, 2L))
    val file = writeBackup(listOf(sectionOf(BackupFormat.SECTION_MUSIC, items)))

    val lengths = mutableListOf<Int>()
    val input = ByteArrayInputStream(file)
    val header = BackupContainer.peek(input)
    BackupContainer.read(
      input, header, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_MUSIC)
    ) { entry -> lengths.add(entry.payload.readBytes().size) }

    assertEquals(listOf(1_000, 1_000), lengths)
  }

  // ------------------------------------------------------------------ secrets

  @Test
  fun theWrongPassphraseIsReportedAsSuchBeforeAnyPayloadIsTouched() {
    val file = writeBackup(listOf(sectionOf(BackupFormat.SECTION_MUSIC, mapOf("a.flac" to bytes(1000, 1L)))))

    try {
      restore(file, listOf(secret("not the right passphrase")), setOf(BackupFormat.SECTION_MUSIC))
      fail("Expected the wrong passphrase to be rejected")
    } catch (e: BackupSecretException) {
      assertTrue(
        "The user should be told the secret is wrong, not that the file is broken: ${e.message}",
        e.message!!.contains("not correct")
      )
    }
  }

  @Test
  fun perSectionSecretsUnlockOnlyTheirOwnSection() {
    // Cookie profiles are session credentials, so they get their own slot; the music
    // passphrase must not open them.
    val musicSecret = secret("the music passphrase", "music-slot")
    val cookieSecret = secret("the cookie passphrase", "cookie-slot")

    val file = writeBackup(
      listOf(
        sectionOf(BackupFormat.SECTION_MUSIC, mapOf("a.flac" to bytes(1000, 1L)), "music-slot"),
        sectionOf(BackupFormat.SECTION_COOKIES, mapOf("c.txt" to "session=secret".toByteArray()), "cookie-slot"),
      ),
      secrets = listOf(musicSecret, cookieSecret),
    )

    val musicOnly = restore(file, listOf(musicSecret), setOf(BackupFormat.SECTION_MUSIC))
    assertEquals(setOf(BackupFormat.SECTION_MUSIC), musicOnly.keys)

    try {
      restore(file, listOf(musicSecret.copy(slotId = "cookie-slot")), setOf(BackupFormat.SECTION_COOKIES))
      fail("Expected the music passphrase to fail on the cookie section")
    } catch (expected: BackupSecretException) {
    }

    val both = restore(file, listOf(musicSecret, cookieSecret), BackupFormat.ALL_SECTIONS.toSet())
    assertEquals("session=secret", String(both[BackupFormat.SECTION_COOKIES]!!["c.txt"]!!))
  }

  @Test
  fun aMissingSecretForANeededSlotIsReported() {
    val musicSecret = secret("the music passphrase", "music-slot")
    val file = writeBackup(
      listOf(sectionOf(BackupFormat.SECTION_MUSIC, mapOf("a.flac" to bytes(10, 1L)), "music-slot")),
      secrets = listOf(musicSecret),
    )

    try {
      restore(file, emptyList(), setOf(BackupFormat.SECTION_MUSIC))
      fail("Expected a missing secret to be reported")
    } catch (expected: BackupSecretException) {
    }
  }

  @Test
  fun writeRefusesASectionWhoseSlotHasNoSecret() {
    try {
      writeBackup(
        listOf(sectionOf(BackupFormat.SECTION_MUSIC, mapOf("a.flac" to bytes(10, 1L)), "absent-slot")),
        secrets = listOf(secret("only the default slot")),
      )
      fail("Expected writing to fail when a section names a slot with no secret")
    } catch (expected: IllegalArgumentException) {
    }
  }

  // ------------------------------------------------------------------ damage

  /**
   * Hand-build a one-entry backup with a deliberately wrong trailer.
   *
   * [BackupContainer.write] always records a correct trailer, so the only way to prove the
   * reader's integrity checks fire is to forge a file the writer would never produce. This
   * is the case the AEAD tag cannot catch: the ciphertext is perfectly valid and decrypts
   * cleanly — it is the *plaintext* that disagrees with what was recorded, which is what a
   * bad disk or a bug in a collector would look like.
   */
  private fun forgeBackupWithTrailer(
    payload: ByteArray,
    trailer: BackupFormat.EntryTrailer,
    passphrase: String = "a strong test passphrase",
  ): ByteArray {
    val kdf = fastKdf()
    val salt = BackupCrypto.randomSalt()
    val masterKey = BackupCrypto.deriveMasterKey(passphrase.toCharArray(), salt, kdf)
    val header = BackupFormat.Header(
      formatVersion = BackupFormat.FORMAT_VERSION,
      createdAt = 1L,
      appVersion = "forged",
      appVersionCode = 1,
      kdf = kdf,
      keySlots = listOf(
        BackupFormat.KeySlot(
          BackupFormat.DEFAULT_KEY_SLOT,
          salt,
          BackupCrypto.verifierFor(masterKey),
          BackupFormat.SECRET_KIND_PASSPHRASE,
        )
      ),
      sections = listOf(
        BackupFormat.SectionEntry(BackupFormat.SECTION_MUSIC, BackupFormat.DEFAULT_KEY_SLOT, 1, 0L)
      ),
    )

    return ByteArrayOutputStream().also { out ->
      BackupFormat.writePreamble(out, BackupFormat.encodeHeader(header))
      val sectionKey = BackupCrypto.sectionKey(masterKey, BackupFormat.SECTION_MUSIC)
      val framing = BackupFormat.ChunkedOutputStream(out)
      BackupCrypto.openSectionEncryptingStream(framing, sectionKey, BackupFormat.SECTION_MUSIC)
        .use { encrypted ->
          BackupFormat.writeEntryHeader(
            encrypted,
            BackupFormat.EntryHeader("forged.flac", payload.size.toLong(), "audio"),
          )
          BackupFormat.ChunkedOutputStream(encrypted).use { it.write(payload) }
          BackupFormat.writeEntryTrailer(encrypted, trailer)
          BackupFormat.writeSectionTerminator(encrypted)
        }
    }.toByteArray()
  }

  @Test
  fun anEntryWhoseContentDisagreesWithItsRecordedHashIsRejected() {
    val payload = bytes(20_000, 21L)
    val file = forgeBackupWithTrailer(
      payload,
      BackupFormat.EntryTrailer(payload.size.toLong(), "00".repeat(32)),
    )

    try {
      restore(file, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_MUSIC))
      fail("Expected a hash mismatch to be rejected")
    } catch (e: BackupFormatException) {
      assertTrue("Message should name the offending entry: ${e.message}", e.message!!.contains("forged.flac"))
      assertTrue("Message should say what is wrong: ${e.message}", e.message!!.contains("hash"))
    }
  }

  @Test
  fun anEntryWhoseByteCountDisagreesWithItsTrailerIsRejected() {
    val payload = bytes(20_000, 22L)
    val file = forgeBackupWithTrailer(
      payload,
      BackupFormat.EntryTrailer(payload.size.toLong() - 1, BackupContainer.sha256(ByteArrayInputStream(payload))),
    )

    try {
      restore(file, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_MUSIC))
      fail("Expected a byte-count mismatch to be rejected")
    } catch (e: BackupFormatException) {
      assertTrue("Message should name the offending entry: ${e.message}", e.message!!.contains("forged.flac"))
    }
  }

  @Test
  fun aCorrectlyForgedFileStillRestores() {
    // Proves the two tests above fail for the reason claimed, rather than because the
    // hand-built file is malformed in some unrelated way.
    val payload = bytes(20_000, 23L)
    val file = forgeBackupWithTrailer(
      payload,
      BackupFormat.EntryTrailer(payload.size.toLong(), BackupContainer.sha256(ByteArrayInputStream(payload))),
    )

    val restored = restore(file, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_MUSIC))
    assertArrayEquals(payload, restored[BackupFormat.SECTION_MUSIC]!!["forged.flac"])
  }

  @Test
  fun aTamperedPayloadIsDetected() {
    val file = writeBackup(
      listOf(sectionOf(BackupFormat.SECTION_VAULT, mapOf("v.mp4" to bytes(400_000, 1L))))
    )
    // Flip a byte well past the plaintext header, inside the ciphertext.
    val corrupted = file.copyOf().also { it[it.size - 5000] = (it[it.size - 5000] + 1).toByte() }

    try {
      restore(corrupted, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_VAULT))
      fail("Expected tampering to be caught by the AEAD tag")
    } catch (expected: Exception) {
      assertFalse(
        "Tampering must not be mistaken for a wrong passphrase",
        expected is BackupSecretException,
      )
    }
  }

  @Test
  fun aTruncatedFileIsDetected() {
    val file = writeBackup(
      listOf(sectionOf(BackupFormat.SECTION_VAULT, mapOf("v.mp4" to bytes(2_000_000, 1L))))
    )
    val truncated = file.copyOfRange(0, file.size - 50_000)

    try {
      restore(truncated, listOf(secret("a strong test passphrase")), setOf(BackupFormat.SECTION_VAULT))
      fail("Expected a truncated backup to be rejected")
    } catch (expected: Exception) {
    }
  }

  @Test
  fun anEmptySectionRoundTrips() {
    // Backing up with nothing in the vault yet must still produce a readable file.
    val file = writeBackup(
      listOf(
        sectionOf(BackupFormat.SECTION_VAULT, emptyMap()),
        sectionOf(BackupFormat.SECTION_MUSIC, mapOf("a.flac" to bytes(100, 1L))),
      )
    )

    val restored = restore(
      file,
      listOf(secret("a strong test passphrase")),
      BackupFormat.ALL_SECTIONS.toSet(),
    )

    assertFalse("An empty section should visit nothing", restored.containsKey(BackupFormat.SECTION_VAULT))
    assertEquals(1, restored[BackupFormat.SECTION_MUSIC]!!.size)
  }

  @Test
  fun secretsAreNotRecoverableFromTheFile() {
    val passphrase = "unmistakable-test-passphrase-value"
    val file = writeBackup(
      listOf(sectionOf(BackupFormat.SECTION_MUSIC, mapOf("a.flac" to bytes(1000, 1L)))),
      secrets = listOf(secret(passphrase)),
    )

    val haystack = String(file, Charsets.ISO_8859_1)
    assertFalse("The passphrase must never appear in the file", haystack.contains(passphrase))
    assertFalse("Entry names must not appear in the clear", haystack.contains("a.flac"))
  }
}

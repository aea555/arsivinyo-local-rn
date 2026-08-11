package expo.modules.localdownloader.backup

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream

/**
 * Tests for section planning and the two-stage duplicate check, driven through real backup
 * files but with fake stores standing in for the vault and the music library.
 */
class BackupSectionsTest {

  private fun fastKdf() =
    BackupCrypto.KdfParams(memoryKiB = 8 * 1024, iterations = 1, parallelism = 1)

  private fun secret(text: String = "a strong test passphrase") =
    BackupContainer.SlotSecret(
      BackupFormat.DEFAULT_KEY_SLOT,
      text.toCharArray(),
      BackupFormat.SECRET_KIND_PASSPHRASE,
    )

  private fun bytes(n: Int, seed: Long): ByteArray =
    ByteArray(n).also { java.util.Random(seed).nextBytes(it) }

  private fun mediaItem(name: String, payload: ByteArray) = BackupSections.BackupItem(
    name = name,
    kind = BackupSections.KIND_MEDIA,
    size = payload.size.toLong(),
    meta = JSONObject().apply { put("title", name.substringBeforeLast('.')) },
    writePayload = { out -> out.write(payload) },
  )

  private fun writeSections(sections: List<BackupContainer.PlannedSection>): ByteArray =
    ByteArrayOutputStream().also { out ->
      BackupContainer.write(
        output = out,
        secrets = listOf(secret()),
        sections = sections,
        appVersion = "2.4.0-beta.1",
        appVersionCode = 20400,
        createdAt = 1L,
        kdf = fastKdf(),
      )
    }.toByteArray()

  /** Collects everything a restore hands it, and reports what it already holds. */
  private open class FakeStore(
    existing: Map<String, ByteArray> = emptyMap(),
  ) : BackupSections.RestoreTarget {
    val stored = linkedMapOf<String, ByteArray>()
    val committed = mutableListOf<String>()
    val discarded = mutableListOf<String>()
    var sizeChecks = 0
    var hashChecks = 0

    private val existingBySize = existing.values.groupBy { it.size.toLong() }
    private val existingHashes =
      existing.values.map { BackupContainer.sha256(ByteArrayInputStream(it)) }.toSet()

    private val index = object : BackupSections.DuplicateIndex {
      override fun couldCollideAt(size: Long): Boolean {
        sizeChecks++
        return existingBySize.containsKey(size)
      }

      override fun isDuplicate(sha256: String, size: Long): Boolean {
        hashChecks++
        return existingHashes.contains(sha256)
      }
    }

    override fun duplicates() = index

    override fun store(header: BackupFormat.EntryHeader, payload: InputStream): Any? {
      stored[header.name] = payload.readBytes()
      return header.name
    }

    override fun discard(token: Any?) {
      val name = token as? String ?: return
      stored.remove(name)
      discarded.add(name)
    }

    override fun commit(token: Any?, trailer: BackupFormat.EntryTrailer) {
      committed.add(token as String)
    }
  }

  private fun restoreInto(
    file: ByteArray,
    target: BackupSections.RestoreTarget,
    sections: Set<String>,
  ): List<BackupSections.ItemResult> {
    val results = mutableListOf<BackupSections.ItemResult>()
    val input = ByteArrayInputStream(file)
    val header = BackupContainer.peek(input)
    BackupContainer.read(input, header, listOf(secret()), sections) { entry ->
      results.add(BackupSections.restoreEntry(entry, target))
    }
    return results
  }

  // ------------------------------------------------------------------ planning

  @Test
  fun planSummarisesItemsForTheImportPreview() {
    val section = BackupSections.plan(
      BackupFormat.SECTION_MUSIC,
      listOf(mediaItem("a.flac", bytes(1000, 1L)), mediaItem("b.flac", bytes(2500, 2L))),
    )

    assertEquals(BackupFormat.SECTION_MUSIC, section.id)
    assertEquals(2, section.itemCount)
    assertEquals(3500L, section.plaintextBytes)
    assertEquals(BackupFormat.DEFAULT_KEY_SLOT, section.keySlot)
  }

  @Test
  fun blobItemsCarryTheirIdentityInMetadata() {
    // A restore has to route playlists and preferences without guessing from the filename.
    val json = JSONObject().apply { put("playlists", 3) }
    val item = BackupSections.blobItem(BackupSections.BLOB_MUSIC_INDEX, json)

    assertEquals(BackupSections.KIND_BLOB, item.kind)
    assertEquals(BackupSections.BLOB_MUSIC_INDEX, item.meta.optString("blobId"))

    val written = ByteArrayOutputStream().also { item.writePayload(it) }.toByteArray()
    assertEquals(3, JSONObject(String(written)).optInt("playlists"))
    assertEquals(written.size.toLong(), item.size)
  }

  @Test
  fun mediaAndBlobsAndThumbnailsSurviveTogether() {
    val audio = bytes(200_000, 1L)
    val art = bytes(9_000, 2L)
    val file = writeSections(
      listOf(
        BackupSections.plan(
          BackupFormat.SECTION_MUSIC,
          listOf(
            mediaItem("song.flac", audio),
            BackupSections.BackupItem(
              name = "song.jpg",
              kind = BackupSections.KIND_THUMBNAIL,
              size = art.size.toLong(),
              meta = JSONObject().apply { put("ownerId", "song-1") },
              writePayload = { out -> out.write(art) },
            ),
            BackupSections.blobItem(
              BackupSections.BLOB_MUSIC_INDEX,
              JSONObject().apply { put("favorites", "yes") },
            ),
          ),
        )
      )
    )

    val kinds = mutableMapOf<String, String>()
    val store = FakeStore()
    restoreInto(file, store, setOf(BackupFormat.SECTION_MUSIC))

    val input = ByteArrayInputStream(file)
    val header = BackupContainer.peek(input)
    BackupContainer.read(input, header, listOf(secret()), setOf(BackupFormat.SECTION_MUSIC)) { e ->
      kinds[e.header.name] = e.header.kind
    }

    assertEquals(BackupSections.KIND_MEDIA, kinds["song.flac"])
    assertEquals(BackupSections.KIND_THUMBNAIL, kinds["song.jpg"])
    assertEquals(BackupSections.KIND_BLOB, kinds["music-index.json"])
    assertArrayEquals(audio, store.stored["song.flac"])
    assertArrayEquals(art, store.stored["song.jpg"])
  }

  // ------------------------------------------------------------------ duplicates

  @Test
  fun aFreshLibraryTakesEverythingAndNeverHashes() {
    // Nothing stored means nothing can collide, so the expensive path must not run at all.
    val file = writeSections(
      listOf(
        BackupSections.plan(
          BackupFormat.SECTION_MUSIC,
          listOf(mediaItem("a.flac", bytes(1000, 1L)), mediaItem("b.flac", bytes(2000, 2L))),
        )
      )
    )

    val store = FakeStore()
    val results = restoreInto(file, store, setOf(BackupFormat.SECTION_MUSIC))

    assertTrue(results.all { it.outcome == BackupSections.ItemOutcome.RESTORED })
    assertEquals(0, store.hashChecks)
    assertEquals(listOf("a.flac", "b.flac"), store.committed)
  }

  @Test
  fun anIdenticalFileUnderADifferentNameIsSkipped() {
    // The requirement is duplicate detection by content, not by name.
    val payload = bytes(4_096, 5L)
    val file = writeSections(
      listOf(BackupSections.plan(BackupFormat.SECTION_MUSIC, listOf(mediaItem("renamed.flac", payload))))
    )

    val store = FakeStore(existing = mapOf("original.flac" to payload))
    val results = restoreInto(file, store, setOf(BackupFormat.SECTION_MUSIC))

    assertEquals(BackupSections.ItemOutcome.SKIPPED_DUPLICATE, results.single().outcome)
    assertEquals(listOf("renamed.flac"), store.discarded)
    assertTrue("A duplicate must not be committed", store.committed.isEmpty())
  }

  @Test
  fun aDifferentFileOfTheSameSizeIsKept() {
    // Size collision alone must not be treated as a duplicate — that would silently drop
    // real content.
    val existing = bytes(4_096, 5L)
    val incoming = bytes(4_096, 6L)
    val file = writeSections(
      listOf(BackupSections.plan(BackupFormat.SECTION_MUSIC, listOf(mediaItem("new.flac", incoming))))
    )

    val store = FakeStore(existing = mapOf("old.flac" to existing))
    val results = restoreInto(file, store, setOf(BackupFormat.SECTION_MUSIC))

    assertEquals(BackupSections.ItemOutcome.RESTORED, results.single().outcome)
    assertEquals(1, store.hashChecks)
    assertArrayEquals(incoming, store.stored["new.flac"])
  }

  @Test
  fun aWrongAdvisorySizeCannotSmuggleADuplicatePast() {
    // The cheap filter uses the header's advisory size. If a collector understates it, the
    // trailer's real size must still trigger the hash check.
    val payload = bytes(4_096, 5L)
    val understated = BackupSections.BackupItem(
      name = "sneaky.flac",
      kind = BackupSections.KIND_MEDIA,
      size = 1L, // deliberately wrong
      writePayload = { out -> out.write(payload) },
    )
    val file = writeSections(
      listOf(BackupSections.plan(BackupFormat.SECTION_MUSIC, listOf(understated)))
    )

    val store = FakeStore(existing = mapOf("original.flac" to payload))
    val results = restoreInto(file, store, setOf(BackupFormat.SECTION_MUSIC))

    assertEquals(BackupSections.ItemOutcome.SKIPPED_DUPLICATE, results.single().outcome)
  }

  @Test
  fun anUnwantedKindIsSkippedWithoutBeingStored() {
    val file = writeSections(
      listOf(
        BackupSections.plan(
          BackupFormat.SECTION_MUSIC,
          listOf(
            mediaItem("keep.flac", bytes(500, 1L)),
            BackupSections.blobItem(BackupSections.BLOB_AUTO_PRESETS, JSONObject()),
          ),
        )
      )
    )

    val mediaOnly = object : FakeStore() {
      override fun screen(header: BackupFormat.EntryHeader) =
        if (header.kind == BackupSections.KIND_MEDIA) null
        else BackupSections.ItemOutcome.SKIPPED_UNWANTED
    }
    val results = restoreInto(file, mediaOnly, setOf(BackupFormat.SECTION_MUSIC))

    assertEquals(
      listOf(BackupSections.ItemOutcome.RESTORED, BackupSections.ItemOutcome.SKIPPED_UNWANTED),
      results.map { it.outcome },
    )
    assertEquals(setOf("keep.flac"), mediaOnly.stored.keys)
  }

  @Test
  fun anIncompleteEntryIsRefusedAndNeverReachesTheStore() {
    // Its size and hash verify — only the flag says it is half a file. If the target were
    // allowed to keep it, a restore would silently install truncated media.
    val partial = bytes(6_000, 21L)
    val file = ByteArrayOutputStream().also { out ->
      BackupContainer.write(
        output = out,
        secrets = listOf(secret()),
        sections = listOf(
          BackupContainer.PlannedSection(
            id = BackupFormat.SECTION_MUSIC,
            itemCount = 2,
            plaintextBytes = 0L,
            writeEntries = { sink ->
              sink.add(BackupFormat.EntryHeader("cut.flac", 999L, BackupSections.KIND_MEDIA)) { stream ->
                stream.write(partial)
                throw IllegalStateException("source vanished")
              }
              sink.addStream(
                BackupFormat.EntryHeader("intact.flac", 500L, BackupSections.KIND_MEDIA),
                ByteArrayInputStream(bytes(500, 22L)),
              )
            },
          )
        ),
        appVersion = "v", appVersionCode = 1, createdAt = 1L, kdf = fastKdf(),
      )
    }.toByteArray()

    val store = FakeStore()
    val results = restoreInto(file, store, setOf(BackupFormat.SECTION_MUSIC))

    assertEquals(BackupSections.ItemOutcome.FAILED, results.first { it.name == "cut.flac" }.outcome)
    assertTrue(
      "The truncated item must be discarded, not committed",
      !store.committed.contains("cut.flac"),
    )
    assertTrue("It must be undone", store.discarded.contains("cut.flac"))

    // And the healthy entry after it still restores.
    assertEquals(
      BackupSections.ItemOutcome.RESTORED,
      results.first { it.name == "intact.flac" }.outcome,
    )
  }

  // ------------------------------------------------------------------ partial failure

  @Test
  fun oneFailingItemDoesNotAbandonTheRest() {
    // Import is incremental by design: a single unwritable item should be reported, not take
    // the whole restore down with it.
    val file = writeSections(
      listOf(
        BackupSections.plan(
          BackupFormat.SECTION_MUSIC,
          listOf(
            mediaItem("good-one.flac", bytes(1000, 1L)),
            mediaItem("bad.flac", bytes(1000, 2L)),
            mediaItem("good-two.flac", bytes(1000, 3L)),
          ),
        )
      )
    )

    val flaky = object : FakeStore() {
      override fun store(header: BackupFormat.EntryHeader, payload: InputStream): Any? {
        if (header.name == "bad.flac") throw IllegalStateException("disk full")
        return super.store(header, payload)
      }
    }
    val results = restoreInto(file, flaky, setOf(BackupFormat.SECTION_MUSIC))

    assertEquals(
      listOf(
        BackupSections.ItemOutcome.RESTORED,
        BackupSections.ItemOutcome.FAILED,
        BackupSections.ItemOutcome.RESTORED,
      ),
      results.map { it.outcome },
    )
    assertEquals("disk full", results[1].error)
    assertEquals(setOf("good-one.flac", "good-two.flac"), flaky.stored.keys)
  }

  @Test
  fun aFailedItemDoesNotDesynchroniseTheStream() {
    // The failing item's payload is partly read; the next entry must still parse.
    val third = bytes(50_000, 9L)
    val file = writeSections(
      listOf(
        BackupSections.plan(
          BackupFormat.SECTION_VAULT,
          listOf(
            mediaItem("a.mp4", bytes(80_000, 7L)),
            mediaItem("explodes.mp4", bytes(90_000, 8L)),
            mediaItem("c.mp4", third),
          ),
        )
      )
    )

    val partialReader = object : FakeStore() {
      override fun store(header: BackupFormat.EntryHeader, payload: InputStream): Any? {
        if (header.name == "explodes.mp4") {
          payload.read(ByteArray(1024)) // consume some, then fail
          throw IllegalStateException("boom")
        }
        return super.store(header, payload)
      }
    }
    restoreInto(file, partialReader, setOf(BackupFormat.SECTION_VAULT))

    assertArrayEquals(third, partialReader.stored["c.mp4"])
  }

  @Test
  fun corruptionIsReportedAgainstTheItemItAffects() {
    val payload = bytes(20_000, 30L)
    val file = writeSections(
      listOf(BackupSections.plan(BackupFormat.SECTION_MUSIC, listOf(mediaItem("only.flac", payload))))
    )
    // Flip a byte inside the section ciphertext.
    val corrupted = file.copyOf().also { it[it.size - 2000] = (it[it.size - 2000] + 1).toByte() }

    val store = FakeStore()
    val results = runCatching { restoreInto(corrupted, store, setOf(BackupFormat.SECTION_MUSIC)) }

    // Either the entry is reported failed, or the section itself refuses to decrypt — both
    // are acceptable, but the damaged item must never be reported as restored.
    val outcomes = results.getOrDefault(emptyList()).map { it.outcome }
    assertFalse(
      "Corrupted content must not be reported as restored",
      outcomes.contains(BackupSections.ItemOutcome.RESTORED),
    )
    assertTrue("Corruption must not be silently committed", store.committed.isEmpty())
  }
}

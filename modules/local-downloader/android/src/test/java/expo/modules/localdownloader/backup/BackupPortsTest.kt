package expo.modules.localdownloader.backup

import org.json.JSONObject
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream
import java.io.InputStream
import java.io.OutputStream

/**
 * Round-trips real backup files through fake stores.
 *
 * The fakes stand in for the vault, the music library and the cookie store, which lets the
 * collectors, the id remapping and the duplicate policy be exercised end to end without a
 * device — the real implementations only translate these calls into MediaStore, Keystore and
 * SAF operations.
 */
class BackupPortsTest {

  private companion object {
    /** In the companion so the nested fakes below can reach it. */
    fun hash(b: ByteArray) = BackupContainer.sha256(ByteArrayInputStream(b))
  }

  private fun fastKdf() =
    BackupCrypto.KdfParams(memoryKiB = 8 * 1024, iterations = 1, parallelism = 1)

  private fun secret() = BackupContainer.SlotSecret(
    BackupFormat.DEFAULT_KEY_SLOT,
    "a strong test passphrase".toCharArray(),
    BackupFormat.SECRET_KIND_PASSPHRASE,
  )

  private fun bytes(n: Int, seed: Long): ByteArray =
    ByteArray(n).also { java.util.Random(seed).nextBytes(it) }


  // ------------------------------------------------------------------ fakes

  private class FakeVault : BackupPorts.VaultPort {
    /** id -> plaintext. The real store keeps these Keystore-encrypted. */
    val content = linkedMapOf<String, ByteArray>()
    val titles = mutableMapOf<String, String>()
    val thumbs = mutableMapOf<String, ByteArray>()
    val metas = mutableMapOf<String, JSONObject>()
    /** Entries whose plaintext size cannot be reported cheaply (legacy cipher versions). */
    val sizeUnknown = mutableSetOf<String>()
    var nextId = 100
    var hashCalls = 0

    fun add(id: String, title: String, payload: ByteArray, thumb: ByteArray? = null): FakeVault {
      content[id] = payload
      titles[id] = title
      metas[id] = JSONObject().apply { put("tags", "private") }
      thumb?.let { thumbs[id] = it }
      return this
    }

    override fun list() = content.keys.map { id ->
      BackupPorts.VaultRecord(
        id = id,
        title = titles.getValue(id),
        mimeType = "video/mp4",
        meta = metas.getValue(id),
        plaintextSize = if (sizeUnknown.contains(id)) null else content.getValue(id).size.toLong(),
      )
    }

    override fun writePlaintext(record: BackupPorts.VaultRecord, out: OutputStream) {
      out.write(content.getValue(record.id))
    }

    override fun hashOf(record: BackupPorts.VaultRecord): String {
      hashCalls++
      return hash(content.getValue(record.id))
    }

    override fun restore(
      staged: java.io.File,
      name: String,
      mimeType: String,
      meta: JSONObject,
    ): String {
      val id = "restored-${nextId++}"
      content[id] = staged.readBytes()
      titles[id] = name
      metas[id] = meta
      // The real importer regenerates the thumbnail from the video, which is why none
      // travels in the backup.
      thumbs[id] = byteArrayOf(0xFF.toByte())
      return id
    }
  }

  private class FakeMusic : BackupPorts.MusicPort {
    val content = linkedMapOf<String, ByteArray>()
    val names = mutableMapOf<String, String>()
    val thumbs = mutableMapOf<String, ByteArray>()
    var playlists = JSONObject().apply { put("playlists", "none") }
    var autoPresets: JSONObject? = null
    var nextId = 500
    var hashCalls = 0

    fun add(id: String, name: String, payload: ByteArray, thumb: ByteArray? = null): FakeMusic {
      content[id] = payload
      names[id] = name
      thumb?.let { thumbs[id] = it }
      return this
    }

    override fun list() = content.keys.map { id ->
      BackupPorts.MusicRecord(
        id = id,
        fileName = names.getValue(id),
        sizeBytes = content.getValue(id).size.toLong(),
        meta = JSONObject().apply { put("title", names.getValue(id).substringBeforeLast('.')) },
        thumbnailPath = if (thumbs.containsKey(id)) "/thumbs/$id.jpg" else null,
      )
    }

    override fun open(record: BackupPorts.MusicRecord) =
      ByteArrayInputStream(content.getValue(record.id))

    override fun openThumbnail(record: BackupPorts.MusicRecord): InputStream? =
      thumbs[record.id]?.let { ByteArrayInputStream(it) }

    override fun hashOf(record: BackupPorts.MusicRecord): String {
      hashCalls++
      return hash(content.getValue(record.id))
    }

    override fun playlistsJson() = playlists
    override fun autoPresetConfig() = autoPresets

    override fun restore(
      staged: java.io.File,
      name: String,
      meta: JSONObject,
      thumbnail: java.io.File?,
    ): String {
      val id = "song-${nextId++}"
      content[id] = staged.readBytes()
      names[id] = name
      thumbnail?.let { thumbs[id] = it.readBytes() }
      return id
    }

    var lastIdMap: Map<String, String> = emptyMap()

    override fun restorePlaylists(json: JSONObject, idMap: Map<String, String>) {
      playlists = json
      lastIdMap = idMap
    }

    override fun restoreAutoPresetConfig(json: JSONObject) {
      autoPresets = json
    }
  }

  private class FakeCookies : BackupPorts.CookiePort {
    val jars = linkedMapOf<Pair<String, String>, ByteArray>()
    val defaults = mutableSetOf<Pair<String, String>>()

    fun add(platform: String, profile: String, jar: String, isDefault: Boolean = false): FakeCookies {
      jars[platform to profile] = jar.toByteArray()
      if (isDefault) defaults.add(platform to profile)
      return this
    }

    override fun list() = jars.keys.map {
      BackupPorts.CookieRecord(it.first, it.second, defaults.contains(it))
    }

    override fun readPlaintext(record: BackupPorts.CookieRecord) =
      jars.getValue(record.platform to record.profileName)

    override fun restore(
      platform: String,
      profileName: String,
      isDefault: Boolean,
      plaintext: ByteArray,
    ) {
      jars[platform to profileName] = plaintext
      if (isDefault) defaults.add(platform to profileName)
    }
  }

  /** Real scratch files, so the tests also prove staging is cleaned up. */
  private class TempStaging : BackupPorts.Staging {
    val dir: java.io.File = java.io.File(
      System.getProperty("java.io.tmpdir"),
      "avsbck-test-${System.nanoTime()}",
    ).apply { mkdirs() }

    override fun newStagingFile(name: String) = java.io.File.createTempFile("staged", null, dir)

    fun leftovers(): List<String> = dir.listFiles()?.map { it.name } ?: emptyList()
  }

  // ------------------------------------------------------------------ helpers

  private fun writeBackup(sections: List<BackupContainer.PlannedSection>): ByteArray =
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

  private fun restore(
    file: ByteArray,
    targets: Map<String, BackupSections.RestoreTarget>,
  ): List<BackupSections.ItemResult> {
    val results = mutableListOf<BackupSections.ItemResult>()
    val input = ByteArrayInputStream(file)
    val header = BackupContainer.peek(input)
    BackupContainer.read(input, header, listOf(secret()), targets.keys) { entry ->
      results.add(BackupSections.restoreEntry(entry, targets.getValue(entry.sectionId)))
    }
    return results
  }

  // ------------------------------------------------------------------ vault

  @Test
  fun vaultRoundTripsIntoAFreshDevice() {
    val videoA = bytes(300_000, 1L)
    val videoB = bytes(150_000, 2L)
    val art = bytes(4_000, 3L)
    val source = FakeVault().add("v1", "holiday.mp4", videoA, art).add("v2", "concert.mp4", videoB)

    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_VAULT, BackupPorts.collectVault(source)))
    )

    val destination = FakeVault()
    val results = restore(
      file,
      mapOf(BackupFormat.SECTION_VAULT to BackupPorts.vaultTarget(destination, TempStaging())),
    )

    assertTrue(results.none { it.outcome == BackupSections.ItemOutcome.FAILED })
    assertEquals(2, destination.content.size)
    assertArrayEquals(videoA, destination.content.values.first())
    assertArrayEquals(videoB, destination.content.values.last())
    assertEquals(listOf("holiday.mp4", "concert.mp4"), destination.titles.values.toList())
  }

  @Test
  fun vaultThumbnailsAreNotPutInTheBackupAtAll() {
    // importFileToPrivateVault regenerates a thumbnail from the video and encrypts it under
    // the device's own Keystore key. Exporting one would be wasted bytes for something the
    // destination cannot use and will rebuild anyway.
    val source = FakeVault().add("v1", "holiday.mp4", bytes(1_000, 1L), bytes(4_000, 3L))

    val items = BackupPorts.collectVault(source)

    assertEquals("Only the video itself should be collected", 1, items.size)
    assertEquals(BackupSections.KIND_MEDIA, items.single().kind)
    assertTrue(
      "No thumbnail entry should exist",
      items.none { it.kind == BackupSections.KIND_THUMBNAIL },
    )
  }

  @Test
  fun aRestoredVaultVideoStillEndsUpWithAThumbnail() {
    // Not exporting them is only acceptable because the importer rebuilds them.
    val source = FakeVault().add("v1", "holiday.mp4", bytes(1_000, 1L), bytes(4_000, 3L))
    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_VAULT, BackupPorts.collectVault(source)))
    )

    val destination = FakeVault()
    restore(file, mapOf(BackupFormat.SECTION_VAULT to BackupPorts.vaultTarget(destination, TempStaging())))

    val newId = destination.content.keys.single()
    assertTrue("The importer should have generated one", destination.thumbs.containsKey(newId))
  }

  @Test
  fun musicArtworkIsStagedAheadOfItsTrack() {
    // The sounds store only accepts artwork while registering a track, so the cover has to
    // arrive first. If the order flipped, every restored track would lose its art — and for
    // M4A the art is a sidecar that cannot be re-extracted from the file.
    val source = FakeMusic().add("s1", "song.flac", bytes(1_000, 1L), bytes(500, 2L))

    val kinds = BackupPorts.collectMusic(source).map { it.kind }

    assertEquals(
      listOf(BackupSections.KIND_THUMBNAIL, BackupSections.KIND_MEDIA, BackupSections.KIND_BLOB),
      kinds,
    )
  }

  @Test
  fun vaultMetadataSurvivesButKeystoreSpecificFieldsDoNot() {
    // encFileName and cipherVersion describe a blob that cannot travel; carrying them would
    // point the restored entry at a file that does not exist.
    val source = FakeVault().add("v1", "holiday.mp4", bytes(1_000, 1L))
    source.metas["v1"] = JSONObject().apply {
      put("tags", "private")
      put("folderId", "trips")
      put("encFileName", "abc.enc")
      put("cipherVersion", "v4")
      put("sizeBytesEncrypted", 99999)
    }

    val items = BackupPorts.collectVault(source)
    val meta = items.first().meta

    assertEquals("trips", meta.optString("folderId"))
    assertEquals("private", meta.optString("tags"))
    assertEquals("v1", meta.optString("vaultId"))
    assertTrue("encFileName must not travel", meta.optString("encFileName").isEmpty())
    assertTrue("cipherVersion must not travel", meta.optString("cipherVersion").isEmpty())
    assertEquals(0, meta.optInt("sizeBytesEncrypted", 0))
  }

  @Test
  fun restoringTheSameVaultBackupTwiceAddsNothingTheSecondTime() {
    val videoA = bytes(300_000, 1L)
    val source = FakeVault().add("v1", "holiday.mp4", videoA)
    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_VAULT, BackupPorts.collectVault(source)))
    )

    val destination = FakeVault()
    restore(file, mapOf(BackupFormat.SECTION_VAULT to BackupPorts.vaultTarget(destination, TempStaging())))
    val afterFirst = destination.content.size

    val second = restore(
      file,
      mapOf(BackupFormat.SECTION_VAULT to BackupPorts.vaultTarget(destination, TempStaging())),
    )

    assertEquals(1, afterFirst)
    assertEquals("Re-importing must not duplicate", afterFirst, destination.content.size)
    assertTrue(
      second.any { it.outcome == BackupSections.ItemOutcome.SKIPPED_DUPLICATE },
    )
  }

  @Test
  fun anEntryWhoseSizeCannotBeReportedIsStillDeduplicated() {
    // Legacy vault cipher versions cannot report plaintext size without decrypting, so they
    // report null and must fall back to hashing rather than being assumed unique.
    val video = bytes(50_000, 4L)
    val destination = FakeVault().add("legacy", "old.mp4", video)
    destination.sizeUnknown.add("legacy")

    val source = FakeVault().add("v1", "same-content.mp4", video)
    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_VAULT, BackupPorts.collectVault(source)))
    )

    val results = restore(
      file,
      mapOf(BackupFormat.SECTION_VAULT to BackupPorts.vaultTarget(destination, TempStaging())),
    )

    assertEquals(
      BackupSections.ItemOutcome.SKIPPED_DUPLICATE,
      results.first { it.name == "same-content.mp4" }.outcome,
    )
    assertTrue("The unknown-size entry had to be hashed", destination.hashCalls > 0)
  }

  @Test
  fun stagingFilesAreCleanedUpOnBothPathsTaken() {
    // A restore that both keeps one item and rejects another as a duplicate must leave no
    // scratch files behind — otherwise every import silently fills the cache directory.
    val kept = bytes(30_000, 41L)
    val duplicate = bytes(30_001, 42L)
    val source = FakeVault().add("v1", "kept.mp4", kept).add("v2", "dupe.mp4", duplicate)
    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_VAULT, BackupPorts.collectVault(source)))
    )

    val destination = FakeVault().add("already-here", "existing.mp4", duplicate)
    val staging = TempStaging()
    val results = restore(
      file,
      mapOf(BackupFormat.SECTION_VAULT to BackupPorts.vaultTarget(destination, staging)),
    )

    assertEquals(
      BackupSections.ItemOutcome.RESTORED,
      results.first { it.name == "kept.mp4" }.outcome,
    )
    assertEquals(
      BackupSections.ItemOutcome.SKIPPED_DUPLICATE,
      results.first { it.name == "dupe.mp4" }.outcome,
    )
    assertEquals("Staged files were left behind", emptyList<String>(), staging.leftovers())
  }

  @Test
  fun aDuplicateIsNeverWrittenIntoTheLibraryAtAll() {
    // Detecting a duplicate after storing it and deleting it afterwards would be visibly
    // different: the store would have seen a write. Staging means it never does.
    val payload = bytes(30_000, 43L)
    val source = FakeVault().add("v1", "incoming.mp4", payload)
    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_VAULT, BackupPorts.collectVault(source)))
    )

    val destination = FakeVault().add("already-here", "existing.mp4", payload)
    val before = destination.nextId
    restore(file, mapOf(BackupFormat.SECTION_VAULT to BackupPorts.vaultTarget(destination, TempStaging())))

    assertEquals("The store must never have been asked to write a duplicate", before, destination.nextId)
    assertEquals(1, destination.content.size)
  }

  // ------------------------------------------------------------------ music

  @Test
  fun musicRoundTripsWithPlaylistsAndPresets() {
    val track = bytes(200_000, 5L)
    val art = bytes(9_000, 6L)
    val source = FakeMusic().add("s1", "song.flac", track, art)
    source.playlists = JSONObject().apply {
      put("playlists", "favourites+mixtape")
      put("favorites", "s1")
    }
    source.autoPresets = JSONObject().apply { put("presetIds", "slowed-reverb") }

    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_MUSIC, BackupPorts.collectMusic(source)))
    )

    val destination = FakeMusic()
    restore(file, mapOf(BackupFormat.SECTION_MUSIC to BackupPorts.musicTarget(destination, TempStaging())))

    val newId = destination.content.keys.single()
    assertArrayEquals(track, destination.content.getValue(newId))
    assertArrayEquals("Cover art did not follow its track", art, destination.thumbs[newId])
    assertEquals("favourites+mixtape", destination.playlists.optString("playlists"))
    assertEquals("slowed-reverb", destination.autoPresets!!.optString("presetIds"))
  }

  @Test
  fun playlistsArriveWithAMapFromOldSongIdsToNew() {
    // Playlists and favourites are lists of song ids, and ids are reassigned on restore. The
    // blob is emitted last so every track is already committed by the time it lands.
    val source = FakeMusic()
      .add("old-1", "one.flac", bytes(1_000, 1L))
      .add("old-2", "two.flac", bytes(2_000, 2L))
    source.playlists = JSONObject().apply { put("favorites", "old-1,old-2") }

    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_MUSIC, BackupPorts.collectMusic(source)))
    )

    val destination = FakeMusic()
    restore(file, mapOf(BackupFormat.SECTION_MUSIC to BackupPorts.musicTarget(destination, TempStaging())))

    val newIds = destination.content.keys.toList()
    assertEquals(2, newIds.size)
    assertEquals(
      "Every backed-up song id needs an entry",
      setOf("old-1", "old-2"),
      destination.lastIdMap.keys,
    )
    assertEquals(newIds.toSet(), destination.lastIdMap.values.toSet())
  }

  @Test
  fun aSkippedDuplicateLeavesNoStaleIdMapping() {
    // A duplicate is never stored, so it has no new id. Mapping it to something would point
    // a restored playlist at the wrong track.
    val shared = bytes(3_000, 8L)
    val source = FakeMusic().add("old-dupe", "dupe.flac", shared)
    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_MUSIC, BackupPorts.collectMusic(source)))
    )

    val destination = FakeMusic().add("already", "already.flac", shared)
    restore(file, mapOf(BackupFormat.SECTION_MUSIC to BackupPorts.musicTarget(destination, TempStaging())))

    assertTrue(
      "A duplicate must not appear in the id map",
      !destination.lastIdMap.containsKey("old-dupe"),
    )
  }

  @Test
  fun aMissingAutoPresetConfigIsSimplyAbsent() {
    // Nothing configured must not produce an empty blob that overwrites the destination's
    // own configuration on restore.
    val source = FakeMusic().add("s1", "song.flac", bytes(100, 1L))
    source.autoPresets = null

    val items = BackupPorts.collectMusic(source)

    assertNull(items.firstOrNull { it.meta.optString("blobId") == BackupSections.BLOB_AUTO_PRESETS })
    assertTrue(items.any { it.meta.optString("blobId") == BackupSections.BLOB_MUSIC_INDEX })
  }

  @Test
  fun aTrackAlreadyPresentUnderAnotherNameIsSkipped() {
    val track = bytes(200_000, 5L)
    val source = FakeMusic().add("s1", "downloaded.flac", track)
    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_MUSIC, BackupPorts.collectMusic(source)))
    )

    val destination = FakeMusic().add("existing", "same-song-renamed.flac", track)
    val results = restore(
      file,
      mapOf(BackupFormat.SECTION_MUSIC to BackupPorts.musicTarget(destination, TempStaging())),
    )

    assertEquals(
      BackupSections.ItemOutcome.SKIPPED_DUPLICATE,
      results.first { it.name == "downloaded.flac" }.outcome,
    )
    assertEquals("Nothing new should have been added", 1, destination.content.size)
  }

  @Test
  fun onlyTheSizeMatchedCandidatesAreEverHashed() {
    // The whole point of the size prefilter: restoring into a big library must not hash the
    // whole library.
    val incoming = bytes(1_000, 9L)
    val source = FakeMusic().add("s1", "new.flac", incoming)
    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_MUSIC, BackupPorts.collectMusic(source)))
    )

    val destination = FakeMusic()
    repeat(20) { i -> destination.add("old$i", "old$i.flac", bytes(2_000 + i, i.toLong())) }
    destination.add("collides", "collides.flac", bytes(1_000, 99L)) // same size, different bytes

    val results = restore(
      file,
      mapOf(BackupFormat.SECTION_MUSIC to BackupPorts.musicTarget(destination, TempStaging())),
    )

    assertEquals(
      BackupSections.ItemOutcome.RESTORED,
      results.first { it.name == "new.flac" }.outcome,
    )
    assertEquals("Only the one size-matched track should have been hashed", 1, destination.hashCalls)
  }

  // ------------------------------------------------------------------ cookies

  @Test
  fun cookieProfilesRoundTripWithTheirPlatformAndDefaultFlag() {
    val source = FakeCookies()
      .add("youtube", "main", "SID=abc123", isDefault = true)
      .add("youtube", "alt", "SID=def456")
      .add("instagram", "main", "sessionid=xyz")

    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_COOKIES, BackupPorts.collectCookies(source)))
    )

    val destination = FakeCookies()
    restore(file, mapOf(BackupFormat.SECTION_COOKIES to BackupPorts.cookieTarget(destination)))

    assertEquals(3, destination.jars.size)
    assertEquals("SID=abc123", String(destination.jars.getValue("youtube" to "main")))
    assertEquals("sessionid=xyz", String(destination.jars.getValue("instagram" to "main")))
    assertTrue(destination.defaults.contains("youtube" to "main"))
    assertTrue("A non-default profile must not become the default", !destination.defaults.contains("youtube" to "alt"))
  }

  @Test
  fun cookieJarsAreNotReadableFromTheBackupFile() {
    // These are session credentials — the reason they get their own section.
    val source = FakeCookies().add("youtube", "main", "SID=super-secret-value")
    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_COOKIES, BackupPorts.collectCookies(source)))
    )

    val haystack = String(file, Charsets.ISO_8859_1)
    assertTrue("Cookie value leaked", !haystack.contains("super-secret-value"))
    assertTrue("Profile name leaked", !haystack.contains("youtube"))
  }

  // ------------------------------------------------------------------ settings

  @Test
  fun settingsAreCapturedForTheTsLayerToApply() {
    val settings = JSONObject().apply {
      put("@arsivinyo_theme", """{"variant":"midnight"}""")
      put("@arsivinyo_download_location", "/storage/emulated/0/Download")
    }
    val file = writeBackup(
      listOf(BackupSections.plan(BackupFormat.SECTION_SETTINGS, BackupPorts.collectSettings(settings)))
    )

    val target = BackupPorts.SettingsTarget()
    restore(file, mapOf(BackupFormat.SECTION_SETTINGS to target))

    assertEquals("""{"variant":"midnight"}""", target.settings!!.optString("@arsivinyo_theme"))
    assertEquals("/storage/emulated/0/Download", target.settings!!.optString("@arsivinyo_download_location"))
  }

  // ------------------------------------------------------------------ whole file

  @Test
  fun everySectionSurvivesOneRoundTripTogether() {
    val vault = FakeVault().add("v1", "holiday.mp4", bytes(120_000, 1L), bytes(2_000, 2L))
    val music = FakeMusic().add("s1", "song.flac", bytes(80_000, 3L), bytes(1_500, 4L))
    music.autoPresets = JSONObject().apply { put("presetIds", "nightcore") }
    val cookies = FakeCookies().add("youtube", "main", "SID=abc", isDefault = true)
    val settings = JSONObject().apply { put("@arsivinyo_theme", "midnight") }

    val file = writeBackup(
      listOf(
        BackupSections.plan(BackupFormat.SECTION_VAULT, BackupPorts.collectVault(vault)),
        BackupSections.plan(BackupFormat.SECTION_MUSIC, BackupPorts.collectMusic(music)),
        BackupSections.plan(BackupFormat.SECTION_SETTINGS, BackupPorts.collectSettings(settings)),
        BackupSections.plan(BackupFormat.SECTION_COOKIES, BackupPorts.collectCookies(cookies)),
      )
    )

    val newVault = FakeVault()
    val newMusic = FakeMusic()
    val newCookies = FakeCookies()
    val newSettings = BackupPorts.SettingsTarget()
    val results = restore(
      file,
      mapOf(
        BackupFormat.SECTION_VAULT to BackupPorts.vaultTarget(newVault, TempStaging()),
        BackupFormat.SECTION_MUSIC to BackupPorts.musicTarget(newMusic, TempStaging()),
        BackupFormat.SECTION_SETTINGS to newSettings,
        BackupFormat.SECTION_COOKIES to BackupPorts.cookieTarget(newCookies),
      ),
    )

    assertTrue(
      "Nothing should have failed: ${results.filter { it.outcome == BackupSections.ItemOutcome.FAILED }}",
      results.none { it.outcome == BackupSections.ItemOutcome.FAILED },
    )
    assertEquals(1, newVault.content.size)
    assertEquals(1, newMusic.content.size)
    assertEquals(1, newCookies.jars.size)
    assertEquals("midnight", newSettings.settings!!.optString("@arsivinyo_theme"))
    assertEquals("nightcore", newMusic.autoPresets!!.optString("presetIds"))
  }

  @Test
  fun aUserCanRestoreMusicWithoutTouchingTheVault() {
    val vault = FakeVault().add("v1", "holiday.mp4", bytes(120_000, 1L))
    val music = FakeMusic().add("s1", "song.flac", bytes(80_000, 3L))
    val file = writeBackup(
      listOf(
        BackupSections.plan(BackupFormat.SECTION_VAULT, BackupPorts.collectVault(vault)),
        BackupSections.plan(BackupFormat.SECTION_MUSIC, BackupPorts.collectMusic(music)),
      )
    )

    val newVault = FakeVault()
    val newMusic = FakeMusic()
    restore(file, mapOf(BackupFormat.SECTION_MUSIC to BackupPorts.musicTarget(newMusic, TempStaging())))

    assertEquals("The vault section must not have been touched", 0, newVault.content.size)
    assertEquals(1, newMusic.content.size)
  }
}

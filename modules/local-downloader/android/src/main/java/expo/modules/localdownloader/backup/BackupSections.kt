package expo.modules.localdownloader.backup

import org.json.JSONObject
import java.io.InputStream
import java.io.OutputStream

/**
 * The bridge between the app's stores and the container format.
 *
 * Collectors describe what to back up as a list of [BackupItem]s — a name, some metadata,
 * and a lambda that writes the plaintext. They never touch framing, encryption or the
 * header. That keeps this layer free of Android APIs, so the section planning and the
 * duplicate logic below can be tested on the JVM with fakes.
 *
 * Item kinds are wire values recorded in every backup. Never rename one in place.
 */
object BackupSections {

  /** A video or audio file: the payload is the media itself. */
  const val KIND_MEDIA = "media"

  /** Cover art or a video thumbnail. `meta.ownerId` names the item it belongs to. */
  const val KIND_THUMBNAIL = "thumbnail"

  /**
   * A JSON blob rather than a file — playlists, preferences, the auto-apply preset config.
   * `meta.blobId` says which one, so a restore can route it without guessing from the name.
   */
  const val KIND_BLOB = "blob"

  /** A decrypted cookie profile. `meta.platform` and `meta.profileId` place it back. */
  const val KIND_COOKIE_PROFILE = "cookie-profile"

  /** Blob identifiers, also wire values. */
  const val BLOB_MUSIC_INDEX = "music-index"
  const val BLOB_AUTO_PRESETS = "auto-presets"
  const val BLOB_APP_SETTINGS = "app-settings"

  /**
   * One thing to put in a backup.
   *
   * [size] is advisory — used for the progress estimate and the first-stage duplicate
   * filter. [writePayload] may write a different number of bytes without breaking anything;
   * the trailer records what was actually written.
   */
  data class BackupItem(
    val name: String,
    val kind: String,
    val size: Long,
    val meta: JSONObject = JSONObject(),
    val writePayload: (OutputStream) -> Unit,
  )

  fun blobItem(blobId: String, json: JSONObject): BackupItem {
    val bytes = json.toString().toByteArray(Charsets.UTF_8)
    return BackupItem(
      name = "$blobId.json",
      kind = KIND_BLOB,
      size = bytes.size.toLong(),
      meta = JSONObject().apply { put("blobId", blobId) },
      writePayload = { out -> out.write(bytes) },
    )
  }

  /**
   * Turn collected items into a section the container can write.
   *
   * The items are produced eagerly (so the header can state a count) but their payloads are
   * written lazily, one at a time, as the section streams out.
   */
  fun plan(
    sectionId: String,
    items: List<BackupItem>,
    keySlot: String = BackupFormat.DEFAULT_KEY_SLOT,
  ): BackupContainer.PlannedSection = BackupContainer.PlannedSection(
    id = sectionId,
    keySlot = keySlot,
    itemCount = items.size,
    plaintextBytes = items.sumOf { it.size },
    writeEntries = { sink ->
      items.forEach { item ->
        sink.add(
          BackupFormat.EntryHeader(
            name = item.name,
            size = item.size,
            kind = item.kind,
            meta = item.meta,
          ),
          item.writePayload,
        )
      }
    },
  )

  // ------------------------------------------------------------------ duplicates

  /**
   * Decides whether an incoming item is already present, by content rather than by name.
   *
   * The hash only becomes available once an item's payload has streamed past, so this runs
   * in two stages. [couldCollideAt] is asked first, using nothing but the advisory size; if
   * it says no, the item is written straight to its destination and never hashed against
   * anything. Only when a size collides does the importer take the slower path of staging
   * the payload and asking [isDuplicate] afterwards.
   *
   * That ordering matters: the alternative — hashing the whole existing library up front —
   * would mean decrypting an entire vault before restoring a single file.
   */
  interface DuplicateIndex {
    /**
     * @return true if anything already stored has this size, meaning the content hash is
     * needed to tell them apart. Returning true is always safe, just slower.
     */
    fun couldCollideAt(size: Long): Boolean

    /**
     * @return true if [sha256] is already stored. Consulted only after a size collision.
     * [size] is the authoritative size from the trailer, so an implementation can hash
     * only the stored items that share it rather than the whole library.
     */
    fun isDuplicate(sha256: String, size: Long): Boolean

    /** Nothing stored yet, so nothing can collide. */
    companion object {
      val EMPTY = object : DuplicateIndex {
        override fun couldCollideAt(size: Long) = false
        override fun isDuplicate(sha256: String, size: Long) = false
      }
    }
  }

  /** What a restore did with one item, for the report shown at the end. */
  enum class ItemOutcome { RESTORED, SKIPPED_DUPLICATE, SKIPPED_UNWANTED, FAILED }

  data class ItemResult(
    val sectionId: String,
    val name: String,
    val outcome: ItemOutcome,
    val error: String? = null,
  )

  /**
   * Where restored items go. Implementations own the actual writing — into the vault, into
   * MediaStore, into AsyncStorage via the TS layer.
   */
  interface RestoreTarget {
    /** Duplicate detection for this section. */
    fun duplicates(): DuplicateIndex = DuplicateIndex.EMPTY

    /**
     * @return false to skip the item entirely without reading its payload — used for kinds
     * a target does not handle.
     */
    fun wants(header: BackupFormat.EntryHeader): Boolean = true

    /**
     * Consume [payload] and store it. Called only once the item is known to be wanted.
     *
     * The item may still turn out to be a duplicate afterwards, in which case
     * [discard] is called with whatever token this returned. Targets that staged the data
     * somewhere should return a handle they can undo.
     */
    fun store(header: BackupFormat.EntryHeader, payload: InputStream): Any?

    /** Undo a [store] that turned out to be a duplicate. */
    fun discard(token: Any?) = Unit

    /**
     * Finalise a stored item now that its content hash is known. Targets that record the
     * hash for cheap duplicate detection on later imports do it here.
     */
    fun commit(token: Any?, trailer: BackupFormat.EntryTrailer) = Unit
  }

  /**
   * Route one entry to its target, applying the two-stage duplicate check.
   *
   * Kept separate from [BackupContainer] so the policy — what counts as a duplicate, what
   * happens on failure — is testable without building a real backup file.
   */
  fun restoreEntry(entry: BackupContainer.RestoredEntry, target: RestoreTarget): ItemResult {
    val header = entry.header
    if (!target.wants(header)) {
      return ItemResult(entry.sectionId, header.name, ItemOutcome.SKIPPED_UNWANTED)
    }

    val duplicates = target.duplicates()
    val mightBeDuplicate = duplicates.couldCollideAt(header.size)

    var token: Any? = null
    try {
      token = target.store(header, entry.payload)
      val trailer = entry.verifiedTrailer()

      // The size that mattered is the real one from the trailer, not the advisory header
      // value — but the cheap filter above could only use the header. Re-check against the
      // trailer so a wrong advisory size cannot let a duplicate through.
      if (mightBeDuplicate || duplicates.couldCollideAt(trailer.size)) {
        if (duplicates.isDuplicate(trailer.sha256, trailer.size)) {
          target.discard(token)
          return ItemResult(entry.sectionId, header.name, ItemOutcome.SKIPPED_DUPLICATE)
        }
      }

      target.commit(token, trailer)
      return ItemResult(entry.sectionId, header.name, ItemOutcome.RESTORED)
    } catch (e: Exception) {
      // One unreadable item should not abandon the rest of the restore; the caller reports
      // what landed and what did not.
      runCatching { target.discard(token) }
      return ItemResult(
        entry.sectionId,
        header.name,
        ItemOutcome.FAILED,
        e.message ?: e::class.java.simpleName,
      )
    }
  }
}

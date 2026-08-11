package expo.modules.localdownloader.backup

import java.io.File
import java.io.InputStream
import java.io.OutputStream
import java.security.DigestInputStream
import java.security.MessageDigest

/**
 * Reading and writing whole `.avsbck` files, composing [BackupFormat]'s framing with
 * [BackupCrypto]'s key derivation.
 *
 * Both directions are strictly streaming: a section is produced or consumed entry by entry,
 * and no payload is ever held in memory. The vault can hold gigabytes of video, so anything
 * that buffers a whole item would fail on exactly the libraries most worth backing up.
 *
 * Neither side owns the streams it is handed. The caller opens the SAF document and closes
 * it, which keeps the "who closes what" question out of the framing code.
 */
object BackupContainer {

  private const val COPY_BUFFER_BYTES = 64 * 1024

  /** A secret plus the slot it unlocks. One entry means one passphrase for the whole file. */
  data class SlotSecret(
    val slotId: String,
    val secret: CharArray,
    val secretKind: String,
  ) {
    override fun equals(other: Any?): Boolean =
      other is SlotSecret && slotId == other.slotId &&
        secret.contentEquals(other.secret) && secretKind == other.secretKind

    override fun hashCode(): Int =
      31 * (31 * slotId.hashCode() + secret.contentHashCode()) + secretKind.hashCode()
  }

  /**
   * Reports which item is being handled, so a long job can show movement.
   *
   * [index] is zero-based and [total] comes from the section headers, which are advisory —
   * a collector that miscounts skews the percentage and nothing else.
   */
  fun interface ProgressListener {
    fun onItem(sectionId: String, name: String, index: Int, total: Int)
  }

  /** One item the exporter could not read in full. */
  data class ExportFailure(
    val sectionId: String,
    val name: String,
    val error: String,
  )

  /** Where a collector pushes the items of one section. */
  interface EntrySink {
    /**
     * Add one item. [writePayload] is handed a stream to write the plaintext into and may
     * write nothing at all; the sink hashes and counts the bytes as they pass.
     *
     * This is push-shaped rather than taking an [InputStream] because the vault only
     * decrypts *into* a stream — a pull-shaped sink would need a pipe and a second thread
     * to bridge the two.
     */
    fun add(header: BackupFormat.EntryHeader, writePayload: (OutputStream) -> Unit)

    /** Convenience for collectors that already hold a readable source. */
    fun addStream(header: BackupFormat.EntryHeader, source: InputStream) =
      add(header) { out -> copy(source, out) }
  }

  /**
   * One section to write. [itemCount] and [plaintextBytes] go in the plaintext header to
   * drive the import preview, so they should be the collector's best estimate — they are
   * advisory and a mismatch is not an error.
   */
  data class PlannedSection(
    val id: String,
    val keySlot: String = BackupFormat.DEFAULT_KEY_SLOT,
    val itemCount: Int,
    val plaintextBytes: Long,
    val writeEntries: (EntrySink) -> Unit,
  )

  // ------------------------------------------------------------------ writing

  /**
   * Write a complete backup to [output].
   *
   * Runs one Argon2id derivation per distinct slot, so the default single-passphrase backup
   * pays that cost once no matter how many sections it holds.
   */
  fun write(
    output: OutputStream,
    secrets: List<SlotSecret>,
    sections: List<PlannedSection>,
    appVersion: String,
    appVersionCode: Int,
    createdAt: Long,
    kdf: BackupCrypto.KdfParams = BackupCrypto.KdfParams(),
    progress: ProgressListener? = null,
  ): List<ExportFailure> {
    val failures = mutableListOf<ExportFailure>()
    val totalItems = sections.sumOf { it.itemCount }
    var handled = 0
    require(secrets.isNotEmpty()) { "A backup needs at least one key slot" }
    sections.forEach { section ->
      require(secrets.any { it.slotId == section.keySlot }) {
        "Section '${section.id}' names key slot '${section.keySlot}', which has no secret"
      }
    }

    val masterKeys = mutableMapOf<String, ByteArray>()
    try {
      val slots = secrets.map { secret ->
        val salt = BackupCrypto.randomSalt()
        val masterKey = BackupCrypto.deriveMasterKey(secret.secret, salt, kdf)
        masterKeys[secret.slotId] = masterKey
        BackupFormat.KeySlot(
          id = secret.slotId,
          salt = salt,
          verifier = BackupCrypto.verifierFor(masterKey),
          secretKind = secret.secretKind,
        )
      }

      val header = BackupFormat.Header(
        formatVersion = BackupFormat.FORMAT_VERSION,
        createdAt = createdAt,
        appVersion = appVersion,
        appVersionCode = appVersionCode,
        kdf = kdf,
        keySlots = slots,
        sections = sections.map {
          BackupFormat.SectionEntry(it.id, it.keySlot, it.itemCount, it.plaintextBytes)
        },
      )
      BackupFormat.writePreamble(output, BackupFormat.encodeHeader(header))

      // Payload order must match the header's section order — that pairing is the only
      // thing tying a payload to its declaration now that there are no offsets.
      sections.forEach { section ->
        val masterKey = masterKeys.getValue(section.keySlot)
        val sectionKey = BackupCrypto.sectionKey(masterKey, section.id)
        try {
          val framing = BackupFormat.ChunkedOutputStream(output)
          // Closing the encrypting stream flushes the final GCM segment and then closes
          // the framing, which writes the section terminator. The file itself stays open.
          BackupCrypto.openSectionEncryptingStream(framing, sectionKey, section.id).use { encrypted ->
            section.writeEntries(object : EntrySink {
              override fun add(
                header: BackupFormat.EntryHeader,
                writePayload: (OutputStream) -> Unit,
              ) {
                progress?.onItem(section.id, header.name, handled, totalItems)
                handled += 1
                BackupFormat.writeEntryHeader(encrypted, header)
                // The payload gets its own chunk framing so it is self-delimiting: the
                // header's size is advisory and a collector that miscounts cannot push the
                // reader out of step.
                val digest = MessageDigest.getInstance("SHA-256")
                var written = 0L
                var failure: Throwable? = null

                BackupFormat.ChunkedOutputStream(encrypted).use { framed ->
                  try {
                    writePayload(object : OutputStream() {
                      override fun write(b: Int) {
                        framed.write(b)
                        digest.update(b.toByte())
                        written++
                      }

                      override fun write(b: ByteArray, off: Int, len: Int) {
                        framed.write(b, off, len)
                        digest.update(b, off, len)
                        written += len
                      }

                      // The payload writer must not be able to end the entry early.
                      override fun close() = Unit
                    })
                  } catch (error: Throwable) {
                    // The item's list was a snapshot taken before writing began, so a file
                    // deleted in the meantime shows up here. One unreadable item must not
                    // destroy an otherwise good backup of everything else — but the entry
                    // header is already written, so the entry has to be closed rather than
                    // dropped. It is closed as incomplete.
                    failure = error
                  }
                }

                BackupFormat.writeEntryTrailer(
                  encrypted,
                  BackupFormat.EntryTrailer(
                    size = written,
                    sha256 = digest.digest().toHex(),
                    complete = failure == null,
                  ),
                )
                failure?.let {
                  failures.add(
                    ExportFailure(
                      sectionId = section.id,
                      name = header.name,
                      error = it.message ?: it::class.java.simpleName,
                    )
                  )
                }
              }
            })
            BackupFormat.writeSectionTerminator(encrypted)
          }
        } finally {
          BackupCrypto.wipe(sectionKey)
        }
      }
      output.flush()
      return failures
    } finally {
      BackupCrypto.wipe(*masterKeys.values.toTypedArray())
    }
  }

  // ------------------------------------------------------------------ reading

  /**
   * One item being restored. Valid only for the duration of the visit.
   *
   * The content hash is not known until the payload has streamed past, so duplicate
   * detection is two-stage: [header] carries an advisory size to filter on cheaply, and
   * [verifiedTrailer] gives the authoritative size and SHA-256 once [payload] is consumed.
   * A visitor that can already tell an item is unwanted simply never reads [payload].
   */
  interface RestoredEntry {
    val sectionId: String
    val header: BackupFormat.EntryHeader
    val payload: InputStream

    /**
     * Finish the entry and return its trailer, checking the recorded hash against what was
     * actually read. Drains any unread payload first, so it is safe to call at any point.
     *
     * @throws BackupFormatException if the content does not match its recorded hash.
     */
    fun verifiedTrailer(): BackupFormat.EntryTrailer
  }

  fun interface EntryVisitor {
    fun visit(entry: RestoredEntry)
  }

  /**
   * Read the plaintext header without any secret. This is what lets the import screen show
   * what a file contains, and which slots need which kind of secret, before asking for one.
   */
  fun peek(input: InputStream): BackupFormat.Header = BackupFormat.readHeader(input)

  /**
   * Restore from a stream already positioned after the header (i.e. straight after [peek]).
   *
   * [sectionsToRestore] limits what is decrypted; anything else is skipped over without a
   * key, so restoring only music never touches the vault's ciphertext.
   *
   * @throws BackupSecretException if a needed slot's secret is wrong. Checked against the
   * stored verifier before any payload is touched, so the user gets "wrong passphrase"
   * immediately rather than a decryption failure minutes in.
   */
  fun read(
    input: InputStream,
    header: BackupFormat.Header,
    secrets: List<SlotSecret>,
    sectionsToRestore: Set<String>,
    // Before `visitor` so that stays the last parameter: a callback in the final position
    // is what makes the trailing-lambda form read well at every call site.
    progress: ProgressListener? = null,
    visitor: EntryVisitor,
  ) {
    val totalItems = header.sections
      .filter { sectionsToRestore.contains(it.id) }
      .sumOf { it.itemCount }
    var handled = 0
    val neededSlots = header.sections
      .filter { sectionsToRestore.contains(it.id) }
      .map { it.keySlot }
      .toSet()

    val masterKeys = mutableMapOf<String, ByteArray>()
    try {
      neededSlots.forEach { slotId ->
        val slot = header.slot(slotId)
          ?: throw BackupFormatException("Backup is missing key slot '$slotId'")
        val secret = secrets.firstOrNull { it.slotId == slotId }
          ?: throw BackupSecretException("No secret was supplied for '$slotId'")
        val masterKey = BackupCrypto.deriveMasterKey(secret.secret, slot.salt, header.kdf)
        if (!BackupCrypto.verifierMatches(masterKey, slot.verifier)) {
          BackupCrypto.wipe(masterKey)
          throw BackupSecretException("That ${slot.secretKind} is not correct")
        }
        masterKeys[slotId] = masterKey
      }

      header.sections.forEach { section ->
        val framing = BackupFormat.ChunkedInputStream(input)
        if (!sectionsToRestore.contains(section.id)) {
          framing.skipSection()
          return@forEach
        }
        val sectionKey = BackupCrypto.sectionKey(masterKeys.getValue(section.keySlot), section.id)
        try {
          BackupCrypto.openSectionDecryptingStream(framing, sectionKey, section.id).use { decrypted ->
            while (true) {
              val entryHeader = BackupFormat.readEntryHeader(decrypted) ?: break
              progress?.onItem(section.id, entryHeader.name, handled, totalItems)
              handled += 1
              val entry = ReadEntry(section.id, entryHeader, decrypted)
              visitor.visit(entry)
              // Whether the payload was taken or skipped, the entry must be finished so the
              // next header starts where the reader expects it.
              entry.verifiedTrailer()
            }
          }
        } finally {
          BackupCrypto.wipe(sectionKey)
        }
        // A section the caller stopped reading early still has framing left over.
        framing.skipSection()
      }
    } finally {
      BackupCrypto.wipe(*masterKeys.values.toTypedArray())
    }
  }

  // ------------------------------------------------------------------ helpers

  /**
   * SHA-256 of a file's contents, used to spot duplicates on import by content rather than
   * by name. Costs one extra read of each file at export time, which is the price of being
   * able to skip a re-import without writing the payload first.
   */
  fun sha256(file: File): String = file.inputStream().use { sha256(it) }

  fun sha256(input: InputStream): String {
    val digest = MessageDigest.getInstance("SHA-256")
    DigestInputStream(input, digest).use { stream ->
      val buffer = ByteArray(COPY_BUFFER_BYTES)
      while (stream.read(buffer) >= 0) { /* digesting */ }
    }
    return digest.digest().joinToString("") { "%02x".format(it) }
  }

  internal fun copy(source: InputStream, sink: OutputStream): Long {
    val buffer = ByteArray(COPY_BUFFER_BYTES)
    var total = 0L
    while (true) {
      val read = source.read(buffer)
      if (read < 0) break
      sink.write(buffer, 0, read)
      total += read
    }
    return total
  }

  private fun ByteArray.toHex(): String = joinToString("") { "%02x".format(it) }

  /**
   * One entry as the reader sees it: a chunk-framed payload followed by a trailer.
   *
   * The payload is hashed while the visitor reads it so that [verifiedTrailer] can compare
   * against the recorded value. That catches damage the AEAD cannot: the tag proves the
   * ciphertext is what was written, whereas this proves the *plaintext* is what the
   * exporting device actually read off disk.
   */
  private class ReadEntry(
    override val sectionId: String,
    override val header: BackupFormat.EntryHeader,
    private val source: InputStream,
  ) : RestoredEntry {
    private val digest = MessageDigest.getInstance("SHA-256")
    private val framing = BackupFormat.ChunkedInputStream(source)
    private var readBytes = 0L
    private var trailer: BackupFormat.EntryTrailer? = null

    override val payload: InputStream = object : InputStream() {
      override fun read(): Int {
        val value = framing.read()
        if (value >= 0) {
          digest.update(value.toByte())
          readBytes++
        }
        return value
      }

      override fun read(b: ByteArray, off: Int, len: Int): Int {
        val read = framing.read(b, off, len)
        if (read > 0) {
          digest.update(b, off, read)
          readBytes += read
        }
        return read
      }

      // Closing one entry's payload must not end the section.
      override fun close() = Unit
    }

    override fun verifiedTrailer(): BackupFormat.EntryTrailer {
      trailer?.let { return it }

      // Anything the visitor left unread still has to be hashed, or the comparison below
      // would be against a partial digest.
      val buffer = ByteArray(COPY_BUFFER_BYTES)
      while (payload.read(buffer) >= 0) { /* draining */ }

      val read = BackupFormat.readEntryTrailer(source)
      if (read.size != readBytes) {
        throw BackupFormatException(
          "Backup entry '${header.name}' is ${readBytes} bytes but records ${read.size}"
        )
      }
      val actual = digest.digest().toHex()
      if (!read.sha256.equals(actual, ignoreCase = true)) {
        throw BackupFormatException("Backup entry '${header.name}' does not match its recorded hash")
      }
      trailer = read
      return read
    }
  }
}

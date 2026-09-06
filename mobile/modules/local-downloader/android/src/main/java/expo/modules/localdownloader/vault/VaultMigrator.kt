package expo.modules.localdownloader.vault

import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.BatteryManager
import android.os.StatFs
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.util.Log
import java.io.File
import java.io.OutputStream
import java.util.UUID
import java.util.concurrent.atomic.AtomicBoolean

/**
 * Walks v3 (and v2) vault entries and re-encrypts them in place to cipher v4.
 *
 * Per-entry pipeline:
 *   1. Stream-decrypt v3 plaintext into a v4 [openEncryptingStream] writer, output
 *      pointed at `<encFileName>.v4.tmp`. v3 HMAC tail is verified during decrypt.
 *   2. On clean decrypt: close the v4 stream (flushes the final GCM segment), then
 *      atomic-rename `.v4.tmp` to a fresh `enc/<uuid>.v4` filename. Delete the old
 *      v3 file. Update the index entry to v4.
 *   3. On any failure (HMAC mismatch, IO error, Keystore invalidation): delete the
 *      `.v4.tmp`, mark `migrationFailed=true` on the entry, leave the original v3
 *      file intact. Move on to the next entry.
 *
 * Resume semantics: a `migrationCursor` field on the vault index holds the id of the
 * last successfully-migrated entry. On restart, candidates are loaded fresh and the
 * cursor is used only to bias progress reporting — actual eligibility is "cipherVersion
 * != v4 and not marked migrationFailed". Mid-file resume is NOT supported; a partially
 * written `.v4.tmp` from a previous crash is cleaned at start.
 */
class VaultMigrator(private val host: Host) {

  interface Host {
    fun loadMigrationCandidates(): List<Candidate>
    fun loadMigrationCursor(): String?
    fun storeMigrationCursor(entryId: String?)
    fun decryptLegacyToStream(encryptedFile: File, sink: OutputStream, cipherVersion: String)
    fun openV4EncryptingStream(output: OutputStream, entryId: String): OutputStream
    fun commitMigratedEntry(entryId: String, newEncFileName: String, newCipherSize: Long)
    fun markEntryMigrationFailed(entryId: String, code: String, detail: String?)
    fun objectsDir(): File
  }

  data class Candidate(
    val id: String,
    val encFileName: String,
    val cipherVersion: String,
    val title: String,
    val sizeBytesEncrypted: Long,
  )

  data class Progress(
    val total: Int,
    val processed: Int,
    val succeeded: Int,
    val failed: Int,
    val skipped: Int,
    val currentEntryId: String?,
    val currentTitle: String?,
    val lastError: EntryError?,
  )

  data class EntryError(val entryId: String, val code: String, val detail: String?)

  enum class Outcome { COMPLETED, CANCELLED, BLOCKED_PREFLIGHT, BLOCKED_KEY_INVALIDATED }

  class CancelToken {
    private val cancelled = AtomicBoolean(false)
    fun cancel() { cancelled.set(true) }
    fun isCancelled(): Boolean = cancelled.get()
  }

  data class PreflightResult(
    val ok: Boolean,
    val freeBytes: Long,
    val requiredBytes: Long,
    val batteryLevel: Int,
    val isCharging: Boolean,
    val blockingCode: String?,
  )

  fun migrate(
    cancelToken: CancelToken,
    onProgress: (Progress) -> Unit,
  ): Outcome {
    val candidates = host.loadMigrationCandidates()
    if (candidates.isEmpty()) {
      onProgress(Progress(0, 0, 0, 0, 0, null, null, null))
      return Outcome.COMPLETED
    }

    pruneStaleTmpFiles(host.objectsDir())

    var processed = 0
    var succeeded = 0
    var failed = 0
    var skipped = 0
    var lastError: EntryError? = null

    for (candidate in candidates) {
      if (cancelToken.isCancelled()) {
        return Outcome.CANCELLED
      }

      onProgress(Progress(candidates.size, processed, succeeded, failed, skipped, candidate.id, candidate.title, lastError))

      val result = migrateEntry(candidate)
      processed += 1
      when (result) {
        is EntryOutcome.Success -> {
          succeeded += 1
          host.storeMigrationCursor(candidate.id)
        }
        is EntryOutcome.Failure -> {
          failed += 1
          lastError = EntryError(candidate.id, result.code, result.detail)
          host.markEntryMigrationFailed(candidate.id, result.code, result.detail)
          if (result.code == CODE_KEY_INVALIDATED) {
            onProgress(Progress(candidates.size, processed, succeeded, failed, skipped, candidate.id, candidate.title, lastError))
            return Outcome.BLOCKED_KEY_INVALIDATED
          }
        }
        EntryOutcome.SkippedAlreadyV4 -> {
          skipped += 1
        }
      }
    }

    onProgress(Progress(candidates.size, processed, succeeded, failed, skipped, null, null, lastError))
    return Outcome.COMPLETED
  }

  private sealed class EntryOutcome {
    object Success : EntryOutcome()
    object SkippedAlreadyV4 : EntryOutcome()
    data class Failure(val code: String, val detail: String?) : EntryOutcome()
  }

  private fun migrateEntry(candidate: Candidate): EntryOutcome {
    if (candidate.cipherVersion == VaultCipherV4.VERSION_TAG) {
      return EntryOutcome.SkippedAlreadyV4
    }
    val objectsDir = host.objectsDir()
    val sourceFile = File(objectsDir, candidate.encFileName)
    if (!sourceFile.exists()) {
      return EntryOutcome.Failure(CODE_SOURCE_MISSING, "v${candidate.cipherVersion} file not on disk: ${candidate.encFileName}")
    }

    val newEncFileName = "${UUID.randomUUID().toString().replace("-", "")}.v4"
    val tmpFile = File(objectsDir, "$newEncFileName.tmp")
    val finalFile = File(objectsDir, newEncFileName)

    return try {
      tmpFile.outputStream().use { fileOut ->
        host.openV4EncryptingStream(fileOut, candidate.id).use { encrypter ->
          host.decryptLegacyToStream(sourceFile, encrypter, candidate.cipherVersion)
        }
      }
      if (!tmpFile.renameTo(finalFile)) {
        tmpFile.delete()
        return EntryOutcome.Failure(CODE_RENAME_FAILED, "Could not rename ${tmpFile.name} -> ${finalFile.name}")
      }
      host.commitMigratedEntry(candidate.id, newEncFileName, finalFile.length())
      runCatching { sourceFile.delete() }
      EntryOutcome.Success
    } catch (kpe: KeyPermanentlyInvalidatedException) {
      runCatching { tmpFile.delete() }
      Log.e(TAG, "Migration ${candidate.id} failed: key permanently invalidated", kpe)
      EntryOutcome.Failure(CODE_KEY_INVALIDATED, kpe.message)
    } catch (t: Throwable) {
      runCatching { tmpFile.delete() }
      Log.e(TAG, "Migration ${candidate.id} failed: ${t.javaClass.name}: ${t.message}", t)
      EntryOutcome.Failure(CODE_ENTRY_FAILED, "${t.javaClass.simpleName}: ${t.message}")
    }
  }

  private fun pruneStaleTmpFiles(objectsDir: File) {
    val tmpFiles = objectsDir.listFiles { f -> f.name.endsWith(".v4.tmp") } ?: return
    for (file in tmpFiles) {
      runCatching { file.delete() }
    }
  }

  companion object {
    private const val TAG = "VaultMigrator"
    const val CODE_ENTRY_FAILED = "PRIVATE_MIGRATION_ENTRY_FAILED"
    const val CODE_SOURCE_MISSING = "PRIVATE_MIGRATION_SOURCE_MISSING"
    const val CODE_RENAME_FAILED = "PRIVATE_MIGRATION_RENAME_FAILED"
    const val CODE_KEY_INVALIDATED = "PRIVATE_MIGRATION_KEY_INVALIDATED"
    const val CODE_PREFLIGHT_DISK = "PRIVATE_MIGRATION_DISK_FULL"
    const val CODE_PREFLIGHT_BATTERY = "PRIVATE_MIGRATION_BATTERY_LOW"

    private const val DISK_MARGIN_MULTIPLIER = 1.5
    private const val MIN_BATTERY_PERCENT = 50

    /**
     * Check whether the device has enough disk headroom and battery to safely run a
     * full migration. The user can override the battery check by plugging in.
     *
     * @param vaultUsedBytes total size on disk of current v2/v3 items that will be
     *                       re-encrypted. Migration needs roughly 2× the largest
     *                       single item briefly, plus headroom for the full vault.
     */
    fun checkPreflight(context: Context, vaultUsedBytes: Long): PreflightResult {
      val objectsDir = context.filesDir
      val stat = StatFs(objectsDir.absolutePath)
      val free = stat.availableBytes
      val needed = (vaultUsedBytes * DISK_MARGIN_MULTIPLIER).toLong()
      val (level, charging) = readBatteryStatus(context)
      val diskBlocking = free < needed
      val batteryBlocking = !charging && level in 0 until MIN_BATTERY_PERCENT
      val blockingCode = when {
        diskBlocking -> CODE_PREFLIGHT_DISK
        batteryBlocking -> CODE_PREFLIGHT_BATTERY
        else -> null
      }
      return PreflightResult(
        ok = blockingCode == null,
        freeBytes = free,
        requiredBytes = needed,
        batteryLevel = level,
        isCharging = charging,
        blockingCode = blockingCode,
      )
    }

    private fun readBatteryStatus(context: Context): Pair<Int, Boolean> {
      val intent: Intent? = context.registerReceiver(null, IntentFilter(Intent.ACTION_BATTERY_CHANGED))
      val level = intent?.getIntExtra(BatteryManager.EXTRA_LEVEL, -1) ?: -1
      val scale = intent?.getIntExtra(BatteryManager.EXTRA_SCALE, -1) ?: -1
      val percent = if (level >= 0 && scale > 0) (level * 100) / scale else -1
      val status = intent?.getIntExtra(BatteryManager.EXTRA_STATUS, BatteryManager.BATTERY_STATUS_UNKNOWN)
        ?: BatteryManager.BATTERY_STATUS_UNKNOWN
      val charging = status == BatteryManager.BATTERY_STATUS_CHARGING ||
        status == BatteryManager.BATTERY_STATUS_FULL
      return percent to charging
    }
  }
}

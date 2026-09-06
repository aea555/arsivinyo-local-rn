package expo.modules.localdownloader

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

/**
 * Transparent activity that asks SAF either to create a new `.avsbck` file (export) or to
 * open an existing one (import), and hands the resulting content URI back to the caller.
 * Mirrors [SoundsImportActivity]'s singleton-callback pattern.
 *
 * One activity covers both directions because the only real difference is which
 * `ActivityResultContract` runs; a second activity would mean a second manifest entry and
 * another block in `app.plugin.js` for no benefit.
 *
 * SAF grants per-URI access to this process without any storage permission, which is what
 * lets a backup be written to the user's Downloads or Drive while the app keeps its
 * no-broad-storage posture.
 *
 * Note the deliberate absence of `android:noHistory` in the manifest entry: a noHistory
 * activity is finished the moment the full-screen picker covers it, which cancels the pick
 * before the user has chosen anything.
 */
class BackupDocumentActivity : ComponentActivity() {
  data class Result(
    val uri: String? = null,
    val code: String? = null,
    val message: String? = null,
  )

  private var pickerLaunched = false
  private var resultDelivered = false

  private val createLauncher = registerForActivityResult(
    ActivityResultContracts.CreateDocument(MIME_TYPE)
  ) { uri: Uri? ->
    deliverPicked(uri)
  }

  private val openLauncher = registerForActivityResult(
    ActivityResultContracts.OpenDocument()
  ) { uri: Uri? ->
    deliverPicked(uri)
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    overridePendingTransition(0, 0)
  }

  override fun onResume() {
    super.onResume()
    if (pickerLaunched) return
    pickerLaunched = true
    val mode = intent?.getStringExtra(EXTRA_MODE) ?: MODE_OPEN
    runCatching {
      if (mode == MODE_CREATE) {
        val suggested = intent?.getStringExtra(EXTRA_SUGGESTED_NAME) ?: "arsivinyo-backup.avsbck"
        createLauncher.launch(suggested)
      } else {
        // Most providers report .avsbck as an unknown type, so filtering by MIME would hide
        // the very file the user is looking for.
        openLauncher.launch(arrayOf("*/*"))
      }
    }.onFailure { error ->
      Log.e(TAG, "Failed to launch backup document picker (mode=$mode)", error)
      deliver(Result(code = CODE_FAILED, message = CODE_FAILED))
      finishQuietly()
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    // Only a genuine finish counts as a cancel. A transient destroy while the picker is in
    // front must not cancel — the result is re-delivered to the recreated instance, and the
    // module's latch timeout is the safety net if it never arrives.
    if (isFinishing && !isChangingConfigurations && !resultDelivered) {
      deliver(Result(code = CODE_CANCELLED, message = CODE_CANCELLED))
    }
  }

  private fun deliverPicked(uri: Uri?) {
    if (uri == null) {
      deliver(Result(code = CODE_CANCELLED, message = CODE_CANCELLED))
    } else {
      persistGrant(uri)
      deliver(Result(uri = uri.toString()))
    }
    finishQuietly()
  }

  /**
   * Convert the picker's transient URI grant into a persisted one.
   *
   * The grant SAF hands back is scoped to this activity and is released when it finishes,
   * which is immediately. That is fine for export, where the module writes the file inside
   * the same call, but restore is two-phase by nature: the header is read to describe the
   * file, the user then enters a passphrase, and only afterwards is the content read. By
   * that point the transient grant is gone and the read fails with a Permission Denial.
   *
   * `ACTION_OPEN_DOCUMENT` and `ACTION_CREATE_DOCUMENT` both hand back grants that are
   * eligible to be persisted; nothing else in the app persists URI permissions.
   */
  private fun persistGrant(uri: Uri) {
    val mode = intent?.getStringExtra(EXTRA_MODE) ?: MODE_OPEN
    val flags = if (mode == MODE_CREATE) {
      Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_WRITE_URI_PERMISSION
    } else {
      Intent.FLAG_GRANT_READ_URI_PERMISSION
    }

    // Drop any grant held from an earlier pick first. Only one backup document is ever in
    // play, and the per-app persisted-permission table is capped — leaking an entry on every
    // pick would eventually start losing the newest one.
    runCatching {
      contentResolver.persistedUriPermissions
        .filter { it.uri != uri }
        .forEach { held ->
          val heldFlags = (if (held.isReadPermission) Intent.FLAG_GRANT_READ_URI_PERMISSION else 0) or
            (if (held.isWritePermission) Intent.FLAG_GRANT_WRITE_URI_PERMISSION else 0)
          if (heldFlags != 0) {
            contentResolver.releasePersistableUriPermission(held.uri, heldFlags)
          }
        }
    }.onFailure { Log.w(TAG, "Could not release a stale document grant", it) }

    runCatching {
      contentResolver.takePersistableUriPermission(uri, flags)
    }.onFailure {
      // Not fatal on its own: an export still succeeds on the transient grant. A restore
      // would fail later, which is why this is logged rather than swallowed.
      Log.w(TAG, "Could not persist the document grant for $uri", it)
    }
  }

  private fun finishQuietly() {
    finish()
    overridePendingTransition(0, 0)
  }

  private fun deliver(result: Result) {
    if (resultDelivered) return
    resultDelivered = true
    dispatchResult(result)
  }

  companion object {
    private const val TAG = "BackupDocument"

    const val MODE_CREATE = "create"
    const val MODE_OPEN = "open"
    const val EXTRA_MODE = "mode"
    const val EXTRA_SUGGESTED_NAME = "suggestedName"

    const val CODE_CANCELLED = "BACKUP_PICK_CANCELLED"
    const val CODE_FAILED = "BACKUP_PICK_FAILED"

    /**
     * Deliberately generic. A specific type would make providers hide the file, and Android
     * has no registered type for `.avsbck`.
     */
    private const val MIME_TYPE = "application/octet-stream"

    private val launchLock = Any()
    private var pendingCallback: ((Result) -> Unit)? = null

    fun launch(
      context: Context,
      mode: String,
      suggestedName: String? = null,
      callback: (Result) -> Unit,
    ): Boolean {
      synchronized(launchLock) {
        if (pendingCallback != null) {
          return false
        }
        pendingCallback = callback
      }
      return runCatching {
        val intent = Intent(context, BackupDocumentActivity::class.java).apply {
          addFlags(
            Intent.FLAG_ACTIVITY_NEW_TASK or
              Intent.FLAG_ACTIVITY_SINGLE_TOP or
              Intent.FLAG_ACTIVITY_CLEAR_TOP
          )
          putExtra(EXTRA_MODE, mode)
          suggestedName?.let { putExtra(EXTRA_SUGGESTED_NAME, it) }
        }
        context.startActivity(intent)
      }.onFailure {
        clearPending()
      }.isSuccess
    }

    fun cancelPendingWith(code: String, message: String? = code) {
      dispatchResult(Result(code = code, message = message))
    }

    private fun clearPending() {
      synchronized(launchLock) {
        pendingCallback = null
      }
    }

    private fun dispatchResult(result: Result) {
      val callback = synchronized(launchLock) {
        val current = pendingCallback
        pendingCallback = null
        current
      }
      callback?.invoke(result)
    }
  }
}

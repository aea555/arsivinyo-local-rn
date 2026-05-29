package expo.modules.localdownloader

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts

/**
 * Transparent activity that opens a multi-select SAF document picker filtered to
 * audio files, and hands the chosen content URIs back to the caller. Mirrors
 * [PrivateVaultImportActivity]'s singleton-callback pattern.
 *
 * SAF grants per-URI read access for this process without any READ_MEDIA_AUDIO
 * permission, so bulk-importing existing music keeps the app's no-broad-storage
 * posture intact.
 */
class SoundsImportActivity : ComponentActivity() {
  data class Result(
    val uris: List<String> = emptyList(),
    val code: String? = null,
    val message: String? = null,
  )

  private var pickerLaunched = false
  private var resultDelivered = false

  private val pickerLauncher = registerForActivityResult(
    ActivityResultContracts.OpenMultipleDocuments()
  ) { uris: List<Uri> ->
    if (uris.isEmpty()) {
      deliver(Result(code = CODE_PICK_CANCELLED, message = CODE_PICK_CANCELLED))
    } else {
      deliver(Result(uris = uris.map { it.toString() }))
    }
    finishQuietly()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    overridePendingTransition(0, 0)
  }

  override fun onResume() {
    super.onResume()
    if (pickerLaunched) return
    pickerLaunched = true
    runCatching {
      pickerLauncher.launch(arrayOf("audio/*"))
    }.onFailure { error ->
      Log.e(TAG, "Failed to launch audio document picker", error)
      deliver(Result(code = CODE_IMPORT_FAILED, message = CODE_IMPORT_FAILED))
      finishQuietly()
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    // Only treat this as a cancel when the activity is genuinely finishing (e.g. the
    // user backed out). A transient destroy while the picker is in front must NOT
    // cancel — the result is re-delivered to the recreated instance; the module's
    // latch timeout is the safety net if it never arrives.
    if (isFinishing && !isChangingConfigurations && !resultDelivered) {
      deliver(Result(code = CODE_PICK_CANCELLED, message = CODE_PICK_CANCELLED))
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
    private const val TAG = "SoundsImport"
    const val CODE_PICK_CANCELLED = "SOUNDS_IMPORT_PICK_CANCELLED"
    const val CODE_IMPORT_FAILED = "SOUNDS_IMPORT_FAILED"
    private val launchLock = Any()
    private var pendingCallback: ((Result) -> Unit)? = null

    fun launch(context: Context, callback: (Result) -> Unit): Boolean {
      synchronized(launchLock) {
        if (pendingCallback != null) {
          return false
        }
        pendingCallback = callback
      }
      return runCatching {
        val intent = Intent(context, SoundsImportActivity::class.java).apply {
          addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_CLEAR_TOP)
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

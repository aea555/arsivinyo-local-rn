package expo.modules.localdownloader

import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.ComponentActivity
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts

class PrivateVaultImportActivity : ComponentActivity() {
  data class Result(
    val uri: String? = null,
    val code: String? = null,
    val message: String? = null
  )

  private var pickerLaunched = false
  private var resultDelivered = false

  private val pickerLauncher = registerForActivityResult(
    ActivityResultContracts.PickVisualMedia()
  ) { uri: Uri? ->
    if (uri == null) {
      deliver(Result(code = CODE_PICK_CANCELLED, message = CODE_PICK_CANCELLED))
    } else {
      deliver(Result(uri = uri.toString()))
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
      pickerLauncher.launch(
        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.VideoOnly)
      )
    }.onFailure { error ->
      Log.e(TAG, "Failed to launch photo picker", error)
      deliver(Result(code = CODE_IMPORT_FAILED, message = CODE_IMPORT_FAILED))
      finishQuietly()
    }
  }

  override fun onDestroy() {
    super.onDestroy()
    // Only cancel on a genuine finish (e.g. user backed out); a transient destroy
    // while the picker is in front must not cancel — the result is re-delivered to
    // the recreated instance, and the module's latch timeout is the safety net.
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
    private const val TAG = "PrivateVaultImport"
    const val CODE_PICK_CANCELLED = "PRIVATE_IMPORT_PICK_CANCELLED"
    const val CODE_IMPORT_FAILED = "PRIVATE_IMPORT_FAILED"
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
        val intent = Intent(context, PrivateVaultImportActivity::class.java).apply {
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

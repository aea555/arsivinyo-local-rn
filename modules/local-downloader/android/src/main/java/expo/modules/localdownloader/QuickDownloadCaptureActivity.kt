package expo.modules.localdownloader

import android.app.Activity
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.widget.Button
import android.widget.EditText
import android.widget.TextView
import android.widget.Toast

class QuickDownloadCaptureActivity : Activity() {
  private val handler = Handler(Looper.getMainLooper())
  private var autoStartEnabled: Boolean = true
  private var autoAttemptScheduled: Boolean = false
  private var autoAttemptCount: Int = 0
  private lateinit var statusView: TextView
  private lateinit var inputView: EditText

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setContentView(R.layout.local_downloader_quick_capture)
    setFinishOnTouchOutside(false)

    statusView = findViewById(R.id.quick_capture_status)
    inputView = findViewById(R.id.quick_capture_input)
    val cancelButton = findViewById<Button>(R.id.quick_capture_cancel)
    val downloadButton = findViewById<Button>(R.id.quick_capture_download)

    val clipboardUrl = LocalDownloaderModule.peekClipboardUrl(this)
    if (!clipboardUrl.isNullOrBlank()) {
      inputView.setText(clipboardUrl)
    }

    cancelButton.setOnClickListener {
      LocalDownloaderModule.reportQuickActionReason("QUICK_CAPTURE_CANCELLED")
      finish()
    }

    downloadButton.setOnClickListener {
      val url = inputView.text?.toString()?.trim().orEmpty()
      val result = LocalDownloaderModule.onQuickUrlCaptured(this, url, "manual")
      if (result["accepted"] == true) {
        showResultToast(result)
        finish()
      } else {
        statusView.text = LocalDownloaderModule.quickReasonToMessage(result["reason"]?.toString())
      }
    }

    autoStartEnabled = intent?.getBooleanExtra(EXTRA_AUTOSTART, true) ?: true
    if (!autoStartEnabled) {
      statusView.text = "Paste a URL and tap Download."
      return
    }

    statusView.text = "Trying clipboard URL..."
  }

  override fun onResume() {
    super.onResume()
    scheduleClipboardAutoAttempt()
  }

  override fun onNewIntent(intent: android.content.Intent?) {
    super.onNewIntent(intent)
    setIntent(intent)
    autoStartEnabled = intent?.getBooleanExtra(EXTRA_AUTOSTART, true) ?: true
    autoAttemptCount = 0
    autoAttemptScheduled = false
    if (!autoStartEnabled) {
      statusView.text = "Paste a URL and tap Download."
      return
    }
    statusView.text = "Trying clipboard URL..."
    scheduleClipboardAutoAttempt()
  }

  override fun onDestroy() {
    handler.removeCallbacksAndMessages(null)
    super.onDestroy()
  }

  private fun scheduleClipboardAutoAttempt() {
    if (!autoStartEnabled || autoAttemptScheduled || isFinishing || isDestroyed) {
      return
    }
    autoAttemptScheduled = true
    handler.postDelayed({ attemptClipboardAutoStart() }, if (autoAttemptCount == 0) FIRST_ATTEMPT_DELAY_MS else RETRY_DELAY_MS)
  }

  private fun attemptClipboardAutoStart() {
    autoAttemptScheduled = false
    if (!autoStartEnabled || isFinishing || isDestroyed) {
      return
    }

    val clipboardUrl = LocalDownloaderModule.peekClipboardUrl(this)
    if (clipboardUrl.isNullOrBlank()) {
      autoAttemptCount += 1
      Log.d(TAG, "Clipboard quick attempt failed (empty), try=$autoAttemptCount/$MAX_CLIPBOARD_ATTEMPTS")
      if (autoAttemptCount < MAX_CLIPBOARD_ATTEMPTS) {
        scheduleClipboardAutoAttempt()
      } else {
        statusView.text = LocalDownloaderModule.quickReasonToMessage("NO_CLIPBOARD_URL")
      }
      return
    }

    val result = LocalDownloaderModule.onQuickUrlCaptured(this, clipboardUrl, "clipboard")
    if (result["accepted"] == true) {
      showResultToast(result)
      finish()
      return
    }

    val reason = result["reason"]?.toString()
    Log.d(TAG, "Clipboard quick attempt rejected reason=$reason")
    if (reason == "NO_CLIPBOARD_URL" && autoAttemptCount < MAX_CLIPBOARD_ATTEMPTS - 1) {
      autoAttemptCount += 1
      scheduleClipboardAutoAttempt()
      return
    }

    statusView.text = LocalDownloaderModule.quickReasonToMessage(reason)
  }

  private fun showResultToast(result: Map<String, Any?>) {
    val queueSize = (result["queueSize"] as? Number)?.toInt()
    val queueMax = (result["queueMax"] as? Number)?.toInt()
    val message = if (queueSize != null && queueSize > 0 && queueMax != null) {
      "Queued ($queueSize/$queueMax)"
    } else {
      "Download started"
    }
    Toast.makeText(this, message, Toast.LENGTH_SHORT).show()
  }

  companion object {
    const val EXTRA_AUTOSTART = "extra_autostart"
    private const val TAG = "QuickCapture"
    private const val MAX_CLIPBOARD_ATTEMPTS = 8
    private const val FIRST_ATTEMPT_DELAY_MS = 180L
    private const val RETRY_DELAY_MS = 160L
  }
}

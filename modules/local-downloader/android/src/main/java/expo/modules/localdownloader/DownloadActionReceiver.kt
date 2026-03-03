package expo.modules.localdownloader

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import androidx.core.app.RemoteInput

class DownloadActionReceiver : BroadcastReceiver() {
  override fun onReceive(context: Context, intent: Intent?) {
    when (intent?.action) {
      ACTION_CANCEL_ACTIVE -> LocalDownloaderModule.onNotificationCancelAction(context)
      ACTION_QUICK_FROM_CLIPBOARD -> LocalDownloaderModule.launchQuickCaptureActivity(context)
      ACTION_TOGGLE_PRIVATE_MODE -> LocalDownloaderModule.onNotificationTogglePrivateMode(context)
      ACTION_ADD_URL_REMOTE_INPUT -> {
        val url = RemoteInput.getResultsFromIntent(intent)
          ?.getCharSequence(DownloadNotificationController.REMOTE_INPUT_URL_KEY)
          ?.toString()
        if (url.isNullOrBlank()) {
          LocalDownloaderModule.reportQuickActionReason("INVALID_QUICK_URL")
        } else {
          LocalDownloaderModule.onQuickUrlCaptured(context, url, "manual")
        }
      }
    }
  }

  companion object {
    const val ACTION_CANCEL_ACTIVE = "expo.modules.localdownloader.action.CANCEL_ACTIVE"
    const val ACTION_QUICK_FROM_CLIPBOARD = "expo.modules.localdownloader.action.QUICK_FROM_CLIPBOARD"
    const val ACTION_TOGGLE_PRIVATE_MODE = "expo.modules.localdownloader.action.TOGGLE_PRIVATE_MODE"
    const val ACTION_ADD_URL_REMOTE_INPUT = "expo.modules.localdownloader.action.ADD_URL_REMOTE_INPUT"
  }
}

package expo.modules.localdownloader

import android.app.Service
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.util.Log
import androidx.core.app.NotificationManagerCompat
import androidx.core.app.ServiceCompat

class DownloadForegroundService : Service() {
  private var inForeground = false

  override fun onCreate() {
    super.onCreate()
    isRunning = true
  }

  override fun onBind(intent: Intent?): IBinder? = null

  override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
    return try {
      when (intent?.action) {
        DownloadNotificationController.ACTION_STOP -> {
          stopInternal()
          START_NOT_STICKY
        }

        else -> {
          val state = DownloadNotificationController.parseState(intent)
          if (!state.shouldRunForeground) {
            stopInternal()
            START_NOT_STICKY
          } else {
            val notification = DownloadNotificationController.buildNotification(this, state)
            if (!inForeground) {
              val serviceType = if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC
              } else {
                0
              }
              ServiceCompat.startForeground(this, DownloadNotificationController.NOTIFICATION_ID, notification, serviceType)
              inForeground = true
            } else {
              NotificationManagerCompat.from(this).notify(DownloadNotificationController.NOTIFICATION_ID, notification)
            }
            START_STICKY
          }
        }
      }
    } catch (error: Throwable) {
      Log.e(TAG, "Foreground notification update failed", error)
      LocalDownloaderModule.reportBackgroundServiceStartFailure(error.message ?: "unknown")
      stopInternal()
      START_NOT_STICKY
    }
  }

  override fun onDestroy() {
    isRunning = false
    super.onDestroy()
  }

  private fun stopInternal() {
    if (inForeground) {
      stopForeground(STOP_FOREGROUND_REMOVE)
      inForeground = false
    }
    NotificationManagerCompat.from(this).cancel(DownloadNotificationController.NOTIFICATION_ID)
    stopSelf()
    isRunning = false
  }

  companion object {
    private const val TAG = "DownloadFgService"

    @Volatile
    var isRunning: Boolean = false
      private set
  }
}

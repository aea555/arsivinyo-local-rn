package expo.modules.localdownloader

import android.app.Activity
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import android.view.View
import android.widget.ImageButton
import android.widget.MediaController
import android.widget.ProgressBar
import android.widget.TextView
import android.widget.VideoView

class PrivateVideoPlayerActivity : Activity() {
  private val handler = Handler(Looper.getMainLooper())
  private var settled = false
  private var traceId = "n/a"
  private val loadingWatchdog = object : Runnable {
    override fun run() {
      if (settled) return
      val videoView = findViewById<VideoView>(R.id.ld_private_player_video)
      devLog(
        "watchdog loading trace=$traceId currentMs=${videoView.currentPosition} " +
          "durationMs=${videoView.duration} isPlaying=${videoView.isPlaying}"
      )
      handler.postDelayed(this, WATCHDOG_INTERVAL_MS)
    }
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    traceId = intent.getStringExtra(EXTRA_TRACE_ID).orEmpty().ifBlank { "n/a" }
    devLog("onCreate trace=$traceId")
    window.setFlags(
      android.view.WindowManager.LayoutParams.FLAG_SECURE,
      android.view.WindowManager.LayoutParams.FLAG_SECURE
    )
    setContentView(R.layout.local_downloader_private_player)

    val titleView = findViewById<TextView>(R.id.ld_private_player_title)
    val closeButton = findViewById<ImageButton>(R.id.ld_private_player_close)
    val videoView = findViewById<VideoView>(R.id.ld_private_player_video)
    val loadingView = findViewById<ProgressBar>(R.id.ld_private_player_loading)

    val title = intent.getStringExtra(EXTRA_TITLE).orEmpty().ifBlank { "Private video" }
    titleView.text = title
    closeButton.setOnClickListener {
      devLog("close pressed trace=$traceId")
      finish()
    }

    val uriString = intent.getStringExtra(EXTRA_URI).orEmpty()
    devLog("intent extras trace=$traceId uri=$uriString title=$title")
    if (uriString.isBlank()) {
      devLog("blank uri trace=$traceId -> finish")
      finish()
      return
    }

    val mediaController = MediaController(this).apply {
      setAnchorView(videoView)
    }
    videoView.setMediaController(mediaController)
    videoView.setVideoURI(Uri.parse(uriString))
    loadingView.visibility = View.VISIBLE
    devLog("setVideoURI trace=$traceId")
    handler.postDelayed(loadingWatchdog, WATCHDOG_INTERVAL_MS)

    videoView.setOnPreparedListener {
      settled = true
      handler.removeCallbacks(loadingWatchdog)
      devLog("onPrepared trace=$traceId durationMs=${it.duration}")
      loadingView.visibility = View.GONE
      videoView.start()
    }
    videoView.setOnErrorListener { _, what, extra ->
      settled = true
      handler.removeCallbacks(loadingWatchdog)
      devLog("onError trace=$traceId what=$what extra=$extra")
      loadingView.visibility = View.GONE
      finish()
      true
    }
    videoView.setOnCompletionListener {
      devLog("onCompletion trace=$traceId")
    }
    videoView.setOnInfoListener { _, what, extra ->
      devLog("onInfo trace=$traceId what=$what extra=$extra")
      false
    }
    videoView.requestFocus()
    devLog("requestFocus trace=$traceId")
  }

  override fun onPause() {
    super.onPause()
    devLog("onPause trace=$traceId")
    findViewById<VideoView>(R.id.ld_private_player_video)?.pause()
  }

  override fun onDestroy() {
    devLog("onDestroy trace=$traceId")
    settled = true
    handler.removeCallbacks(loadingWatchdog)
    findViewById<VideoView>(R.id.ld_private_player_video)?.stopPlayback()
    super.onDestroy()
  }

  private fun devLog(message: String) {
    if (BuildConfig.DEBUG) {
      Log.d(TAG, "[PRIVATE_PLAYER] $message")
    }
  }

  companion object {
    private const val TAG = "LocalDownloader"
    private const val WATCHDOG_INTERVAL_MS = 5000L
    const val EXTRA_URI = "extra_uri"
    const val EXTRA_TITLE = "extra_title"
    const val EXTRA_TRACE_ID = "extra_trace_id"
  }
}

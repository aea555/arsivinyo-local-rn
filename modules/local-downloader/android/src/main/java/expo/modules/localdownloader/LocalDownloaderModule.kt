package expo.modules.localdownloader

import android.net.Uri
import android.os.StatFs
import android.util.Log
import com.chaquo.python.Python
import com.chaquo.python.android.AndroidPlatform
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.launch
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.time.Instant
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap

data class TaskState(
  var taskId: String,
  var status: String,
  var filename: String? = null,
  var filePath: String? = null,
  var sizeMb: Double? = null,
  var errorCode: String? = null,
  var errorMessage: String? = null,
  var estimatedSizeMb: Double? = null
)

class LocalDownloaderModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val tasks = ConcurrentHashMap<String, TaskState>()
  private var activeTaskId: String? = null
  private var activeJob: Job? = null
  private val lastErrors = ArrayDeque<String>()
  private val tag = "LocalDownloader"

  override fun definition() = ModuleDefinition {
    Name("LocalDownloader")
    Events("downloadProgress")

    OnCreate {
      loadTaskSnapshot()
    }

    AsyncFunction("startDownload") { input: Map<String, Any?> ->
      val url = (input["url"] as? String)?.trim().orEmpty()
      val cookieProfile = (input["cookieProfile"] as? String)?.trim().orEmpty().ifEmpty { null }

      if (url.isBlank()) {
        throw IllegalArgumentException("INVALID_URL")
      }

      if (activeJob?.isActive == true) {
        throw IllegalStateException("DOWNLOAD_ALREADY_IN_PROGRESS")
      }

      val taskId = UUID.randomUUID().toString()
      val task = TaskState(taskId = taskId, status = "PENDING")
      tasks[taskId] = task
      persistTaskSnapshot()
      emitProgress(taskId, "PENDING", "starting", "Task created")

      val outputDir = File(requireNotNull(appContext.reactContext).cacheDir, "local_downloads").apply { mkdirs() }
      val cookiesDir = File(requireNotNull(appContext.reactContext).filesDir, "cookies").apply { mkdirs() }

      activeTaskId = taskId
      activeJob = scope.launch {
        runCatching {
          updateStatus(taskId, "STARTED", null, null, null, null, null)
          emitProgress(taskId, "STARTED", "starting", "Preflight")

          val freeMb = getFreeSpaceMb(outputDir)
          if (freeMb < 1024.0) {
            updateStatus(taskId, "FAILURE", null, null, null, "SERVER_BUSY", "Not enough free storage available")
            emitProgress(taskId, "FAILURE", "error", "Not enough free storage")
            return@launch
          }

          val preflightResult = callPython(
            "preflight",
            url,
            cookiesDir.absolutePath,
            cookieProfile,
            2048,
            null,
            null
          )

          val estimated = preflightResult.optDouble("estimated_size_mb", Double.NaN).takeIf { !it.isNaN() }
          if (estimated != null) {
            tasks[taskId]?.estimatedSizeMb = estimated
            persistTaskSnapshot()
          }

          if (!preflightResult.optBoolean("success", false)) {
            val code = preflightResult.optString("code", "INTERNAL_ERROR")
            val msg = preflightResult.optString("message", "Preflight failed")
            updateStatus(taskId, "FAILURE", null, null, null, code, msg)
            emitProgress(taskId, "FAILURE", "error", msg)
            return@launch
          }

          emitProgress(taskId, "PROGRESS", "downloading", "Downloading media")
          updateStatus(taskId, "PROGRESS", null, null, null, null, null)

          val result = callPython(
            "run_download",
            url,
            outputDir.absolutePath,
            cookiesDir.absolutePath,
            cookieProfile,
            2048,
            null
          )

          if (result.optBoolean("success", false)) {
            val filename = result.optString("filename").ifBlank { null }
            val filePath = result.optString("file_path").ifBlank { null }
            val sizeMb = result.optDouble("size_mb", Double.NaN).takeIf { !it.isNaN() }

            updateStatus(taskId, "SUCCESS", filename, filePath, sizeMb, null, null)
            emitProgress(taskId, "SUCCESS", "completed", filename ?: "Download completed")
          } else {
            val code = result.optString("code", "INTERNAL_ERROR")
            val message = result.optString("message", "Download failed")
            updateStatus(taskId, "FAILURE", null, null, null, code, message)
            emitProgress(taskId, "FAILURE", "error", message)
            addError("$code: $message")
          }
        }.onFailure {
          Log.e(tag, "Task failed", it)
          updateStatus(taskId, "FAILURE", null, null, null, "INTERNAL_ERROR", it.message ?: "Unexpected error")
          emitProgress(taskId, "FAILURE", "error", it.message ?: "Unexpected error")
          addError("INTERNAL_ERROR: ${it.message}")
        }

        if (activeTaskId == taskId) {
          activeTaskId = null
        }
      }

      mapOf(
        "taskId" to taskId,
        "estimatedSizeMb" to task.estimatedSizeMb
      )
    }

    AsyncFunction("getTaskStatus") { taskId: String ->
      val task = tasks[taskId]
      if (task == null) {
        mapOf(
          "taskId" to taskId,
          "status" to "PENDING"
        )
      } else {
        task.toMap()
      }
    }

    AsyncFunction("cancelTask") { taskId: String ->
      if (activeTaskId == taskId && activeJob?.isActive == true) {
        activeJob?.cancel()
        updateStatus(taskId, "CANCELLED", null, null, null, "TASK_CANCELLED", "Task cancelled")
        emitProgress(taskId, "CANCELLED", "error", "Task cancelled")
        activeTaskId = null
        mapOf("success" to true)
      } else {
        mapOf("success" to false)
      }
    }

    AsyncFunction("importCookie") { input: Map<String, String> ->
      val platform = input["platform"]?.trim().orEmpty().lowercase()
      val uri = input["uri"] ?: throw IllegalArgumentException("Missing uri")
      val profileNameRaw = input["profileName"] ?: throw IllegalArgumentException("Missing profileName")

      if (!SUPPORTED_PLATFORMS.contains(platform)) {
        throw IllegalArgumentException("Unsupported platform")
      }

      val profileName = sanitizeProfileName(profileNameRaw)
      val cookiesRoot = File(requireNotNull(appContext.reactContext).filesDir, "cookies")
      val platformDir = File(cookiesRoot, platform).apply { mkdirs() }
      val dest = File(platformDir, "$profileName.txt")

      val sourceUri = Uri.parse(uri)
      val resolver = requireNotNull(appContext.reactContext).contentResolver
      resolver.openInputStream(sourceUri).use { inputStream ->
        requireNotNull(inputStream) { "Could not open cookie file" }
        FileOutputStream(dest).use { output ->
          inputStream.copyTo(output)
        }
      }

      mapOf(
        "profileName" to profileName,
        "path" to dest.absolutePath
      )
    }

    AsyncFunction("listCookieProfiles") { platform: String ->
      val normalized = platform.lowercase()
      if (!SUPPORTED_PLATFORMS.contains(normalized)) {
        return@AsyncFunction emptyList<Map<String, Any>>()
      }

      val platformDir = File(requireNotNull(appContext.reactContext).filesDir, "cookies/$normalized")
      if (!platformDir.exists()) {
        return@AsyncFunction emptyList<Map<String, Any>>()
      }

      platformDir.listFiles()
        ?.filter { it.isFile && (it.extension == "txt" || it.extension == "json") }
        ?.sortedByDescending { it.lastModified() }
        ?.map {
          mapOf(
            "profileName" to it.nameWithoutExtension,
            "path" to it.absolutePath,
            "lastModified" to it.lastModified()
          )
        } ?: emptyList()
    }

    AsyncFunction("getDiagnostics") {
      val ffmpegPath = resolveBundledFfmpegPath()
      val ytDlpVersion = runCatching {
        ensurePythonReady()
        val py = Python.getInstance()
        py.getModule("yt_dlp.version").get("__version__").toString()
      }.getOrElse { "unknown" }

      mapOf(
        "ytDlpVersion" to ytDlpVersion,
        "ffmpegPath" to ffmpegPath,
        "ffmpegExists" to (ffmpegPath?.let { File(it).exists() } ?: false),
        "activeTaskId" to activeTaskId,
        "lastErrors" to lastErrors.toList()
      )
    }
  }

  private fun emitProgress(taskId: String, status: String, state: String, message: String?) {
    sendEvent(
      "downloadProgress",
      mapOf(
        "taskId" to taskId,
        "status" to status,
        "state" to state,
        "message" to message
      )
    )
  }

  private fun updateStatus(
    taskId: String,
    status: String,
    filename: String?,
    filePath: String?,
    sizeMb: Double?,
    errorCode: String?,
    errorMessage: String?
  ) {
    val task = tasks[taskId] ?: TaskState(taskId, status)
    task.status = status
    if (filename != null) task.filename = filename
    if (filePath != null) task.filePath = filePath
    if (sizeMb != null) task.sizeMb = sizeMb
    task.errorCode = errorCode
    task.errorMessage = errorMessage
    tasks[taskId] = task
    persistTaskSnapshot()
  }

  private fun callPython(
    function: String,
    url: String,
    outputOrCookies: String,
    maybeCookiesOrProfile: String?,
    maybeProfileOrLimit: Any?,
    maybeLimitOrFfmpeg: Any?,
    maybeFfmpeg: String?
  ): JSONObject {
    ensurePythonReady()
    val py = Python.getInstance()
    val module = py.getModule("local_downloader")

    val result = when (function) {
      "preflight" -> {
        val cookieProfile = maybeCookiesOrProfile
        val maxFileSizeMb = (maybeProfileOrLimit as? Int) ?: 2048
        val ffmpegPath = maybeLimitOrFfmpeg as? String
        module.callAttr("preflight", url, outputOrCookies, cookieProfile, maxFileSizeMb, ffmpegPath)
      }
      "run_download" -> {
        val cookiesDir = maybeCookiesOrProfile ?: ""
        val cookieProfile = maybeProfileOrLimit as? String
        val maxFileSizeMb = (maybeLimitOrFfmpeg as? Int) ?: 2048
        module.callAttr("run_download", url, outputOrCookies, cookiesDir, cookieProfile, maxFileSizeMb, maybeFfmpeg)
      }
      else -> throw IllegalArgumentException("Unsupported python function")
    }

    return JSONObject(result.toString())
  }

  private fun ensurePythonReady() {
    val context = requireNotNull(appContext.reactContext).applicationContext
    if (!Python.isStarted()) {
      Python.start(AndroidPlatform(context))
    }
  }

  private fun getFreeSpaceMb(directory: File): Double {
    val stat = StatFs(directory.absolutePath)
    val freeBytes = stat.availableBytes
    return freeBytes.toDouble() / (1024.0 * 1024.0)
  }

  private fun sanitizeProfileName(value: String): String {
    return value
      .trim()
      .lowercase()
      .replace(Regex("[^a-z0-9._-]"), "_")
      .removeSuffix(".txt")
      .ifBlank { "default" }
  }

  private fun resolveBundledFfmpegPath(): String? {
    return null
  }

  private fun addError(message: String) {
    val timestamped = "${Instant.now()}: $message"
    lastErrors.addFirst(timestamped)
    while (lastErrors.size > 20) {
      lastErrors.removeLast()
    }
  }

  private fun persistTaskSnapshot() {
    runCatching {
      val context = requireNotNull(appContext.reactContext)
      val file = File(context.filesDir, "local_downloader_tasks.json")
      val array = JSONArray()
      tasks.values.forEach { task ->
        array.put(JSONObject(task.toMap()))
      }
      file.writeText(array.toString())
    }.onFailure {
      Log.w(tag, "Failed to persist task snapshot", it)
    }
  }

  private fun loadTaskSnapshot() {
    runCatching {
      val context = requireNotNull(appContext.reactContext)
      val file = File(context.filesDir, "local_downloader_tasks.json")
      if (!file.exists()) return

      val array = JSONArray(file.readText())
      for (i in 0 until array.length()) {
        val obj = array.getJSONObject(i)
        val taskId = obj.optString("taskId")
        if (taskId.isBlank()) continue

        tasks[taskId] = TaskState(
          taskId = taskId,
          status = obj.optString("status", "PENDING"),
          filename = obj.optString("filename").ifBlank { null },
          filePath = obj.optString("filePath").ifBlank { null },
          sizeMb = obj.optDouble("sizeMb", Double.NaN).takeIf { !it.isNaN() },
          errorCode = obj.optString("errorCode").ifBlank { null },
          errorMessage = obj.optString("errorMessage").ifBlank { null },
          estimatedSizeMb = obj.optDouble("estimatedSizeMb", Double.NaN).takeIf { !it.isNaN() }
        )
      }
    }.onFailure {
      Log.w(tag, "Failed to load task snapshot", it)
    }
  }

  private fun TaskState.toMap(): Map<String, Any?> {
    return mapOf(
      "taskId" to taskId,
      "status" to status,
      "filename" to filename,
      "filePath" to filePath,
      "sizeMb" to sizeMb,
      "errorCode" to errorCode,
      "errorMessage" to errorMessage,
      "estimatedSizeMb" to estimatedSizeMb
    )
  }

  companion object {
    private val SUPPORTED_PLATFORMS = setOf("youtube", "instagram", "facebook", "twitter", "reddit")
  }
}

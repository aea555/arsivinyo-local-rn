package expo.modules.localdownloader

import android.net.Uri
import android.os.Build
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
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.withTimeoutOrNull
import org.json.JSONArray
import org.json.JSONObject
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.security.MessageDigest
import java.time.Instant
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import kotlin.math.max

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

data class FfmpegInfo(
  val path: String? = null,
  val abi: String? = null,
  val exists: Boolean = false,
  val executable: Boolean = false,
  val version: String? = null
)

data class PreflightPythonInput(
  val url: String,
  val cookiesDir: String,
  val cookieProfile: String?,
  val maxFileSizeMb: Int,
  val ffmpegPath: String?
)

data class DownloadPythonInput(
  val url: String,
  val outputDir: String,
  val cookiesDir: String,
  val cookieProfile: String?,
  val maxFileSizeMb: Int,
  val cancelFlagPath: String?,
  val ffmpegPath: String?
)

class LocalDownloaderModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val tasks = ConcurrentHashMap<String, TaskState>()
  private val cancelFlags = ConcurrentHashMap<String, File>()
  private val ignoredTaskResults = ConcurrentHashMap.newKeySet<String>()
  private val lastErrors = ArrayDeque<String>()
  private val tag = "LocalDownloader"

  @Volatile
  private var activeTaskId: String? = null

  @Volatile
  private var activeJob: Job? = null

  @Volatile
  private var cachedFfmpegInfo: FfmpegInfo? = null

  override fun definition() = ModuleDefinition {
    Name("LocalDownloader")
    Events("downloadProgress")

    OnCreate {
      loadTaskSnapshot()
      cachedFfmpegInfo = resolveBundledFfmpegPath()
    }

    AsyncFunction("startDownload") { input: Map<String, Any?> ->
      val url = (input["url"] as? String)?.trim().orEmpty()
      val cookieProfile = (input["cookieProfile"] as? String)?.trim().orEmpty().ifEmpty { null }
      val maxFileSizeMb = (input["maxFileSizeMb"] as? Number)?.toInt()?.coerceIn(1, 8192) ?: DEFAULT_MAX_FILE_SIZE_MB

      if (url.isBlank()) {
        throw IllegalArgumentException("INVALID_URL")
      }

      if (activeJob?.isActive == true) {
        throw IllegalStateException("DOWNLOAD_ALREADY_IN_PROGRESS")
      }

      val taskId = UUID.randomUUID().toString()
      ignoredTaskResults.remove(taskId)

      val task = TaskState(taskId = taskId, status = "PENDING")
      tasks[taskId] = task
      persistTaskSnapshot()
      emitProgress(taskId, "PENDING", "starting", "Task created")

      val reactContext = requireNotNull(appContext.reactContext)
      val outputDir = File(reactContext.cacheDir, "local_downloads").apply { mkdirs() }
      val cookiesDir = File(reactContext.filesDir, "cookies").apply { mkdirs() }
      val cancelFlag = createCancelFlag(taskId)

      activeTaskId = taskId
      activeJob = scope.launch {
        runCatching {
          updateStatus(taskId, "STARTED", null, null, null, null, null)
          emitProgress(taskId, "STARTED", "starting", "Preflight")

          val ffmpegInfo = getOrResolveFfmpegInfo()
          val preflightResult = callPythonPreflight(
            PreflightPythonInput(
              url = url,
              cookiesDir = cookiesDir.absolutePath,
              cookieProfile = cookieProfile,
              maxFileSizeMb = maxFileSizeMb,
              ffmpegPath = ffmpegInfo.path,
            )
          )

          if (shouldIgnoreTaskResult(taskId)) {
            return@runCatching
          }

          val estimatedSizeMb = preflightResult.optDouble("estimated_size_mb", Double.NaN)
            .takeIf { !it.isNaN() && it > 0.0 }
          if (estimatedSizeMb != null) {
            tasks[taskId]?.estimatedSizeMb = estimatedSizeMb
            persistTaskSnapshot()
          }

          if (isCancelRequested(taskId)) {
            markCancelled(taskId, "Cancellation confirmed before download start")
            return@runCatching
          }

          if (!preflightResult.optBoolean("success", false)) {
            val code = preflightResult.optString("code", "INTERNAL_ERROR")
            val msg = preflightResult.optString("message", "Preflight failed")

            if (code == "DOWNLOAD_CANCELLED") {
              markCancelled(taskId, msg)
              return@runCatching
            }

            updateStatus(taskId, "FAILURE", null, null, null, code, msg)
            emitProgress(taskId, "FAILURE", "error", msg)
            addError("$code: $msg")
            return@runCatching
          }

          val freeMb = getFreeSpaceMb(outputDir)
          val requiredFreeMb = if (estimatedSizeMb != null) {
            max(1024.0, estimatedSizeMb * 2.5)
          } else {
            1024.0
          }

          if (freeMb < requiredFreeMb) {
            val msg = "Not enough free storage. Free=${"%.1f".format(freeMb)}MB, Required=${"%.1f".format(requiredFreeMb)}MB"
            updateStatus(taskId, "FAILURE", null, null, null, "SERVER_BUSY", msg)
            emitProgress(taskId, "FAILURE", "error", msg)
            addError("SERVER_BUSY: $msg")
            return@runCatching
          }

          emitProgress(taskId, "PROGRESS", "downloading", "Downloading media")
          updateStatus(taskId, "PROGRESS", null, null, null, null, null)

          val result = callPythonDownload(
            DownloadPythonInput(
              url = url,
              outputDir = outputDir.absolutePath,
              cookiesDir = cookiesDir.absolutePath,
              cookieProfile = cookieProfile,
              maxFileSizeMb = maxFileSizeMb,
              cancelFlagPath = cancelFlag.absolutePath,
              ffmpegPath = ffmpegInfo.path,
            )
          )

          if (shouldIgnoreTaskResult(taskId)) {
            return@runCatching
          }

          if (result.optBoolean("success", false)) {
            if (isCancelRequested(taskId)) {
              markCancelled(taskId, "Cancellation confirmed after worker completion")
              return@runCatching
            }

            val filename = result.optString("filename").ifBlank { null }
            val filePath = result.optString("file_path").ifBlank { null }
            val sizeMb = result.optDouble("size_mb", Double.NaN).takeIf { !it.isNaN() }

            updateStatus(taskId, "SUCCESS", filename, filePath, sizeMb, null, null)
            emitProgress(taskId, "SUCCESS", "completed", filename ?: "Download completed")
          } else {
            val code = result.optString("code", "INTERNAL_ERROR")
            val message = result.optString("message", "Download failed")

            if (code == "DOWNLOAD_CANCELLED") {
              markCancelled(taskId, message)
              return@runCatching
            }

            updateStatus(taskId, "FAILURE", null, null, null, code, message)
            emitProgress(taskId, "FAILURE", "error", message)
            addError("$code: $message")
          }
        }.onFailure {
          if (shouldIgnoreTaskResult(taskId)) {
            return@onFailure
          }

          Log.e(tag, "Task failed", it)
          val message = it.message ?: "Unexpected error"
          updateStatus(taskId, "FAILURE", null, null, null, "INTERNAL_ERROR", message)
          emitProgress(taskId, "FAILURE", "error", message)
          addError("INTERNAL_ERROR: $message")
        }

        clearCancelFlag(taskId)
        if (activeTaskId == taskId) {
          activeTaskId = null
          activeJob = null
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
      if (activeTaskId != taskId || activeJob == null) {
        return@AsyncFunction mapOf("success" to false)
      }

      markCancelRequested(taskId)
      val job = activeJob
      val confirmed = runBlocking {
        withTimeoutOrNull(CANCEL_CONFIRM_TIMEOUT_MS) {
          job?.join()
          true
        } ?: false
      }

      if (confirmed) {
        if (!isTerminalStatus(tasks[taskId]?.status)) {
          markCancelled(taskId, "Task cancelled")
        }
      } else {
        ignoredTaskResults.add(taskId)
        updateStatus(
          taskId,
          "FAILURE",
          null,
          null,
          null,
          "TASK_CANCEL_TIMEOUT",
          "Cancellation requested, but downloader did not stop in time."
        )
        emitProgress(taskId, "FAILURE", "error", "Cancellation timed out")
        addError("TASK_CANCEL_TIMEOUT: task=$taskId")
        activeTaskId = null
        activeJob = null
      }

      mapOf(
        "success" to true,
        "confirmed" to confirmed
      )
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

      if (readDefaultProfile(platformDir) == null) {
        writeDefaultProfile(platformDir, profileName)
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

    AsyncFunction("setCookieDefault") { input: Map<String, String> ->
      val platform = input["platform"]?.trim().orEmpty().lowercase()
      val profileName = input["profileName"]?.trim().orEmpty()

      if (!SUPPORTED_PLATFORMS.contains(platform) || profileName.isBlank()) {
        return@AsyncFunction mapOf("success" to false)
      }

      val platformDir = File(requireNotNull(appContext.reactContext).filesDir, "cookies/$platform")
      if (!platformDir.exists()) {
        return@AsyncFunction mapOf("success" to false)
      }

      val profileExists = platformDir.listFiles()
        ?.any { it.isFile && it.nameWithoutExtension == profileName && (it.extension == "txt" || it.extension == "json") }
        ?: false

      if (!profileExists) {
        return@AsyncFunction mapOf("success" to false)
      }

      writeDefaultProfile(platformDir, profileName)
      mapOf("success" to true)
    }

    AsyncFunction("getCookieDefaults") {
      val cookiesRoot = File(requireNotNull(appContext.reactContext).filesDir, "cookies")
      SUPPORTED_PLATFORMS.associateWith { platform ->
        val platformDir = File(cookiesRoot, platform)
        if (!platformDir.exists()) {
          null
        } else {
          readDefaultProfile(platformDir)
        }
      }
    }

    AsyncFunction("getDiagnostics") {
      val ffmpegInfo = getOrResolveFfmpegInfo()

      var ytDlpVersion = "unknown"
      var ytDlpAvailable = false
      var pythonReady = Python.isStarted()

      runCatching {
        ensurePythonReady()
        pythonReady = true
        val py = Python.getInstance()
        ytDlpVersion = py.getModule("yt_dlp.version").get("__version__").toString()
        ytDlpAvailable = true
      }.onFailure {
        addError("YT_DLP_IMPORT_ERROR: ${it.message}")
      }

      mapOf(
        "ytDlpVersion" to ytDlpVersion,
        "ytDlpAvailable" to ytDlpAvailable,
        "pythonReady" to pythonReady,
        "ffmpegPath" to ffmpegInfo.path,
        "ffmpegAbi" to ffmpegInfo.abi,
        "ffmpegVersion" to ffmpegInfo.version,
        "ffmpegExists" to ffmpegInfo.exists,
        "ffmpegExecutable" to ffmpegInfo.executable,
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

  private fun callPythonPreflight(input: PreflightPythonInput): JSONObject {
    ensurePythonReady()
    val py = Python.getInstance()
    val module = py.getModule("local_downloader")
    val result = module.callAttr(
      "preflight",
      input.url,
      input.cookiesDir,
      input.cookieProfile,
      input.maxFileSizeMb,
      input.ffmpegPath
    )
    return JSONObject(result.toString())
  }

  private fun callPythonDownload(input: DownloadPythonInput): JSONObject {
    ensurePythonReady()
    val py = Python.getInstance()
    val module = py.getModule("local_downloader")
    val result = module.callAttr(
      "run_download",
      input.url,
      input.outputDir,
      input.cookiesDir,
      input.cookieProfile,
      input.maxFileSizeMb,
      input.cancelFlagPath,
      input.ffmpegPath
    )
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
    return stat.availableBytes.toDouble() / MB_IN_BYTES
  }

  private fun sanitizeProfileName(value: String): String {
    return value
      .trim()
      .lowercase()
      .replace(Regex("[^a-z0-9._-]"), "_")
      .removeSuffix(".txt")
      .ifBlank { "default" }
  }

  private fun getOrResolveFfmpegInfo(): FfmpegInfo {
    val cached = cachedFfmpegInfo
    if (cached != null) {
      return cached
    }

    val resolved = resolveBundledFfmpegPath()
    cachedFfmpegInfo = resolved
    return resolved
  }

  private fun resolveBundledFfmpegPath(): FfmpegInfo {
    val context = requireNotNull(appContext.reactContext)
    val candidateAbis = Build.SUPPORTED_ABIS?.toList()?.ifEmpty { SUPPORTED_FFMPEG_ABIS } ?: SUPPORTED_FFMPEG_ABIS

    for (abi in candidateAbis) {
      if (!SUPPORTED_FFMPEG_ABIS.contains(abi)) {
        continue
      }

      val targetDir = File(context.filesDir, "ffmpeg/$abi").apply { mkdirs() }
      val targetFile = File(targetDir, "ffmpeg")
      val checksumFile = File(targetDir, "ffmpeg.sha256")
      val assetPath = "ffmpeg/$abi/ffmpeg"

      val expectedChecksum = computeAssetSha256(assetPath) ?: continue
      val needsCopy = !targetFile.exists() || !checksumFile.exists() || checksumFile.readText().trim() != expectedChecksum

      if (needsCopy) {
        val copied = copyAssetToFile(assetPath, targetFile)
        if (!copied) {
          continue
        }
        checksumFile.writeText(expectedChecksum)
      }

      val executable = targetFile.setExecutable(true, false) && targetFile.canExecute()
      val version = if (executable) probeFfmpegVersion(targetFile.absolutePath) else null

      if (targetFile.exists()) {
        return FfmpegInfo(
          path = targetFile.absolutePath,
          abi = abi,
          exists = true,
          executable = executable,
          version = version,
        )
      }
    }

    addError("FFMPEG_NOT_AVAILABLE: no compatible bundled binary found")
    return FfmpegInfo()
  }

  private fun computeAssetSha256(assetPath: String): String? {
    val context = requireNotNull(appContext.reactContext)
    return runCatching {
      context.assets.open(assetPath).use { stream ->
        val digest = MessageDigest.getInstance("SHA-256")
        val buffer = ByteArray(8192)
        while (true) {
          val read = stream.read(buffer)
          if (read <= 0) {
            break
          }
          digest.update(buffer, 0, read)
        }
        digest.digest().joinToString(separator = "") { "%02x".format(it) }
      }
    }.getOrNull()
  }

  private fun copyAssetToFile(assetPath: String, targetFile: File): Boolean {
    val context = requireNotNull(appContext.reactContext)
    return runCatching {
      context.assets.open(assetPath).use { inputStream ->
        targetFile.outputStream().use { outputStream ->
          inputStream.copyTo(outputStream)
        }
      }
      true
    }.getOrElse {
      if (it !is IOException) {
        addError("FFMPEG_COPY_ERROR: ${it.message}")
      }
      false
    }
  }

  private fun probeFfmpegVersion(binaryPath: String): String? {
    return runCatching {
      val process = ProcessBuilder(binaryPath, "-version")
        .redirectErrorStream(true)
        .start()

      val finished = process.waitFor(2, TimeUnit.SECONDS)
      if (!finished) {
        process.destroyForcibly()
        return@runCatching null
      }

      process.inputStream.bufferedReader().use { reader ->
        reader.readLine()?.trim()
      }
    }.getOrNull()
  }

  private fun createCancelFlag(taskId: String): File {
    val context = requireNotNull(appContext.reactContext)
    val cancelDir = File(context.cacheDir, "local_download_cancel_flags").apply { mkdirs() }
    val flagFile = File(cancelDir, "$taskId.cancel")
    if (flagFile.exists()) {
      flagFile.delete()
    }
    cancelFlags[taskId] = flagFile
    return flagFile
  }

  private fun markCancelRequested(taskId: String) {
    val flag = cancelFlags[taskId] ?: return
    runCatching {
      if (!flag.exists()) {
        flag.writeText("cancel")
      }
    }.onFailure {
      addError("CANCEL_FLAG_WRITE_FAILED: ${it.message}")
    }
  }

  private fun isCancelRequested(taskId: String): Boolean {
    return cancelFlags[taskId]?.exists() == true
  }

  private fun clearCancelFlag(taskId: String) {
    val flag = cancelFlags.remove(taskId) ?: return
    runCatching {
      if (flag.exists()) {
        flag.delete()
      }
    }
  }

  private fun markCancelled(taskId: String, message: String) {
    updateStatus(taskId, "CANCELLED", null, null, null, "TASK_CANCELLED", message)
    emitProgress(taskId, "CANCELLED", "error", message)
  }

  private fun isTerminalStatus(status: String?): Boolean {
    return status == "SUCCESS" || status == "FAILURE" || status == "CANCELLED"
  }

  private fun shouldIgnoreTaskResult(taskId: String): Boolean {
    return ignoredTaskResults.contains(taskId)
  }

  private fun readDefaultProfile(platformDir: File): String? {
    val file = File(platformDir, DEFAULT_COOKIE_PROFILE_FILENAME)
    if (!file.exists()) {
      return null
    }

    val value = file.readText().trim()
    if (value.isBlank()) {
      return null
    }

    val profileExists = platformDir.listFiles()
      ?.any { it.isFile && it.nameWithoutExtension == value && (it.extension == "txt" || it.extension == "json") }
      ?: false

    return if (profileExists) value else null
  }

  private fun writeDefaultProfile(platformDir: File, profileName: String) {
    val file = File(platformDir, DEFAULT_COOKIE_PROFILE_FILENAME)
    file.writeText(profileName)
  }

  private fun addError(message: String) {
    val timestamped = "${Instant.now()}: $message"
    lastErrors.addFirst(timestamped)
    while (lastErrors.size > MAX_ERROR_LOGS) {
      lastErrors.removeLast()
    }
  }

  private fun persistTaskSnapshot() {
    runCatching {
      val context = requireNotNull(appContext.reactContext)
      val file = File(context.filesDir, TASK_SNAPSHOT_FILENAME)
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
      val file = File(context.filesDir, TASK_SNAPSHOT_FILENAME)
      if (!file.exists()) return

      var hadRestartedInFlightTask = false
      val array = JSONArray(file.readText())
      for (i in 0 until array.length()) {
        val obj = array.getJSONObject(i)
        val taskId = obj.optString("taskId")
        if (taskId.isBlank()) continue

        val originalStatus = obj.optString("status", "PENDING")
        val wasInFlight = originalStatus in IN_FLIGHT_STATUSES

        tasks[taskId] = TaskState(
          taskId = taskId,
          status = if (wasInFlight) "FAILURE" else originalStatus,
          filename = obj.optString("filename").ifBlank { null },
          filePath = obj.optString("filePath").ifBlank { null },
          sizeMb = obj.optDouble("sizeMb", Double.NaN).takeIf { !it.isNaN() },
          errorCode = if (wasInFlight) "PROCESS_RESTARTED" else obj.optString("errorCode").ifBlank { null },
          errorMessage = if (wasInFlight) {
            "Download was interrupted because app process restarted."
          } else {
            obj.optString("errorMessage").ifBlank { null }
          },
          estimatedSizeMb = obj.optDouble("estimatedSizeMb", Double.NaN).takeIf { !it.isNaN() }
        )

        if (wasInFlight) {
          hadRestartedInFlightTask = true
        }
      }

      if (hadRestartedInFlightTask) {
        persistTaskSnapshot()
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
    private const val DEFAULT_MAX_FILE_SIZE_MB = 2048
    private const val TASK_SNAPSHOT_FILENAME = "local_downloader_tasks.json"
    private const val DEFAULT_COOKIE_PROFILE_FILENAME = ".default_profile"
    private const val MAX_ERROR_LOGS = 20
    private const val MB_IN_BYTES = 1024.0 * 1024.0
    private const val CANCEL_CONFIRM_TIMEOUT_MS = 2500L

    private val SUPPORTED_PLATFORMS = setOf("youtube", "instagram", "facebook", "twitter", "reddit")
    private val IN_FLIGHT_STATUSES = setOf("PENDING", "STARTED", "PROGRESS")
    private val SUPPORTED_FFMPEG_ABIS = listOf("arm64-v8a", "armeabi-v7a", "x86_64")
  }
}

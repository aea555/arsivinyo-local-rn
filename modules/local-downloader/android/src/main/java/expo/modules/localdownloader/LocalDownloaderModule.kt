package expo.modules.localdownloader

import android.net.Uri
import android.os.Build
import android.os.StatFs
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
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
import java.io.IOException
import java.net.URI
import java.security.KeyStore
import java.security.MessageDigest
import java.time.Instant
import java.util.ArrayDeque
import java.util.UUID
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.TimeUnit
import javax.crypto.AEADBadTagException
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec
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
  val ffmpegPath: String?,
  val cookieFilePath: String?,
  val forceNoCookie: Boolean = false
)

data class DownloadPythonInput(
  val url: String,
  val outputDir: String,
  val cookiesDir: String,
  val cookieProfile: String?,
  val maxFileSizeMb: Int,
  val cancelFlagPath: String?,
  val ffmpegPath: String?,
  val cookieFilePath: String?,
  val forceNoCookie: Boolean = false
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

  @Volatile
  private var cookieMigrationStatus: String = "not_needed"

  override fun definition() = ModuleDefinition {
    Name("LocalDownloader")
    Events("downloadProgress")

    OnCreate {
      cleanupRuntimeCookieTemp()
      migrateLegacyCookieStoreIfNeeded()
      loadTaskSnapshot()
      cachedFfmpegInfo = resolveBundledFfmpegPath()
    }

    AsyncFunction("startDownload") { input: Map<String, Any?> ->
      val url = (input["url"] as? String)?.trim().orEmpty()
      val cookiePlatform = (input["cookiePlatform"] as? String)?.trim()?.lowercase()?.takeIf { SUPPORTED_PLATFORMS.contains(it) }
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
      val cookiesDir = File(reactContext.filesDir, LEGACY_COOKIES_DIRNAME).apply { mkdirs() }
      val disabledCookiesDir = File(reactContext.filesDir, DISABLED_COOKIES_DIRNAME)
      val cancelFlag = createCancelFlag(taskId)

      activeTaskId = taskId
      activeJob = scope.launch {
        var runtimeCookiePath: String? = null
        runCatching {
          updateStatus(taskId, "STARTED", null, null, null, null, null)
          emitProgress(taskId, "STARTED", "starting", "Preflight")

          runtimeCookiePath = prepareRuntimeCookiePath(taskId, url, cookieProfile, cookiePlatform)
          var effectiveCookiePath = runtimeCookiePath

          val ffmpegInfo = getOrResolveFfmpegInfo()
          var preflightResult = callPythonPreflight(
            PreflightPythonInput(
              url = url,
              cookiesDir = cookiesDir.absolutePath,
              cookieProfile = cookieProfile,
              maxFileSizeMb = maxFileSizeMb,
              ffmpegPath = ffmpegInfo.path,
              cookieFilePath = effectiveCookiePath,
              forceNoCookie = false,
            )
          )

          if (!preflightResult.optBoolean("success", false) && shouldRetryWithoutCookies(preflightResult, effectiveCookiePath)) {
            addError("COOKIE_RETRY_PREFLIGHT: task=$taskId")
            cleanupRuntimeCookieTemp(taskId)
            effectiveCookiePath = null
            preflightResult = callPythonPreflight(
              PreflightPythonInput(
                url = url,
                cookiesDir = disabledCookiesDir.absolutePath,
                cookieProfile = null,
                maxFileSizeMb = maxFileSizeMb,
                ffmpegPath = ffmpegInfo.path,
                cookieFilePath = null,
                forceNoCookie = true,
              )
            )
          }

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

          var result = callPythonDownload(
            DownloadPythonInput(
              url = url,
              outputDir = outputDir.absolutePath,
              cookiesDir = cookiesDir.absolutePath,
              cookieProfile = cookieProfile,
              maxFileSizeMb = maxFileSizeMb,
              cancelFlagPath = cancelFlag.absolutePath,
              ffmpegPath = ffmpegInfo.path,
              cookieFilePath = effectiveCookiePath,
              forceNoCookie = false,
            )
          )

          if (!result.optBoolean("success", false) && shouldRetryWithoutCookies(result, effectiveCookiePath)) {
            addError("COOKIE_RETRY_DOWNLOAD: task=$taskId")
            emitProgress(taskId, "PROGRESS", "downloading", "Retrying without cookies")
            cleanupRuntimeCookieTemp(taskId)
            effectiveCookiePath = null
            result = callPythonDownload(
              DownloadPythonInput(
                url = url,
                outputDir = outputDir.absolutePath,
                cookiesDir = disabledCookiesDir.absolutePath,
                cookieProfile = null,
                maxFileSizeMb = maxFileSizeMb,
                cancelFlagPath = cancelFlag.absolutePath,
                ffmpegPath = ffmpegInfo.path,
                cookieFilePath = null,
                forceNoCookie = true,
              )
            )
          }

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
          val code = extractKnownErrorCode(message) ?: "INTERNAL_ERROR"
          updateStatus(taskId, "FAILURE", null, null, null, code, message)
          emitProgress(taskId, "FAILURE", "error", message)
          addError("$code: $message")
        }

        cleanupRuntimeCookieTemp(taskId)
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
      val platformDir = secureCookiePlatformDir(platform, create = true)
      val dest = File(platformDir, "$profileName.enc")

      val sourceUri = Uri.parse(uri)
      val resolver = requireNotNull(appContext.reactContext).contentResolver
      val rawContent = resolver.openInputStream(sourceUri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
        ?: throw IllegalArgumentException("Could not open cookie file")
      val normalizedCookieText = normalizeCookieContent(rawContent)

      writeEncryptedCookieFile(dest, normalizedCookieText.toByteArray(Charsets.UTF_8))

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

      val platformDir = secureCookiePlatformDir(normalized, create = false)
      if (!platformDir.exists()) {
        return@AsyncFunction emptyList<Map<String, Any>>()
      }

      platformDir.listFiles()
        ?.filter { it.isFile && it.extension == "enc" }
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

      val platformDir = secureCookiePlatformDir(platform, create = false)
      if (!platformDir.exists()) {
        return@AsyncFunction mapOf("success" to false)
      }

      val profileExists = platformDir.listFiles()
        ?.any { it.isFile && it.nameWithoutExtension == profileName && it.extension == "enc" }
        ?: false

      if (!profileExists) {
        return@AsyncFunction mapOf("success" to false)
      }

      writeDefaultProfile(platformDir, profileName)
      mapOf("success" to true)
    }

    AsyncFunction("getCookieDefaults") {
      val cookiesRoot = secureCookiesRoot(create = false)
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
        "secureCookieStoreEnabled" to isSecureCookieStoreEnabled(),
        "cookieEncryptionVersion" to COOKIE_STORE_VERSION,
        "cookieProfilesEncryptedCount" to countSecureCookieProfiles(),
        "cookieLegacyPlaintextCount" to countLegacyCookieProfiles(),
        "cookieMigrationStatus" to cookieMigrationStatus,
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
      input.ffmpegPath,
      input.cookieFilePath,
      input.forceNoCookie
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
      input.ffmpegPath,
      input.cookieFilePath,
      input.forceNoCookie
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

  private fun prepareRuntimeCookiePath(
    taskId: String,
    url: String,
    requestedProfile: String?,
    preferredPlatform: String?
  ): String? {
    val platform = preferredPlatform ?: detectCookiePlatform(url) ?: return null
    val selectedFile = selectSecureCookieFile(platform, requestedProfile)

    if (requestedProfile != null && selectedFile == null) {
      throw IllegalStateException("COOKIE_PROFILE_NOT_FOUND")
    }
    if (selectedFile == null) {
      return null
    }

    val runtimeDir = runtimeCookieTaskDir(taskId).apply { mkdirs() }
    val runtimeFile = File(runtimeDir, "cookie.txt")
    val plaintext = readEncryptedCookieFile(selectedFile)
    atomicWriteBytes(runtimeFile, plaintext)
    return runtimeFile.absolutePath
  }

  private fun shouldRetryWithoutCookies(result: JSONObject, usedCookiePath: String?): Boolean {
    if (usedCookiePath.isNullOrBlank()) {
      return false
    }

    val code = result.optString("code", "")
    if (code == "DOWNLOAD_CANCELLED" || code == "FILE_TOO_LARGE") {
      return false
    }

    if (code in RETRYABLE_COOKIE_FAILURE_CODES) {
      return true
    }

    val message = result.optString("message", "").lowercase()
    return message.contains("cookie") || message.contains("sign in") || message.contains("login")
  }

  private fun detectCookiePlatform(url: String): String? {
    val host = runCatching {
      val parsed = URI(url)
      parsed.host?.lowercase()?.removePrefix("www.")
    }.getOrNull() ?: return null

    for ((platform, hosts) in PLATFORM_HOSTS) {
      if (hosts.any { host == it || host.endsWith(".$it") }) {
        return platform
      }
    }
    return null
  }

  private fun selectSecureCookieFile(platform: String, requestedProfile: String?): File? {
    val platformDir = secureCookiePlatformDir(platform, create = false)
    if (!platformDir.exists()) {
      return null
    }

    val files = platformDir.listFiles()
      ?.filter { it.isFile && it.extension == "enc" }
      ?.sortedByDescending { it.lastModified() }
      ?: emptyList()
    if (files.isEmpty()) {
      return null
    }

    if (!requestedProfile.isNullOrBlank()) {
      val normalized = sanitizeProfileName(requestedProfile)
      return files.firstOrNull { it.nameWithoutExtension == normalized }
    }

    val defaultProfile = readDefaultProfile(platformDir)
    if (!defaultProfile.isNullOrBlank()) {
      val defaultMatch = files.firstOrNull { it.nameWithoutExtension == defaultProfile }
      if (defaultMatch != null) {
        return defaultMatch
      }
    }

    return files.firstOrNull()
  }

  private fun secureCookiesRoot(create: Boolean): File {
    val root = File(requireNotNull(appContext.reactContext).filesDir, "$SECURE_COOKIES_DIRNAME/$COOKIE_STORE_VERSION")
    if (create) {
      root.mkdirs()
    }
    return root
  }

  private fun secureCookiePlatformDir(platform: String, create: Boolean): File {
    val dir = File(secureCookiesRoot(create = create), platform)
    if (create) {
      dir.mkdirs()
    }
    return dir
  }

  private fun legacyCookiesRoot(): File {
    return File(requireNotNull(appContext.reactContext).filesDir, LEGACY_COOKIES_DIRNAME)
  }

  private fun runtimeCookieRoot(): File {
    return File(requireNotNull(appContext.reactContext).cacheDir, RUNTIME_COOKIE_DIRNAME)
  }

  private fun runtimeCookieTaskDir(taskId: String): File {
    return File(runtimeCookieRoot(), taskId)
  }

  private fun cleanupRuntimeCookieTemp(taskId: String? = null) {
    if (taskId == null) {
      runCatching {
        runtimeCookieRoot().deleteRecursively()
      }
      return
    }

    runCatching {
      runtimeCookieTaskDir(taskId).deleteRecursively()
    }
  }

  private fun writeEncryptedCookieFile(target: File, plaintext: ByteArray) {
    val encrypted = encryptCookieBytes(plaintext)
    atomicWriteBytes(target, encrypted)
  }

  private fun readEncryptedCookieFile(source: File): ByteArray {
    val payload = runCatching { source.readBytes() }.getOrElse {
      throw IllegalStateException("COOKIE_STORE_DECRYPT_FAILED")
    }
    return decryptCookieBytes(payload)
  }

  private fun encryptCookieBytes(plaintext: ByteArray): ByteArray {
    return runCatching {
      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.ENCRYPT_MODE, getOrCreateCookieKey())
      val iv = cipher.iv
      val encrypted = cipher.doFinal(plaintext)
      if (iv.isEmpty() || iv.size > 255) {
        throw IllegalStateException("Invalid IV length")
      }

      ByteArray(1 + iv.size + encrypted.size).also { out ->
        out[0] = iv.size.toByte()
        System.arraycopy(iv, 0, out, 1, iv.size)
        System.arraycopy(encrypted, 0, out, 1 + iv.size, encrypted.size)
      }
    }.getOrElse {
      throw IllegalStateException("COOKIE_STORE_ENCRYPT_FAILED")
    }
  }

  private fun decryptCookieBytes(payload: ByteArray): ByteArray {
    try {
      if (payload.size < 2) {
        throw IllegalStateException("Invalid encrypted payload")
      }

      val ivLength = payload[0].toInt() and 0xff
      if (ivLength <= 0 || payload.size <= 1 + ivLength) {
        throw IllegalStateException("Invalid encrypted payload")
      }

      val iv = payload.copyOfRange(1, 1 + ivLength)
      val ciphertext = payload.copyOfRange(1 + ivLength, payload.size)

      val cipher = Cipher.getInstance("AES/GCM/NoPadding")
      cipher.init(Cipher.DECRYPT_MODE, getOrCreateCookieKey(), GCMParameterSpec(128, iv))
      return cipher.doFinal(ciphertext)
    } catch (_: AEADBadTagException) {
      throw IllegalStateException("COOKIE_STORE_DECRYPT_FAILED")
    } catch (_: Exception) {
      throw IllegalStateException("COOKIE_STORE_DECRYPT_FAILED")
    }
  }

  private fun getOrCreateCookieKey(): SecretKey {
    val keyStore = KeyStore.getInstance(ANDROID_KEYSTORE).apply { load(null) }
    val existing = keyStore.getKey(COOKIE_KEY_ALIAS, null) as? SecretKey
    if (existing != null) {
      return existing
    }

    val keyGenerator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, ANDROID_KEYSTORE)
    val spec = KeyGenParameterSpec.Builder(
      COOKIE_KEY_ALIAS,
      KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT
    )
      .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
      .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
      .setRandomizedEncryptionRequired(true)
      .build()

    keyGenerator.init(spec)
    return keyGenerator.generateKey()
  }

  private fun atomicWriteBytes(target: File, data: ByteArray) {
    target.parentFile?.mkdirs()
    val temp = File(target.parentFile, ".${target.name}.${UUID.randomUUID()}.tmp")
    temp.outputStream().use { it.write(data) }
    if (!temp.renameTo(target)) {
      target.outputStream().use { it.write(data) }
      temp.delete()
    }
  }

  private fun migrateLegacyCookieStoreIfNeeded() {
    val legacyRoot = legacyCookiesRoot()
    val secureRoot = secureCookiesRoot(create = true)
    val marker = File(secureRoot, COOKIE_MIGRATION_MARKER_FILENAME)

    val legacyCount = countLegacyCookieProfiles()
    if (marker.exists()) {
      cookieMigrationStatus = if (legacyCount > 0) "partial" else "migrated"
      return
    }
    if (legacyCount == 0) {
      cookieMigrationStatus = "not_needed"
      return
    }

    var hadFailures = false
    var migratedAny = false

    SUPPORTED_PLATFORMS.forEach { platform ->
      val legacyPlatformDir = File(legacyRoot, platform)
      if (!legacyPlatformDir.exists()) {
        return@forEach
      }

      val securePlatformDir = secureCookiePlatformDir(platform, create = true)
      val legacyFiles = legacyPlatformDir.listFiles()
        ?.filter { it.isFile && (it.extension == "txt" || it.extension == "json") }
        ?: emptyList()

      legacyFiles.forEach { file ->
        val profileName = sanitizeProfileName(file.nameWithoutExtension)
        val secureFile = File(securePlatformDir, "$profileName.enc")
        val migrated = runCatching {
          val normalized = normalizeCookieContent(file.readText(Charsets.UTF_8))
          writeEncryptedCookieFile(secureFile, normalized.toByteArray(Charsets.UTF_8))
          val roundTrip = readEncryptedCookieFile(secureFile).toString(Charsets.UTF_8)
          if (roundTrip.isBlank()) {
            throw IllegalStateException("Round-trip validation failed")
          }
          file.delete()
        }.onFailure {
          hadFailures = true
          addError("COOKIE_MIGRATION_FAILED: platform=$platform profile=${file.nameWithoutExtension}")
        }.isSuccess

        if (migrated) {
          migratedAny = true
        }
      }

      val legacyDefault = readDefaultProfileLegacy(legacyPlatformDir)
      if (!legacyDefault.isNullOrBlank()) {
        val normalizedDefault = sanitizeProfileName(legacyDefault)
        val existsInSecure = File(securePlatformDir, "$normalizedDefault.enc").exists()
        if (existsInSecure) {
          writeDefaultProfile(securePlatformDir, normalizedDefault)
        }
      }
      File(legacyPlatformDir, DEFAULT_COOKIE_PROFILE_FILENAME).delete()
      if (legacyPlatformDir.listFiles().isNullOrEmpty()) {
        legacyPlatformDir.delete()
      }
    }

    cookieMigrationStatus = when {
      hadFailures && migratedAny -> "partial"
      hadFailures -> "failed"
      migratedAny -> "migrated"
      else -> "failed"
    }

    if (!hadFailures) {
      marker.writeText("ok")
    }
  }

  private fun readDefaultProfileLegacy(platformDir: File): String? {
    val file = File(platformDir, DEFAULT_COOKIE_PROFILE_FILENAME)
    if (!file.exists()) {
      return null
    }

    val value = sanitizeProfileName(file.readText().trim())
    if (value.isBlank()) {
      return null
    }

    val profileExists = platformDir.listFiles()
      ?.any { it.isFile && it.nameWithoutExtension == value && (it.extension == "txt" || it.extension == "json") }
      ?: false
    return if (profileExists) value else null
  }

  private fun countSecureCookieProfiles(): Int {
    val root = secureCookiesRoot(create = false)
    if (!root.exists()) {
      return 0
    }

    return SUPPORTED_PLATFORMS.sumOf { platform ->
      File(root, platform).listFiles()?.count { it.isFile && it.extension == "enc" } ?: 0
    }
  }

  private fun countLegacyCookieProfiles(): Int {
    val root = legacyCookiesRoot()
    if (!root.exists()) {
      return 0
    }

    return SUPPORTED_PLATFORMS.sumOf { platform ->
      File(root, platform).listFiles()?.count { it.isFile && (it.extension == "txt" || it.extension == "json") } ?: 0
    }
  }

  private fun isSecureCookieStoreEnabled(): Boolean {
    return runCatching {
      getOrCreateCookieKey()
      true
    }.getOrDefault(false)
  }

  private fun extractKnownErrorCode(message: String?): String? {
    if (message.isNullOrBlank()) {
      return null
    }

    val knownCodes = listOf(
      "COOKIE_STORE_ENCRYPT_FAILED",
      "COOKIE_STORE_DECRYPT_FAILED",
      "COOKIE_MIGRATION_FAILED",
      "COOKIE_PROFILE_NOT_FOUND",
      "INVALID_URL",
      "DOWNLOAD_ALREADY_IN_PROGRESS",
      "FILE_TOO_LARGE",
      "DOWNLOAD_CANCELLED",
      "TASK_CANCEL_TIMEOUT",
      "PROCESS_RESTARTED",
      "PREFLIGHT_FAILED",
      "INTERNAL_ERROR",
      "FILE_NOT_FOUND"
    )

    return knownCodes.firstOrNull { code -> message.contains(code) }
  }

  private fun sanitizeProfileName(value: String): String {
    return value
      .trim()
      .lowercase()
      .replace(Regex("[^a-z0-9._-]"), "_")
      .removeSuffix(".txt")
      .ifBlank { "default" }
  }

  private fun normalizeCookieContent(rawContent: String): String {
    val trimmed = rawContent.trim()
    if (trimmed.isBlank()) {
      throw IllegalArgumentException("Cookie file is empty")
    }

    return if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
      convertJsonCookiesToNetscape(trimmed)
    } else {
      validateNetscapeCookieText(rawContent)
    }
  }

  private fun validateNetscapeCookieText(rawContent: String): String {
    var cookieLines = 0
    rawContent.lineSequence().forEach { line ->
      val trimmed = line.trim()
      if (trimmed.isBlank() || trimmed.startsWith("#")) {
        return@forEach
      }

      val columns = line.split('\t')
      if (columns.size < 7) {
        throw IllegalArgumentException("Unsupported cookie format. Expected Netscape cookie file.")
      }
      cookieLines += 1
    }

    if (cookieLines == 0) {
      throw IllegalArgumentException("No valid cookie entries found")
    }

    return if (rawContent.endsWith("\n")) rawContent else "$rawContent\n"
  }

  private fun convertJsonCookiesToNetscape(jsonText: String): String {
    val cookies = extractCookieArray(jsonText)
    val output = StringBuilder()
    output.append("# Netscape HTTP Cookie File\n")
    output.append("# Generated by Arsivinyo Local\n")
    output.append("# This file is used by yt-dlp\n\n")

    var written = 0
    for (i in 0 until cookies.length()) {
      val cookie = cookies.optJSONObject(i) ?: continue
      val name = cookie.optString("name").sanitizeCookieField()
      val value = cookie.optString("value").sanitizeCookieField()
      if (name.isBlank()) continue

      val rawDomain = (
        cookie.optString("domain")
          .ifBlank { cookie.optString("host") }
      ).sanitizeCookieField()
      if (rawDomain.isBlank()) continue

      val hostOnly = cookie.optBoolean("hostOnly", false)
      val includeSubdomains = if (hostOnly) "FALSE" else "TRUE"
      val domain = when {
        hostOnly -> rawDomain.removePrefix(".")
        rawDomain.startsWith(".") -> rawDomain
        else -> ".$rawDomain"
      }

      val path = cookie.optString("path", "/").ifBlank { "/" }.sanitizeCookieField()
      val secure = if (cookie.optBoolean("secure", false)) "TRUE" else "FALSE"
      val expiry = parseCookieExpiry(cookie).coerceAtLeast(0L)

      output
        .append(domain)
        .append('\t')
        .append(includeSubdomains)
        .append('\t')
        .append(path)
        .append('\t')
        .append(secure)
        .append('\t')
        .append(expiry)
        .append('\t')
        .append(name)
        .append('\t')
        .append(value)
        .append('\n')

      written += 1
    }

    if (written == 0) {
      throw IllegalArgumentException("No valid cookies found in JSON file")
    }

    return output.toString()
  }

  private fun extractCookieArray(jsonText: String): JSONArray {
    if (jsonText.trimStart().startsWith("[")) {
      return JSONArray(jsonText)
    }

    val root = JSONObject(jsonText)
    if (root.has("cookies") && root.optJSONArray("cookies") != null) {
      return root.getJSONArray("cookies")
    }
    if (root.has("items") && root.optJSONArray("items") != null) {
      return root.getJSONArray("items")
    }
    if (root.has("data") && root.optJSONArray("data") != null) {
      return root.getJSONArray("data")
    }

    return JSONArray().put(root)
  }

  private fun parseCookieExpiry(cookie: JSONObject): Long {
    val candidate = when {
      cookie.has("expirationDate") -> cookie.opt("expirationDate")
      cookie.has("expires") -> cookie.opt("expires")
      cookie.has("expiry") -> cookie.opt("expiry")
      else -> null
    } ?: return 0L

    return when (candidate) {
      is Number -> normalizeEpoch(candidate.toLong())
      is String -> {
        candidate.toLongOrNull()?.let { normalizeEpoch(it) }
          ?: runCatching { Instant.parse(candidate).epochSecond }.getOrDefault(0L)
      }
      else -> 0L
    }
  }

  private fun normalizeEpoch(value: Long): Long {
    return if (value > 9_999_999_999L) value / 1000L else value
  }

  private fun String.sanitizeCookieField(): String {
    return this.replace('\t', ' ').replace('\n', ' ').replace('\r', ' ').trim()
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
      ?.any { it.isFile && it.nameWithoutExtension == value && it.extension == "enc" }
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
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val COOKIE_KEY_ALIAS = "arsivinyo.local.cookies.v1"
    private const val COOKIE_STORE_VERSION = "v1"
    private const val COOKIE_MIGRATION_MARKER_FILENAME = ".migration_complete"
    private const val SECURE_COOKIES_DIRNAME = "cookies_secure"
    private const val LEGACY_COOKIES_DIRNAME = "cookies"
    private const val RUNTIME_COOKIE_DIRNAME = "cookie_runtime"
    private const val DISABLED_COOKIES_DIRNAME = "cookies_disabled"
    private const val DEFAULT_MAX_FILE_SIZE_MB = 2048
    private const val TASK_SNAPSHOT_FILENAME = "local_downloader_tasks.json"
    private const val DEFAULT_COOKIE_PROFILE_FILENAME = ".default_profile"
    private const val MAX_ERROR_LOGS = 20
    private const val MB_IN_BYTES = 1024.0 * 1024.0
    private const val CANCEL_CONFIRM_TIMEOUT_MS = 2500L

    private val SUPPORTED_PLATFORMS = setOf("youtube", "instagram", "facebook", "twitter", "reddit", "tiktok")
    private val PLATFORM_HOSTS = mapOf(
      "youtube" to listOf("youtube.com", "youtu.be"),
      "instagram" to listOf("instagram.com"),
      "facebook" to listOf("facebook.com", "fb.watch"),
      "twitter" to listOf("twitter.com", "x.com"),
      "reddit" to listOf("reddit.com", "v.redd.it"),
      "tiktok" to listOf("tiktok.com", "vm.tiktok.com")
    )
    private val RETRYABLE_COOKIE_FAILURE_CODES = setOf("PREFLIGHT_FAILED", "DOWNLOAD_FAILED", "INTERNAL_ERROR")
    private val IN_FLIGHT_STATUSES = setOf("PENDING", "STARTED", "PROGRESS")
    private val SUPPORTED_FFMPEG_ABIS = listOf("arm64-v8a", "armeabi-v7a", "x86_64")
  }
}

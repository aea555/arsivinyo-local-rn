package expo.modules.localdownloader

import android.content.ContentValues
import android.net.Uri
import android.os.Build
import android.os.Environment
import android.os.StatFs
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import android.util.Log
import android.provider.MediaStore
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
  var estimatedSizeMb: Double? = null,
  var timestampNormalized: Boolean? = null,
  var warningCode: String? = null
)

data class FfmpegInfo(
  val path: String? = null,
  val ffprobePath: String? = null,
  val location: String? = null,
  val abi: String? = null,
  val runtimeSource: String = "none",
  val nativeLibraryDir: String? = null,
  val nativeLibraryEntries: List<String> = emptyList(),
  val exists: Boolean = false,
  val ffprobeExists: Boolean = false,
  val executable: Boolean = false,
  val ffprobeExecutable: Boolean = false,
  val version: String? = null,
  val ffprobeVersion: String? = null,
  val ffmpegProbeError: String? = null,
  val ffprobeProbeError: String? = null,
  val mergeCapable: Boolean = false
)

data class BinaryProbeResult(
  val runnable: Boolean,
  val version: String? = null,
  val error: String? = null
)

data class PreflightPythonInput(
  val url: String,
  val cookiesDir: String,
  val cookieProfile: String?,
  val maxFileSizeMb: Int,
  val ffmpegPath: String?,
  val cookieFilePath: String?,
  val forceNoCookie: Boolean = false,
  val mergeCapable: Boolean = true,
  val userAgent: String,
  val debugLogging: Boolean = false
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
  val forceNoCookie: Boolean = false,
  val mergeCapable: Boolean = true,
  val userAgent: String,
  val debugLogging: Boolean = false
)

data class CustomDomainMatch(
  val urlHost: String,
  val matchedDomain: String? = null,
  val profileName: String? = null,
)

class LocalDownloaderModule : Module() {
  private val scope = CoroutineScope(SupervisorJob() + Dispatchers.IO)
  private val tasks = ConcurrentHashMap<String, TaskState>()
  private val cancelFlags = ConcurrentHashMap<String, File>()
  private val ignoredTaskResults = ConcurrentHashMap.newKeySet<String>()
  private val lastErrors = ArrayDeque<String>()
  private val customCookieIndexLock = Any()
  private val tag = "LocalDownloader"
  private val debugLoggingEnabled = BuildConfig.DEBUG

  @Volatile
  private var activeTaskId: String? = null

  @Volatile
  private var activeJob: Job? = null

  @Volatile
  private var cachedFfmpegInfo: FfmpegInfo? = null

  @Volatile
  private var cookieMigrationStatus: String = "not_needed"

  @Volatile
  private var lastCustomDomainMatch: CustomDomainMatch? = null

  override fun definition() = ModuleDefinition {
    Name("LocalDownloader")
    Events("downloadProgress")

    OnCreate {
      debug("Module OnCreate started. supportedAbis=${Build.SUPPORTED_ABIS?.joinToString()}")
      cleanupRuntimeCookieTemp()
      migrateLegacyCookieStoreIfNeeded()
      loadTaskSnapshot()
      val ffmpegInfo = resolveBundledFfmpegPath()
      debug("Initial ffmpeg info: ${summarizeFfmpegInfo(ffmpegInfo)}")
      if (ffmpegInfo.runtimeSource != "native_library") {
        addError(
          "FFMPEG_NATIVE_RUNTIME_UNAVAILABLE: source=${ffmpegInfo.runtimeSource} " +
            "nativeDir=${ffmpegInfo.nativeLibraryDir ?: "n/a"}"
        )
      } else if (!ffmpegInfo.exists) {
        addError("FFMPEG_MISSING: bundled ffmpeg binary not found for device ABI")
      } else if (!ffmpegInfo.ffprobeExists) {
        addError("FFPROBE_MISSING: bundled ffprobe binary not found for device ABI")
      } else if (!ffmpegInfo.mergeCapable) {
        addError("MERGE_DEPENDENCY_MISSING: ffmpeg/ffprobe not executable")
      }
      cachedFfmpegInfo = ffmpegInfo
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
      val effectivePlatform = cookiePlatform ?: detectCookiePlatform(url)

      activeTaskId = taskId
      activeJob = scope.launch {
        var runtimeCookiePath: String? = null
        runCatching {
          debug("Task[$taskId] START url=$url platform=$effectivePlatform profile=$cookieProfile maxMb=$maxFileSizeMb")
          updateStatus(taskId, "STARTED", null, null, null, null, null)
          emitProgress(taskId, "STARTED", "starting", "Preflight")

          runtimeCookiePath = prepareRuntimeCookiePath(taskId, url, cookieProfile, effectivePlatform)
          var effectiveCookiePath = runtimeCookiePath
          debug("Task[$taskId] runtimeCookiePath=${runtimeCookiePath ?: "none"}")

          val ffmpegInfo = getOrResolveFfmpegInfo(forceRefresh = true)
          debug("Task[$taskId] ffmpeg info before preflight: ${summarizeFfmpegInfo(ffmpegInfo)}")
          var preflightResult = callPythonPreflight(
            PreflightPythonInput(
              url = url,
              cookiesDir = cookiesDir.absolutePath,
              cookieProfile = cookieProfile,
              maxFileSizeMb = maxFileSizeMb,
              ffmpegPath = ffmpegInfo.path ?: ffmpegInfo.location,
              cookieFilePath = effectiveCookiePath,
              forceNoCookie = false,
              mergeCapable = ffmpegInfo.mergeCapable,
              userAgent = DEFAULT_HTTP_USER_AGENT,
              debugLogging = debugLoggingEnabled,
            )
          )
          debug("Task[$taskId] preflight result=$preflightResult")

          if (!preflightResult.optBoolean("success", false) && shouldRetryWithoutCookies(preflightResult, effectiveCookiePath, effectivePlatform)) {
            addError("COOKIE_RETRY_PREFLIGHT: task=$taskId")
            cleanupRuntimeCookieTemp(taskId)
            effectiveCookiePath = null
            preflightResult = callPythonPreflight(
              PreflightPythonInput(
                url = url,
                cookiesDir = disabledCookiesDir.absolutePath,
                cookieProfile = null,
                maxFileSizeMb = maxFileSizeMb,
                ffmpegPath = ffmpegInfo.path ?: ffmpegInfo.location,
                cookieFilePath = null,
                forceNoCookie = true,
                mergeCapable = ffmpegInfo.mergeCapable,
                userAgent = DEFAULT_HTTP_USER_AGENT,
                debugLogging = debugLoggingEnabled,
              )
            )
            debug("Task[$taskId] preflight retry(no-cookie) result=$preflightResult")
          }
          preflightResult = normalizeRuntimeError(preflightResult, ffmpegInfo)

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
            debug("Task[$taskId] preflight failed code=$code message=$msg")

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
            debug("Task[$taskId] storage check failed: $msg")
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
              ffmpegPath = ffmpegInfo.path ?: ffmpegInfo.location,
              cookieFilePath = effectiveCookiePath,
              forceNoCookie = false,
              mergeCapable = ffmpegInfo.mergeCapable,
              userAgent = DEFAULT_HTTP_USER_AGENT,
              debugLogging = debugLoggingEnabled,
            )
          )
          debug("Task[$taskId] download result=$result")

          if (!result.optBoolean("success", false) && shouldRetryWithoutCookies(result, effectiveCookiePath, effectivePlatform)) {
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
                ffmpegPath = ffmpegInfo.path ?: ffmpegInfo.location,
                cookieFilePath = null,
                forceNoCookie = true,
                mergeCapable = ffmpegInfo.mergeCapable,
                userAgent = DEFAULT_HTTP_USER_AGENT,
                debugLogging = debugLoggingEnabled,
              )
            )
            debug("Task[$taskId] download retry(no-cookie) result=$result")
          }
          result = normalizeRuntimeError(result, ffmpegInfo)

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
            val timestampNormalized = if (result.has("timestamp_normalized")) {
              result.optBoolean("timestamp_normalized")
            } else {
              null
            }
            val warningCode = result.optString("warning_code").ifBlank { null }
            debug("Task[$taskId] success file=$filePath sizeMb=$sizeMb timestampNormalized=$timestampNormalized warning=$warningCode")

            updateStatus(taskId, "SUCCESS", filename, filePath, sizeMb, null, null)
            tasks[taskId]?.timestampNormalized = timestampNormalized
            tasks[taskId]?.warningCode = warningCode
            persistTaskSnapshot()
            if (warningCode != null) {
              addError("$warningCode: task=$taskId")
            }
            emitProgress(taskId, "SUCCESS", "completed", filename ?: "Download completed")
          } else {
            val code = result.optString("code", "INTERNAL_ERROR")
            val message = result.optString("message", "Download failed")
            debug("Task[$taskId] download failed code=$code message=$message")

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
          debug("Task[$taskId] exception code=$code message=$message")
          updateStatus(taskId, "FAILURE", null, null, null, code, message)
          emitProgress(taskId, "FAILURE", "error", message)
          addError("$code: $message")
        }

        debug("Task[$taskId] cleanup runtime cookie + cancel flag")
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

    AsyncFunction("deleteCookieProfile") { input: Map<String, String> ->
      val platform = input["platform"]?.trim().orEmpty().lowercase()
      val profileName = sanitizeProfileName(input["profileName"].orEmpty())

      if (!SUPPORTED_PLATFORMS.contains(platform) || profileName.isBlank()) {
        return@AsyncFunction mapOf("success" to false)
      }

      val platformDir = secureCookiePlatformDir(platform, create = false)
      if (!platformDir.exists()) {
        return@AsyncFunction mapOf("success" to false)
      }

      val targetFile = File(platformDir, "$profileName.enc")
      if (!targetFile.exists() || !targetFile.isFile) {
        return@AsyncFunction mapOf("success" to false)
      }

      if (!targetFile.delete()) {
        return@AsyncFunction mapOf("success" to false)
      }

      val remaining = platformDir.listFiles()
        ?.filter { it.isFile && it.extension == "enc" }
        ?.sortedByDescending { it.lastModified() }
        ?: emptyList()

      if (remaining.isEmpty()) {
        clearDefaultProfile(platformDir)
        return@AsyncFunction mapOf("success" to true)
      }

      val defaultProfile = readDefaultProfile(platformDir)
      if (defaultProfile == null || defaultProfile == profileName) {
        writeDefaultProfile(platformDir, remaining.first().nameWithoutExtension)
      }

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

    AsyncFunction("importCustomCookie") { input: Map<String, Any?> ->
      val uri = (input["uri"] as? String)?.trim().orEmpty()
      val profileNameRaw = (input["profileName"] as? String)?.trim()
      val manualDomainRaw = (input["domain"] as? String)?.trim()

      if (uri.isBlank()) {
        throw IllegalArgumentException("INVALID_URL")
      }

      val manualDomain = if (manualDomainRaw.isNullOrBlank()) {
        null
      } else {
        canonicalizeDomain(manualDomainRaw) ?: throw IllegalArgumentException("INVALID_CUSTOM_DOMAIN")
      }

      val sourceUri = Uri.parse(uri)
      val resolver = requireNotNull(appContext.reactContext).contentResolver
      val rawContent = resolver.openInputStream(sourceUri)?.bufferedReader(Charsets.UTF_8)?.use { it.readText() }
        ?: throw IllegalArgumentException("Could not open cookie file")
      val normalizedCookieText = normalizeCookieContent(rawContent)

      val detectedDomains = extractDomainsFromCookieText(normalizedCookieText).toMutableSet()
      if (manualDomain != null) {
        detectedDomains.add(manualDomain)
      }
      if (detectedDomains.isEmpty()) {
        throw IllegalStateException("CUSTOM_COOKIE_NO_DOMAIN_DETECTED")
      }

      val profileNameSeed = if (profileNameRaw.isNullOrBlank()) {
        "custom_${System.currentTimeMillis()}"
      } else {
        profileNameRaw
      }
      val profileId = UUID.randomUUID().toString()
      val payload = normalizedCookieText.toByteArray(Charsets.UTF_8)
      val boundDomains = detectedDomains.toList().sorted()

      val finalProfileName = synchronized(customCookieIndexLock) {
        val index = readCustomCookieIndex()
        val uniqueProfileName = ensureUniqueCustomProfileName(index, boundDomains, sanitizeProfileName(profileNameSeed))
        val profileFile = customProfileFile(profileId)
        writeEncryptedCookieFile(profileFile, payload)

        val now = System.currentTimeMillis()
        val profilesObj = index.getJSONObject("profiles")
        profilesObj.put(
          profileId,
          JSONObject().apply {
            put("profileName", uniqueProfileName)
            put("createdAt", now)
            put("updatedAt", now)
            put("domains", JSONArray(boundDomains))
          }
        )

        val domainsObj = index.getJSONObject("domains")
        boundDomains.forEach { domain ->
          val domainEntry = domainsObj.optJSONObject(domain) ?: JSONObject()
          val profileIds = domainEntry.optJSONArray("profileIds") ?: JSONArray()
          if (!jsonArrayContains(profileIds, profileId)) {
            profileIds.put(profileId)
          }
          domainEntry.put("profileIds", profileIds)
          domainsObj.put(domain, domainEntry)

          val domainDir = customDomainDir(domain, create = true)
          if (readDefaultProfile(domainDir) == null) {
            writeDefaultProfile(domainDir, uniqueProfileName)
          }
        }

        writeCustomCookieIndex(index)
        uniqueProfileName
      }

      mapOf(
        "profileId" to profileId,
        "profileName" to finalProfileName,
        "detectedDomains" to detectedDomains.toList().sorted(),
        "boundDomains" to boundDomains,
      )
    }

    AsyncFunction("listCustomDomains") {
      synchronized(customCookieIndexLock) {
        val index = readCustomCookieIndex()
        val domainsObj = index.getJSONObject("domains")
        val profilesObj = index.getJSONObject("profiles")
        val result = mutableListOf<Map<String, Any?>>()
        val domainKeys = domainsObj.keys()
        while (domainKeys.hasNext()) {
          val domain = domainKeys.next()
          val domainEntry = domainsObj.optJSONObject(domain) ?: JSONObject()
          val ids = jsonArrayToStringList(domainEntry.optJSONArray("profileIds"))
          val validProfileIds = ids.filter { profilesObj.has(it) }
          val defaultProfileName = readDefaultProfile(customDomainDir(domain, create = false))
            ?.takeIf { defaultName -> validProfileIds.any { id -> profilesObj.optJSONObject(id)?.optString("profileName") == defaultName } }

          result.add(
            mapOf(
              "domain" to domain,
              "profileCount" to validProfileIds.size,
              "defaultProfileName" to defaultProfileName
            )
          )
        }

        result.sortedBy { it["domain"] as String }
      }
    }

    AsyncFunction("listCustomDomainProfiles") { domain: String ->
      val normalizedDomain = canonicalizeDomain(domain) ?: return@AsyncFunction emptyList<Map<String, Any?>>()
      synchronized(customCookieIndexLock) {
        val index = readCustomCookieIndex()
        val domainsObj = index.getJSONObject("domains")
        val profilesObj = index.getJSONObject("profiles")
        val domainEntry = domainsObj.optJSONObject(normalizedDomain) ?: return@synchronized emptyList<Map<String, Any?>>()
        val profileIds = jsonArrayToStringList(domainEntry.optJSONArray("profileIds"))

        profileIds.mapNotNull { profileId ->
          val profile = profilesObj.optJSONObject(profileId) ?: return@mapNotNull null
          val profileName = sanitizeProfileName(profile.optString("profileName"))
          if (profileName.isBlank()) {
            return@mapNotNull null
          }
          val lastModified = profile.optLong("updatedAt", 0L).takeIf { it > 0L } ?: customProfileFile(profileId).lastModified()
          mapOf(
            "profileName" to profileName,
            "profileId" to profileId,
            "lastModified" to lastModified,
          )
        }.sortedByDescending { it["lastModified"] as Long }
      }
    }

    AsyncFunction("setCustomDomainDefault") { input: Map<String, String> ->
      val domain = canonicalizeDomain(input["domain"].orEmpty())
      val profileName = sanitizeProfileName(input["profileName"].orEmpty())
      if (domain == null || profileName.isBlank()) {
        return@AsyncFunction mapOf("success" to false)
      }

      synchronized(customCookieIndexLock) {
        val index = readCustomCookieIndex()
        val domainsObj = index.getJSONObject("domains")
        val profilesObj = index.getJSONObject("profiles")
        val domainEntry = domainsObj.optJSONObject(domain) ?: return@synchronized mapOf("success" to false)
        val profileIds = jsonArrayToStringList(domainEntry.optJSONArray("profileIds"))

        val exists = profileIds.any { profileId ->
          profilesObj.optJSONObject(profileId)?.optString("profileName") == profileName
        }
        if (!exists) {
          return@synchronized mapOf("success" to false)
        }

        writeDefaultProfile(customDomainDir(domain, create = true), profileName)
        mapOf("success" to true)
      }
    }

    AsyncFunction("deleteCustomDomainProfile") { input: Map<String, String> ->
      val domain = canonicalizeDomain(input["domain"].orEmpty())
      val profileName = sanitizeProfileName(input["profileName"].orEmpty())
      if (domain == null || profileName.isBlank()) {
        return@AsyncFunction mapOf("success" to false)
      }

      synchronized(customCookieIndexLock) {
        val index = readCustomCookieIndex()
        val domainsObj = index.getJSONObject("domains")
        val profilesObj = index.getJSONObject("profiles")
        val domainEntry = domainsObj.optJSONObject(domain) ?: return@synchronized mapOf("success" to false)
        val domainProfileIds = jsonArrayToStringList(domainEntry.optJSONArray("profileIds"))
        val targetProfileId = domainProfileIds.firstOrNull { profileId ->
          profilesObj.optJSONObject(profileId)?.optString("profileName") == profileName
        } ?: return@synchronized mapOf("success" to false)

        val targetProfileObj = profilesObj.optJSONObject(targetProfileId)
        val boundDomains = jsonArrayToStringList(targetProfileObj?.optJSONArray("domains"))

        boundDomains.forEach { boundDomain ->
          val boundEntry = domainsObj.optJSONObject(boundDomain) ?: return@forEach
          val remainingIds = jsonArrayToStringList(boundEntry.optJSONArray("profileIds"))
            .filter { it != targetProfileId }
          if (remainingIds.isEmpty()) {
            domainsObj.remove(boundDomain)
            customDomainDir(boundDomain, create = false).deleteRecursively()
          } else {
            boundEntry.put("profileIds", JSONArray(remainingIds))
            domainsObj.put(boundDomain, boundEntry)
            ensureCustomDomainDefault(boundDomain, index)
          }
        }

        profilesObj.remove(targetProfileId)
        runCatching { customProfileFile(targetProfileId).delete() }
        writeCustomCookieIndex(index)
        mapOf("success" to true)
      }
    }

    AsyncFunction("saveToMediaStore") { input: Map<String, Any?> ->
      val filePath = (input["filePath"] as? String)?.trim().orEmpty()
      val filename = (input["filename"] as? String)?.trim().orEmpty()
      if (filePath.isBlank() || filename.isBlank()) {
        throw IllegalArgumentException("FILE_NOT_FOUND")
      }

      val sourceFile = File(filePath)
      if (!sourceFile.exists() || !sourceFile.isFile) {
        throw IllegalArgumentException("FILE_NOT_FOUND")
      }

      val mimeType = (input["mimeType"] as? String)?.trim()?.takeIf { it.isNotBlank() }
        ?: guessMimeType(filename)
      val dateTakenMs = (input["dateTakenMs"] as? Number)?.toLong() ?: System.currentTimeMillis()
      val isVideo = mimeType.startsWith("video/")
      val dateTakenColumn = if (isVideo) {
        MediaStore.Video.VideoColumns.DATE_TAKEN
      } else {
        MediaStore.Images.ImageColumns.DATE_TAKEN
      }
      val nowSeconds = System.currentTimeMillis() / 1000L

      val contentValues = ContentValues().apply {
        put(MediaStore.MediaColumns.DISPLAY_NAME, filename)
        put(MediaStore.MediaColumns.MIME_TYPE, mimeType)
        put(MediaStore.MediaColumns.DATE_ADDED, nowSeconds)
        put(MediaStore.MediaColumns.DATE_MODIFIED, nowSeconds)
        put(dateTakenColumn, dateTakenMs)
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
          put(
            MediaStore.MediaColumns.RELATIVE_PATH,
            if (isVideo) Environment.DIRECTORY_DCIM else Environment.DIRECTORY_PICTURES
          )
          put(MediaStore.MediaColumns.IS_PENDING, 1)
        }
      }

      val resolver = requireNotNull(appContext.reactContext).contentResolver
      val collection = if (isVideo) {
        MediaStore.Video.Media.EXTERNAL_CONTENT_URI
      } else {
        MediaStore.Images.Media.EXTERNAL_CONTENT_URI
      }
      val uri = resolver.insert(collection, contentValues) ?: throw IOException("MEDIASTORE_INSERT_FAILED")

      runCatching {
        resolver.openOutputStream(uri)?.use { output ->
          sourceFile.inputStream().use { input ->
            input.copyTo(output)
          }
        } ?: throw IOException("MEDIASTORE_OUTPUT_STREAM_FAILED")
      }.onFailure { error ->
        runCatching { resolver.delete(uri, null, null) }
        throw error
      }

      if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
        val finalizeValues = ContentValues().apply {
          put(MediaStore.MediaColumns.IS_PENDING, 0)
          put(MediaStore.MediaColumns.DATE_MODIFIED, System.currentTimeMillis() / 1000L)
          put(dateTakenColumn, dateTakenMs)
        }
        resolver.update(uri, finalizeValues, null, null)
      }

      mapOf(
        "uri" to uri.toString(),
        "assetId" to uri.lastPathSegment
      )
    }

    AsyncFunction("getDiagnostics") {
      val ffmpegInfo = getOrResolveFfmpegInfo(forceRefresh = true)

      var ytDlpVersion = "unknown"
      var ytDlpAvailable = false
      var pythonReady = Python.isStarted()
      var normalizedUrlLast: String? = null
      var attemptTraceCount = 0
      var attemptTrace: List<Map<String, Any?>> = emptyList()
      var lastExtractorKey: String? = null
      var lastRawYtDlpError: String? = null
      var platformStrategyLast: String? = null
      var ytDlpVersionAgeDays: Int? = null
      var lastCookieCheck: Map<String, Any?>? = null
      var impersonationRuntimeAvailable: Boolean? = null
      var impersonationEnabled: Boolean = false
      var impersonationBackend: String = "none"
      var impersonationRequiredByExtractorLast: String? = null
      var impersonationAttemptedTargetsLast: List<String> = emptyList()
      var impersonationResolvedTargetLast: String? = null
      var impersonationWheelVersion: String? = null
      var impersonationBuildAbiCoverage: List<String> = emptyList()
      var impersonationBootstrapError: String? = null

      runCatching {
        ensurePythonReady()
        pythonReady = true
        val py = Python.getInstance()
        ytDlpVersion = py.getModule("yt_dlp.version").get("__version__").toString()
        ytDlpAvailable = true

        val runtimeDiagRaw = py.getModule("local_downloader").callAttr("get_runtime_diagnostics").toString()
        val runtimeDiag = JSONObject(runtimeDiagRaw)
        normalizedUrlLast = runtimeDiag.optString("normalizedUrlLast").takeIf { it.isNotBlank() && it != "null" }
        attemptTraceCount = runtimeDiag.optInt("attemptTraceCount", 0)
        lastExtractorKey = runtimeDiag.optString("lastExtractorKey").takeIf { it.isNotBlank() && it != "null" }
        lastRawYtDlpError = runtimeDiag.optString("lastRawYtDlpError").takeIf { it.isNotBlank() && it != "null" }
        platformStrategyLast = runtimeDiag.optString("platformStrategyLast").takeIf { it.isNotBlank() && it != "null" }
        ytDlpVersionAgeDays = runtimeDiag.opt("ytDlpVersionAgeDays")?.toString()?.toIntOrNull()
        if (runtimeDiag.has("impersonationRuntimeAvailable") && !runtimeDiag.isNull("impersonationRuntimeAvailable")) {
          impersonationRuntimeAvailable = runtimeDiag.optBoolean("impersonationRuntimeAvailable")
        }
        if (runtimeDiag.has("impersonationEnabled") && !runtimeDiag.isNull("impersonationEnabled")) {
          impersonationEnabled = runtimeDiag.optBoolean("impersonationEnabled")
        }
        impersonationBackend = runtimeDiag.optString("impersonationBackend", "none").ifBlank { "none" }
        impersonationRequiredByExtractorLast = runtimeDiag.optString("impersonationRequiredByExtractorLast")
          .takeIf { it.isNotBlank() && it != "null" }
        impersonationResolvedTargetLast = runtimeDiag.optString("impersonationResolvedTargetLast")
          .takeIf { it.isNotBlank() && it != "null" }
        impersonationWheelVersion = runtimeDiag.optString("impersonationWheelVersion")
          .takeIf { it.isNotBlank() && it != "null" }
        impersonationBootstrapError = runtimeDiag.optString("impersonationBootstrapError")
          .takeIf { it.isNotBlank() && it != "null" }

        val attemptedTargets = runtimeDiag.optJSONArray("impersonationAttemptedTargetsLast")
        impersonationAttemptedTargetsLast = if (attemptedTargets == null) {
          emptyList()
        } else {
          (0 until attemptedTargets.length()).mapNotNull { i ->
            attemptedTargets.optString(i).takeIf { v -> v.isNotBlank() }
          }
        }
        val abiCoverage = runtimeDiag.optJSONArray("impersonationBuildAbiCoverage")
        impersonationBuildAbiCoverage = if (abiCoverage == null) {
          emptyList()
        } else {
          (0 until abiCoverage.length()).mapNotNull { i ->
            abiCoverage.optString(i).takeIf { v -> v.isNotBlank() }
          }
        }

        val traceArray = runtimeDiag.optJSONArray("attemptTrace")
        attemptTrace = if (traceArray == null) {
          emptyList()
        } else {
          (0 until traceArray.length()).mapNotNull { idx ->
            val item = traceArray.optJSONObject(idx) ?: return@mapNotNull null
            mapOf(
              "timeMs" to item.opt("timeMs"),
              "phase" to item.optString("phase", ""),
              "attemptId" to item.optString("attemptId", ""),
              "strategy" to item.optString("strategy", ""),
              "status" to item.optString("status", ""),
              "platform" to item.optString("platform", ""),
              "cookieUsed" to item.opt("cookieUsed"),
              "retryIndex" to item.opt("retryIndex"),
              "extractorKey" to item.optString("extractorKey", ""),
              "errorCode" to item.optString("errorCode", ""),
              "errorMessage" to item.optString("errorMessage", ""),
              "impersonate" to item.optString("impersonate", ""),
            )
          }
        }

        val cookieCheck = runtimeDiag.optJSONObject("lastCookieCheck")
        lastCookieCheck = cookieCheck?.let {
          mapOf(
            "platform" to it.optString("platform", ""),
            "hasCookieFile" to it.optBoolean("hasCookieFile", false),
            "domainCoverage" to (it.optJSONArray("domainCoverage")?.let { arr ->
              (0 until arr.length()).mapNotNull { i -> arr.optString(i).takeIf { value -> value.isNotBlank() } }
            } ?: emptyList<String>()),
            "unexpiredCount" to it.optInt("unexpiredCount", 0),
          )
        }
      }.onFailure {
        addError("YT_DLP_IMPORT_ERROR: ${it.message}")
      }

      mapOf(
        "ytDlpVersion" to ytDlpVersion,
        "ytDlpAvailable" to ytDlpAvailable,
        "pythonReady" to pythonReady,
        "ffmpegPath" to ffmpegInfo.path,
        "ffprobePath" to ffmpegInfo.ffprobePath,
        "ffmpegAbi" to ffmpegInfo.abi,
        "ffmpegRuntimeSource" to ffmpegInfo.runtimeSource,
        "nativeLibraryDir" to ffmpegInfo.nativeLibraryDir,
        "nativeLibraryEntries" to ffmpegInfo.nativeLibraryEntries,
        "ffmpegVersion" to ffmpegInfo.version,
        "ffprobeVersion" to ffmpegInfo.ffprobeVersion,
        "ffmpegExists" to ffmpegInfo.exists,
        "ffprobeExists" to ffmpegInfo.ffprobeExists,
        "ffmpegExecutable" to ffmpegInfo.executable,
        "ffprobeExecutable" to ffmpegInfo.ffprobeExecutable,
        "ffmpegProbeError" to ffmpegInfo.ffmpegProbeError,
        "ffprobeProbeError" to ffmpegInfo.ffprobeProbeError,
        "mergeCapable" to ffmpegInfo.mergeCapable,
        "activeHttpUserAgent" to DEFAULT_HTTP_USER_AGENT,
        "secureCookieStoreEnabled" to isSecureCookieStoreEnabled(),
        "cookieEncryptionVersion" to COOKIE_STORE_VERSION,
        "cookieProfilesEncryptedCount" to countSecureCookieProfiles(),
        "customDomainsCount" to countCustomDomains(),
        "customProfilesCount" to countCustomProfiles(),
        "cookieLegacyPlaintextCount" to countLegacyCookieProfiles(),
        "cookieMigrationStatus" to cookieMigrationStatus,
        "normalizedUrlLast" to normalizedUrlLast,
        "attemptTraceCount" to attemptTraceCount,
        "attemptTrace" to attemptTrace,
        "lastExtractorKey" to lastExtractorKey,
        "lastRawYtDlpError" to lastRawYtDlpError,
        "lastCookieCheck" to lastCookieCheck,
        "ytDlpVersionAgeDays" to ytDlpVersionAgeDays,
        "platformStrategyLast" to platformStrategyLast,
        "impersonationRuntimeAvailable" to impersonationRuntimeAvailable,
        "impersonationEnabled" to impersonationEnabled,
        "impersonationBackend" to impersonationBackend,
        "impersonationRequiredByExtractorLast" to impersonationRequiredByExtractorLast,
        "impersonationAttemptedTargetsLast" to impersonationAttemptedTargetsLast,
        "impersonationResolvedTargetLast" to impersonationResolvedTargetLast,
        "impersonationWheelVersion" to impersonationWheelVersion,
        "impersonationBuildAbiCoverage" to impersonationBuildAbiCoverage,
        "impersonationBootstrapError" to impersonationBootstrapError,
        "customDomainMatchLast" to lastCustomDomainMatch?.let {
          mapOf(
            "urlHost" to it.urlHost,
            "matchedDomain" to it.matchedDomain,
            "profileName" to it.profileName
          )
        },
        "activeTaskId" to activeTaskId,
        "lastErrors" to lastErrors.toList()
      )
    }

    AsyncFunction("runCapabilityCheck") {
      val ffmpegInfo = getOrResolveFfmpegInfo(forceRefresh = true)
      val pythonReady = runCatching {
        ensurePythonReady()
        true
      }.getOrDefault(false)

      mapOf(
        "pythonReady" to pythonReady,
        "ffmpegRuntimeSource" to ffmpegInfo.runtimeSource,
        "ffmpegExists" to ffmpegInfo.exists,
        "ffprobeExists" to ffmpegInfo.ffprobeExists,
        "mergeCapable" to ffmpegInfo.mergeCapable,
        "activeHttpUserAgent" to DEFAULT_HTTP_USER_AGENT
      )
    }

    AsyncFunction("runImpersonationSelfTest") {
      ensurePythonReady()
      val py = Python.getInstance()
      val result = py.getModule("local_downloader").callAttr("run_impersonation_self_test", debugLoggingEnabled)
      val json = JSONObject(result.toString())
      mapOf(
        "success" to json.optBoolean("success", false),
        "code" to json.optString("code", "INTERNAL_ERROR"),
        "message" to json.optString("message").ifBlank { null },
        "impersonation_enabled" to json.optBoolean("impersonation_enabled", false),
        "backend" to json.optString("backend").ifBlank { null },
        "wheel_version" to json.optString("wheel_version").ifBlank { null },
        "build_abi_coverage" to (json.optJSONArray("build_abi_coverage")?.let { arr ->
          (0 until arr.length()).mapNotNull { idx -> arr.optString(idx).takeIf { v -> v.isNotBlank() } }
        } ?: emptyList<String>())
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
    debug(
      "Python preflight call url=${input.url} ffmpegPath=${input.ffmpegPath} " +
        "cookieFile=${input.cookieFilePath ?: "none"} mergeCapable=${input.mergeCapable} forceNoCookie=${input.forceNoCookie}"
    )
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
      input.forceNoCookie,
      input.mergeCapable,
      input.userAgent,
      input.debugLogging
    )
    val json = JSONObject(result.toString())
    debug("Python preflight response code=${json.optString("code")} success=${json.optBoolean("success")} msg=${json.optString("message")}")
    return json
  }

  private fun callPythonDownload(input: DownloadPythonInput): JSONObject {
    ensurePythonReady()
    debug(
      "Python download call url=${input.url} ffmpegPath=${input.ffmpegPath} " +
        "cookieFile=${input.cookieFilePath ?: "none"} mergeCapable=${input.mergeCapable} forceNoCookie=${input.forceNoCookie}"
    )
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
      input.forceNoCookie,
      input.mergeCapable,
      input.userAgent,
      input.debugLogging
    )
    val json = JSONObject(result.toString())
    debug("Python download response code=${json.optString("code")} success=${json.optBoolean("success")} msg=${json.optString("message")}")
    return json
  }

  private fun ensurePythonReady() {
    val context = requireNotNull(appContext.reactContext).applicationContext
    if (!Python.isStarted()) {
      Python.start(AndroidPlatform(context))
      debug("Python runtime started")
    } else {
      debug("Python runtime already started")
    }
  }

  private fun getFreeSpaceMb(directory: File): Double {
    val stat = StatFs(directory.absolutePath)
    return stat.availableBytes.toDouble() / MB_IN_BYTES
  }

  private fun normalizeRuntimeError(result: JSONObject, ffmpegInfo: FfmpegInfo): JSONObject {
    if (result.optBoolean("success", false)) {
      return result
    }

    val code = result.optString("code", "")
    if (code != "MERGE_DEPENDENCY_MISSING" || ffmpegInfo.runtimeSource == "native_library") {
      return result
    }

    val reason = buildString {
      append("Native FFmpeg runtime unavailable")
      if (!ffmpegInfo.nativeLibraryDir.isNullOrBlank()) {
        append(" (nativeLibraryDir=")
        append(ffmpegInfo.nativeLibraryDir)
        append(")")
      }
      if (!ffmpegInfo.ffmpegProbeError.isNullOrBlank()) {
        append(". ffmpeg: ")
        append(ffmpegInfo.ffmpegProbeError)
      }
      if (!ffmpegInfo.ffprobeProbeError.isNullOrBlank()) {
        append(". ffprobe: ")
        append(ffmpegInfo.ffprobeProbeError)
      }
    }

    return JSONObject(result.toString()).apply {
      put("code", "FFMPEG_NATIVE_RUNTIME_UNAVAILABLE")
      put("message", reason)
    }
  }

  private fun guessMimeType(filename: String): String {
    return when (filename.substringAfterLast('.', "").lowercase()) {
      "mp4", "m4v", "mov", "3gp" -> "video/mp4"
      "webm" -> "video/webm"
      "mkv" -> "video/x-matroska"
      "avi" -> "video/x-msvideo"
      "jpg", "jpeg" -> "image/jpeg"
      "png" -> "image/png"
      "gif" -> "image/gif"
      else -> "video/mp4"
    }
  }

  private fun prepareRuntimeCookiePath(
    taskId: String,
    url: String,
    requestedProfile: String?,
    preferredPlatform: String?
  ): String? {
    val builtInPlatform = preferredPlatform ?: detectCookiePlatform(url)
    val selectedFile = if (builtInPlatform != null) {
      lastCustomDomainMatch = null
      val platformFile = selectSecureCookieFile(builtInPlatform, requestedProfile)
      if (requestedProfile != null && platformFile == null) {
        throw IllegalStateException("COOKIE_PROFILE_NOT_FOUND")
      }
      platformFile
    } else {
      selectCustomCookieFileForUrl(url, requestedProfile)
    } ?: return null

    val runtimeDir = runtimeCookieTaskDir(taskId).apply { mkdirs() }
    val runtimeFile = File(runtimeDir, "cookie.txt")
    val plaintext = readEncryptedCookieFile(selectedFile)
    atomicWriteBytes(runtimeFile, plaintext)
    debug("Task[$taskId] prepared runtime cookie file from profile=${selectedFile.nameWithoutExtension} platform=${builtInPlatform ?: "custom"}")
    return runtimeFile.absolutePath
  }

  private fun shouldRetryWithoutCookies(result: JSONObject, usedCookiePath: String?, platform: String?): Boolean {
    if (usedCookiePath.isNullOrBlank()) {
      debug("Retry-without-cookies=false reason=no-cookie")
      return false
    }
    if (platform != null && STRICT_COOKIE_PLATFORMS.contains(platform)) {
      debug("Retry-without-cookies=false reason=strict-platform platform=$platform")
      return false
    }

    val code = result.optString("code", "")
    if (code == "DOWNLOAD_CANCELLED" || code == "FILE_TOO_LARGE") {
      debug("Retry-without-cookies=false reason=terminal-code code=$code")
      return false
    }

    if (code == "COOKIE_STALE_OR_INVALID") {
      debug("Retry-without-cookies=false reason=cookie-invalid")
      return false
    }

    if (code in RETRYABLE_COOKIE_FAILURE_CODES) {
      debug("Retry-without-cookies=true reason=retryable-code code=$code")
      return true
    }

    val message = result.optString("message", "").lowercase()
    val decision = message.contains("cookie") || message.contains("sign in") || message.contains("login")
    debug("Retry-without-cookies=$decision reason=message-match")
    return decision
  }

  private fun detectCookiePlatform(url: String): String? {
    val host = extractCanonicalHostFromUrl(url) ?: return null

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

  private fun selectCustomCookieFileForUrl(url: String, requestedProfile: String?): File? {
    val host = extractCanonicalHostFromUrl(url)
    if (host == null) {
      lastCustomDomainMatch = null
      return null
    }

    return synchronized(customCookieIndexLock) {
      val index = readCustomCookieIndex()
      val domainsObj = index.getJSONObject("domains")
      val profilesObj = index.getJSONObject("profiles")
      var matchedDomain: String? = null
      val keys = domainsObj.keys()
      while (keys.hasNext()) {
        val rawDomain = keys.next()
        val candidate = canonicalizeDomain(rawDomain) ?: continue
        if (host != candidate && !host.endsWith(".$candidate")) {
          continue
        }
        if (matchedDomain == null || candidate.length > (matchedDomain?.length ?: -1)) {
          matchedDomain = candidate
        }
      }

      if (matchedDomain == null) {
        lastCustomDomainMatch = CustomDomainMatch(urlHost = host)
        return@synchronized null
      }

      val selectedProfile = resolveCustomProfileForDomain(
        index = index,
        domain = matchedDomain,
        requestedProfile = requestedProfile
      )

      if (selectedProfile == null) {
        lastCustomDomainMatch = CustomDomainMatch(urlHost = host, matchedDomain = matchedDomain)
        return@synchronized null
      }

      val profileObj = profilesObj.optJSONObject(selectedProfile.first)
      val profileName = sanitizeProfileName(profileObj?.optString("profileName").orEmpty())
      lastCustomDomainMatch = CustomDomainMatch(
        urlHost = host,
        matchedDomain = matchedDomain,
        profileName = profileName
      )
      selectedProfile.second
    }
  }

  private fun resolveCustomProfileForDomain(
    index: JSONObject,
    domain: String,
    requestedProfile: String?
  ): Pair<String, File>? {
    val domainsObj = index.getJSONObject("domains")
    val profilesObj = index.getJSONObject("profiles")
    val domainEntry = domainsObj.optJSONObject(domain) ?: return null
    val profileIds = jsonArrayToStringList(domainEntry.optJSONArray("profileIds"))
    if (profileIds.isEmpty()) {
      return null
    }

    val candidates = profileIds.mapNotNull { profileId ->
      val profileObj = profilesObj.optJSONObject(profileId) ?: return@mapNotNull null
      val profileName = sanitizeProfileName(profileObj.optString("profileName"))
      if (profileName.isBlank()) {
        return@mapNotNull null
      }
      val profileFile = customProfileFile(profileId)
      if (!profileFile.exists()) {
        return@mapNotNull null
      }
      Triple(profileId, profileName, profileObj.optLong("updatedAt", 0L))
    }
    if (candidates.isEmpty()) {
      return null
    }

    if (!requestedProfile.isNullOrBlank()) {
      val normalizedRequested = sanitizeProfileName(requestedProfile)
      val matched = candidates.firstOrNull { it.second == normalizedRequested }
        ?: throw IllegalStateException("CUSTOM_COOKIE_PROFILE_NOT_FOUND")
      return matched.first to customProfileFile(matched.first)
    }

    val defaultProfileName = readDefaultProfile(customDomainDir(domain, create = false))
    val defaultCandidate = defaultProfileName?.let { defaultName ->
      candidates.firstOrNull { it.second == defaultName }
    }
    val chosen = defaultCandidate ?: candidates.maxByOrNull { it.third }
    return chosen?.let { it.first to customProfileFile(it.first) }
  }

  private fun secureCookiesRoot(create: Boolean): File {
    val root = File(requireNotNull(appContext.reactContext).filesDir, "$SECURE_COOKIES_DIRNAME/$COOKIE_STORE_VERSION")
    if (create) {
      root.mkdirs()
    }
    return root
  }

  private fun customCookiesRoot(create: Boolean): File {
    val root = File(secureCookiesRoot(create = create), CUSTOM_COOKIES_DIRNAME)
    if (create) {
      root.mkdirs()
    }
    return root
  }

  private fun customProfilesDir(create: Boolean): File {
    val dir = File(customCookiesRoot(create = create), CUSTOM_PROFILES_DIRNAME)
    if (create) {
      dir.mkdirs()
    }
    return dir
  }

  private fun customDomainsRoot(create: Boolean): File {
    val dir = File(customCookiesRoot(create = create), CUSTOM_DOMAINS_DIRNAME)
    if (create) {
      dir.mkdirs()
    }
    return dir
  }

  private fun customDomainDir(domain: String, create: Boolean): File {
    val canonical = canonicalizeDomain(domain) ?: domain
    val dir = File(customDomainsRoot(create = create), canonical)
    if (create) {
      dir.mkdirs()
    }
    return dir
  }

  private fun customProfileFile(profileId: String): File {
    return File(customProfilesDir(create = true), "$profileId.enc")
  }

  private fun customCookieIndexFile(createParent: Boolean): File {
    val root = customCookiesRoot(create = createParent)
    return File(root, CUSTOM_INDEX_FILENAME)
  }

  private fun readCustomCookieIndex(): JSONObject {
    val file = customCookieIndexFile(createParent = true)
    val emptyIndex = JSONObject().apply {
      put("profiles", JSONObject())
      put("domains", JSONObject())
    }
    if (!file.exists()) {
      writeCustomCookieIndex(emptyIndex)
      return emptyIndex
    }

    return runCatching { JSONObject(file.readText(Charsets.UTF_8)) }
      .map { parsed ->
        if (!parsed.has("profiles") || parsed.optJSONObject("profiles") == null) {
          parsed.put("profiles", JSONObject())
        }
        if (!parsed.has("domains") || parsed.optJSONObject("domains") == null) {
          parsed.put("domains", JSONObject())
        }
        parsed
      }
      .getOrElse {
        addError("CUSTOM_COOKIE_INDEX_READ_FAILED: ${it.message}")
        emptyIndex
      }
  }

  private fun writeCustomCookieIndex(index: JSONObject) {
    val file = customCookieIndexFile(createParent = true)
    atomicWriteBytes(file, index.toString().toByteArray(Charsets.UTF_8))
  }

  private fun ensureUniqueCustomProfileName(index: JSONObject, domains: List<String>, baseName: String): String {
    val profilesObj = index.getJSONObject("profiles")
    val domainsObj = index.getJSONObject("domains")
    var candidate = baseName
    var suffix = 2
    while (true) {
      val conflict = domains.any { domain ->
        val domainEntry = domainsObj.optJSONObject(domain) ?: return@any false
        val ids = jsonArrayToStringList(domainEntry.optJSONArray("profileIds"))
        ids.any { profileId ->
          sanitizeProfileName(profilesObj.optJSONObject(profileId)?.optString("profileName").orEmpty()) == candidate
        }
      }
      if (!conflict) {
        return candidate
      }
      candidate = "${baseName}_${suffix++}"
    }
  }

  private fun ensureCustomDomainDefault(domain: String, index: JSONObject) {
    val canonicalDomain = canonicalizeDomain(domain) ?: return
    val currentDefault = readDefaultProfile(customDomainDir(canonicalDomain, create = true))
    val domainsObj = index.getJSONObject("domains")
    val profilesObj = index.getJSONObject("profiles")
    val domainEntry = domainsObj.optJSONObject(canonicalDomain)
    val candidates = jsonArrayToStringList(domainEntry?.optJSONArray("profileIds"))
      .mapNotNull { profileId ->
        val profileObj = profilesObj.optJSONObject(profileId) ?: return@mapNotNull null
        val name = sanitizeProfileName(profileObj.optString("profileName"))
        val updatedAt = profileObj.optLong("updatedAt", 0L)
        if (name.isBlank()) null else name to updatedAt
      }
    if (candidates.isEmpty()) {
      customDomainDir(canonicalDomain, create = false).deleteRecursively()
      return
    }
    if (currentDefault != null && candidates.any { it.first == currentDefault }) {
      return
    }
    val nextDefault = candidates.maxByOrNull { it.second }?.first ?: return
    writeDefaultProfile(customDomainDir(canonicalDomain, create = true), nextDefault)
  }

  private fun jsonArrayToStringList(array: JSONArray?): List<String> {
    if (array == null) {
      return emptyList()
    }
    val result = mutableListOf<String>()
    for (i in 0 until array.length()) {
      val value = array.optString(i).trim()
      if (value.isNotBlank()) {
        result.add(value)
      }
    }
    return result
  }

  private fun jsonArrayContains(array: JSONArray, value: String): Boolean {
    for (i in 0 until array.length()) {
      if (array.optString(i) == value) {
        return true
      }
    }
    return false
  }

  private fun extractCanonicalHostFromUrl(url: String): String? {
    val trimmed = url.trim()
    if (trimmed.isBlank()) {
      return null
    }

    val candidates = if (trimmed.contains("://")) {
      listOf(trimmed)
    } else {
      listOf(trimmed, "https://$trimmed")
    }

    val rawHost = candidates.asSequence()
      .mapNotNull { candidate ->
        runCatching { URI(candidate).host?.lowercase() }.getOrNull()
      }
      .firstOrNull()
      ?: return null

    return canonicalizeDomain(rawHost)
  }

  private fun canonicalizeDomain(value: String): String? {
    val trimmed = value.trim().lowercase().removePrefix(".")
    if (trimmed.isBlank()) {
      return null
    }
    if (trimmed.contains("://") || trimmed.contains('/') || trimmed.contains('?') || trimmed.contains('#')) {
      return null
    }

    val host = runCatching {
      URI("https://$trimmed").host?.lowercase()
    }.getOrNull() ?: return null
    val normalized = host.removePrefix("www.").trim('.')
    if (normalized.isBlank() || normalized.contains("..")) {
      return null
    }
    if (!normalized.matches(Regex("^[a-z0-9.-]+$"))) {
      return null
    }
    return normalized
  }

  private fun extractDomainsFromCookieText(cookieText: String): Set<String> {
    val domains = mutableSetOf<String>()
    cookieText.lineSequence().forEach { line ->
      val trimmed = line.trim()
      if (trimmed.isBlank() || trimmed.startsWith("#")) {
        return@forEach
      }
      val columns = line.split('\t')
      if (columns.size < 7) {
        return@forEach
      }
      canonicalizeDomain(columns[0])?.let { domains.add(it) }
    }
    return domains
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

    val builtInCount = SUPPORTED_PLATFORMS.sumOf { platform ->
      File(root, platform).listFiles()?.count { it.isFile && it.extension == "enc" } ?: 0
    }
    return builtInCount + countCustomProfiles()
  }

  private fun countCustomProfiles(): Int {
    val dir = customProfilesDir(create = false)
    if (!dir.exists()) {
      return 0
    }
    return dir.listFiles()?.count { it.isFile && it.extension == "enc" } ?: 0
  }

  private fun countCustomDomains(): Int {
    synchronized(customCookieIndexLock) {
      val index = readCustomCookieIndex()
      return index.getJSONObject("domains").length()
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
      "INVALID_CUSTOM_DOMAIN",
      "CUSTOM_COOKIE_NO_DOMAIN_DETECTED",
      "CUSTOM_COOKIE_DOMAIN_NOT_FOUND",
      "CUSTOM_COOKIE_PROFILE_NOT_FOUND",
      "REDDIT_COOKIE_REQUIRED",
      "FFMPEG_NATIVE_RUNTIME_UNAVAILABLE",
      "FFMPEG_MISSING",
      "FFPROBE_MISSING",
      "MERGE_DEPENDENCY_MISSING",
      "SITE_BLOCKED_403",
      "COOKIE_STALE_OR_INVALID",
      "REDDIT_SHARE_URL_RESOLUTION_FAILED",
      "REDDIT_EXTRACTOR_ROUTE_FAILED",
      "TIKTOK_API_STATUS_ZERO",
      "TIKTOK_EXTRACTOR_UNSTABLE",
      "IMPERSONATION_BOOTSTRAP_FAILED",
      "IMPERSONATION_TARGET_REQUIRED_UNAVAILABLE",
      "IMPERSONATION_DEPENDENCY_MISSING",
      "IMPERSONATION_RUNTIME_UNAVAILABLE",
      "COOKIE_DOMAIN_MISMATCH",
      "COOKIE_EMPTY_OR_EXPIRED",
      "TIMESTAMP_POSTPROCESS_FAILED",
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

  private fun getOrResolveFfmpegInfo(forceRefresh: Boolean = false): FfmpegInfo {
    if (!forceRefresh) {
      val cached = cachedFfmpegInfo
      if (cached != null) {
        debug("Using cached ffmpeg info: ${summarizeFfmpegInfo(cached)}")
        return cached
      }
    }

    val resolved = resolveBundledFfmpegPath()
    debug("Resolved ffmpeg info: ${summarizeFfmpegInfo(resolved)}")
    cachedFfmpegInfo = resolved
    return resolved
  }

  private fun resolveBundledFfmpegPath(): FfmpegInfo {
    val context = requireNotNull(appContext.reactContext)
    debug("Resolving ffmpeg runtime (native libs first)")
    val nativeSnapshot = readNativeLibrarySnapshot(context)
    resolveNativeLibraryFfmpeg(nativeSnapshot)?.let { nativeInfo ->
      debug("Using native lib dir ffmpeg runtime: ${summarizeFfmpegInfo(nativeInfo)}")
      return nativeInfo
    }

    val fallback = inspectAssetRuntimeFallback(context, nativeSnapshot)
    addError(
      "FFMPEG_NATIVE_RUNTIME_UNAVAILABLE: nativeDir=${fallback.nativeLibraryDir ?: "n/a"} " +
        "entries=${fallback.nativeLibraryEntries.joinToString()} " +
        "ffmpeg=${fallback.ffmpegProbeError ?: "n/a"} ffprobe=${fallback.ffprobeProbeError ?: "n/a"}"
    )
    return fallback
  }

  private fun readNativeLibrarySnapshot(context: android.content.Context): Pair<String?, List<String>> {
    val nativeDirPath = context.applicationInfo.nativeLibraryDir
    if (nativeDirPath.isNullOrBlank()) {
      return null to emptyList()
    }

    val nativeDir = File(nativeDirPath)
    if (!nativeDir.exists() || !nativeDir.isDirectory) {
      return nativeDirPath to emptyList()
    }

    val entries = nativeDir.listFiles()
      ?.map { it.name }
      ?.sorted()
      ?: emptyList()
    return nativeDirPath to entries
  }

  private fun resolveNativeLibraryFfmpeg(nativeSnapshot: Pair<String?, List<String>>): FfmpegInfo? {
    val nativeDirPath = nativeSnapshot.first ?: return null
    val nativeDir = File(nativeDirPath)
    if (!nativeDir.exists() || !nativeDir.isDirectory) {
      debug("Native library dir unavailable: $nativeDirPath")
      return null
    }
    debug("Checking native library dir for ffmpeg: ${nativeDir.absolutePath}")
    debug("Native library dir entries: ${nativeSnapshot.second.joinToString()}")

    val binaryNamePairs = listOf(
      "ffmpeg" to "ffprobe",
      "libffmpeg.so" to "libffprobe.so",
    )

    for ((ffmpegName, ffprobeName) in binaryNamePairs) {
      val ffmpegFile = File(nativeDir, ffmpegName)
      val ffprobeFile = File(nativeDir, ffprobeName)
      if (!ffmpegFile.exists() || !ffprobeFile.exists()) {
        debug("Native pair missing ffmpeg=${ffmpegFile.exists()} ffprobe=${ffprobeFile.exists()} names=$ffmpegName/$ffprobeName")
        continue
      }

      val ffmpegProbe = probeBinary(ffmpegFile.absolutePath, "ffmpeg")
      val ffprobeProbe = probeBinary(ffprobeFile.absolutePath, "ffprobe")

      val ffmpegRunnable = ffmpegProbe.runnable
      val ffprobeRunnable = ffprobeProbe.runnable
      val mergeCapable = ffmpegRunnable && ffprobeRunnable
      debug(
        "Native pair probe names=$ffmpegName/$ffprobeName runnable=$mergeCapable " +
          "ffmpeg=${ffmpegProbe.version ?: ffmpegProbe.error} ffprobe=${ffprobeProbe.version ?: ffprobeProbe.error}"
      )
      if (!mergeCapable) {
        addError(
          "FFMPEG_NATIVE_RUNTIME_NOT_READY: ffmpeg=${ffmpegProbe.error ?: "not runnable"} " +
            "ffprobe=${ffprobeProbe.error ?: "not runnable"} dir=${nativeDir.absolutePath}"
        )
      }

      return FfmpegInfo(
        path = ffmpegFile.absolutePath,
        ffprobePath = ffprobeFile.absolutePath,
        location = nativeDir.absolutePath,
        abi = Build.SUPPORTED_ABIS?.firstOrNull(),
        runtimeSource = "native_library",
        nativeLibraryDir = nativeDir.absolutePath,
        nativeLibraryEntries = nativeSnapshot.second,
        exists = true,
        ffprobeExists = true,
        executable = ffmpegRunnable,
        ffprobeExecutable = ffprobeRunnable,
        version = ffmpegProbe.version,
        ffprobeVersion = ffprobeProbe.version,
        ffmpegProbeError = ffmpegProbe.error,
        ffprobeProbeError = ffprobeProbe.error,
        mergeCapable = mergeCapable,
      )
    }

    return null
  }

  private fun inspectAssetRuntimeFallback(
    context: android.content.Context,
    nativeSnapshot: Pair<String?, List<String>>
  ): FfmpegInfo {
    val candidateAbis = Build.SUPPORTED_ABIS?.toList()?.ifEmpty { SUPPORTED_FFMPEG_ABIS } ?: SUPPORTED_FFMPEG_ABIS
    debug("Inspecting ffmpeg assets ABIs: ${candidateAbis.joinToString()}")
    for (abi in candidateAbis) {
      if (!SUPPORTED_FFMPEG_ABIS.contains(abi)) {
        continue
      }

      val ffmpegAssetExists = assetExists(context, "ffmpeg/$abi/ffmpeg")
      val ffprobeAssetExists = assetExists(context, "ffmpeg/$abi/ffprobe")
      if (!ffmpegAssetExists && !ffprobeAssetExists) {
        continue
      }

      return FfmpegInfo(
        abi = abi,
        runtimeSource = "asset_fallback",
        nativeLibraryDir = nativeSnapshot.first,
        nativeLibraryEntries = nativeSnapshot.second,
        exists = ffmpegAssetExists,
        ffprobeExists = ffprobeAssetExists,
        executable = false,
        ffprobeExecutable = false,
        ffmpegProbeError = if (ffmpegAssetExists) {
          "Asset fallback binaries are non-executable on this device; enable native library runtime extraction."
        } else {
          "ffmpeg asset missing"
        },
        ffprobeProbeError = if (ffprobeAssetExists) {
          "Asset fallback binaries are non-executable on this device; enable native library runtime extraction."
        } else {
          "ffprobe asset missing"
        },
        mergeCapable = false,
      )
    }

    return FfmpegInfo(
      runtimeSource = "none",
      nativeLibraryDir = nativeSnapshot.first,
      nativeLibraryEntries = nativeSnapshot.second,
      exists = false,
      ffprobeExists = false,
      executable = false,
      ffprobeExecutable = false,
      ffmpegProbeError = "No compatible native runtime or bundled ffmpeg assets found for device ABI.",
      ffprobeProbeError = "No compatible native runtime or bundled ffprobe assets found for device ABI.",
      mergeCapable = false,
    )
  }

  private fun assetExists(context: android.content.Context, assetPath: String): Boolean {
    return runCatching {
      context.assets.open(assetPath).use { _ -> }
      true
    }.getOrDefault(false)
  }

  private fun probeBinary(binaryPath: String, label: String): BinaryProbeResult {
    debug("Probing $label binary at $binaryPath")
    return runCatching {
      val process = ProcessBuilder(binaryPath, "-version")
        .redirectErrorStream(true)
        .start()

      val finished = process.waitFor(2, TimeUnit.SECONDS)
      if (!finished) {
        process.destroyForcibly()
        return@runCatching BinaryProbeResult(
          runnable = false,
          error = "$label probe timed out"
        )
      }

      val output = process.inputStream.bufferedReader().use { reader ->
        reader.readText()
      }
      val firstLine = output.lineSequence().firstOrNull()?.trim()
      val exitCode = process.exitValue()
      if (exitCode == 0 && !firstLine.isNullOrBlank()) {
        debug("$label probe success version=$firstLine")
        BinaryProbeResult(
          runnable = true,
          version = firstLine
        )
      } else {
        val snippet = output
          .lineSequence()
          .take(2)
          .joinToString(" | ")
          .ifBlank { "no output" }
        debug("$label probe failure exit=$exitCode snippet=$snippet")
        BinaryProbeResult(
          runnable = false,
          error = "$label exited $exitCode: $snippet"
        )
      }
    }.getOrElse {
      debug("$label probe exception: ${it.message ?: it::class.java.simpleName}")
      BinaryProbeResult(
        runnable = false,
        error = "$label probe failed: ${it.message ?: it::class.java.simpleName}"
      )
    }
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

  private fun clearDefaultProfile(platformDir: File) {
    val file = File(platformDir, DEFAULT_COOKIE_PROFILE_FILENAME)
    if (file.exists()) {
      file.delete()
    }
  }

  private fun addError(message: String) {
    val timestamped = "${Instant.now()}: $message"
    if (debugLoggingEnabled) {
      Log.e(tag, message)
    }
    lastErrors.addFirst(timestamped)
    while (lastErrors.size > MAX_ERROR_LOGS) {
      lastErrors.removeLast()
    }
  }

  private fun debug(message: String) {
    if (debugLoggingEnabled) {
      Log.d(tag, message)
    }
  }

  private fun summarizeFfmpegInfo(info: FfmpegInfo): String {
    return "source=${info.runtimeSource} abi=${info.abi} exists=${info.exists} ffmpeg=${info.path} ffprobe=${info.ffprobePath} " +
      "ffmpegExec=${info.executable} ffprobeExec=${info.ffprobeExecutable} mergeCapable=${info.mergeCapable} " +
      "ffmpegVersion=${info.version ?: "n/a"} ffprobeVersion=${info.ffprobeVersion ?: "n/a"} " +
      "ffmpegProbeError=${info.ffmpegProbeError ?: "n/a"} ffprobeProbeError=${info.ffprobeProbeError ?: "n/a"}"
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
          estimatedSizeMb = obj.optDouble("estimatedSizeMb", Double.NaN).takeIf { !it.isNaN() },
          timestampNormalized = if (obj.has("timestampNormalized")) obj.optBoolean("timestampNormalized") else null,
          warningCode = obj.optString("warningCode").ifBlank { null }
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
      "estimatedSizeMb" to estimatedSizeMb,
      "timestampNormalized" to timestampNormalized,
      "warningCode" to warningCode
    )
  }

  companion object {
    private const val ANDROID_KEYSTORE = "AndroidKeyStore"
    private const val COOKIE_KEY_ALIAS = "arsivinyo.local.cookies.v1"
    private const val COOKIE_STORE_VERSION = "v1"
    private const val COOKIE_MIGRATION_MARKER_FILENAME = ".migration_complete"
    private const val SECURE_COOKIES_DIRNAME = "cookies_secure"
    private const val CUSTOM_COOKIES_DIRNAME = "custom"
    private const val CUSTOM_PROFILES_DIRNAME = "profiles"
    private const val CUSTOM_DOMAINS_DIRNAME = "domains"
    private const val CUSTOM_INDEX_FILENAME = "index.json"
    private const val LEGACY_COOKIES_DIRNAME = "cookies"
    private const val RUNTIME_COOKIE_DIRNAME = "cookie_runtime"
    private const val DISABLED_COOKIES_DIRNAME = "cookies_disabled"
    private const val DEFAULT_HTTP_USER_AGENT =
      "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/133.0.0.0 Mobile Safari/537.36"
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
    private val STRICT_COOKIE_PLATFORMS = setOf("instagram", "facebook", "tiktok", "reddit")
    private val IN_FLIGHT_STATUSES = setOf("PENDING", "STARTED", "PROGRESS")
    private val SUPPORTED_FFMPEG_ABIS = listOf("arm64-v8a", "armeabi-v7a", "x86_64")
  }
}

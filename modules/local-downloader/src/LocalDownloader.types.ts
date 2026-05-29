export type LocalPlatform = 'youtube' | 'instagram' | 'facebook' | 'twitter' | 'reddit' | 'tiktok';

export interface LocalDownloadStartInput {
  url: string;
  cookiePlatform?: LocalPlatform;
  cookieProfile?: string;
  // 0 or undefined means unlimited file size.
  maxFileSizeMb?: number;
  visibility?: 'public' | 'private';
  // 'audio' downloads best-audio as M4A/AAC into the public music library (never the vault).
  mediaKind?: 'video' | 'audio';
}

/** A track in the on-device music library (public Music/Arsivinyo folder). */
export interface LocalSound {
  id: string;
  title: string;
  artist?: string | null;
  fileName: string;
  contentUri: string;
  durationSec: number;
  sizeBytes: number;
  thumbnailPath?: string | null;
  createdAt: number;
  updatedAt: number;
}

/** A user-defined playlist. Many-to-many: a song may appear in several playlists. */
export interface LocalSoundPlaylist {
  id: string;
  name: string;
  songIds: string[];
  /** True for the special, non-deletable Favorites playlist (id "favorites"). */
  system?: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface LocalSoundsLibrary {
  songs: LocalSound[];
  playlists: LocalSoundPlaylist[];
}

export interface LocalSoundsImportResult {
  success: boolean;
  importedCount?: number;
  failedCount?: number;
  songs?: LocalSound[];
  code?: string;
  message?: string;
  /** Per-file failure reasons (debug aid), present when failedCount > 0. */
  failures?: string[];
}

export interface LocalDownloadStartResult {
  taskId: string;
  estimatedSizeMb?: number | null;
}

export interface LocalBackgroundState {
  backgroundDownloadsEnabled?: boolean;
  stickyNotificationEnabled?: boolean;
  serviceRunning: boolean;
  activeTaskId: string | null;
  queueSize: number;
  maxQueueSize?: number;
  queuedUrls: string[];
  lastQuickReason?: string | null;
  notificationPhase?: string;
  privateModeEnabled?: boolean;
  audioModeEnabled?: boolean;
  notificationPermissionRequired: boolean;
  notificationPermissionGranted: boolean;
}

export interface LocalBackgroundPermissionResult {
  granted: boolean;
  canAskAgain: boolean;
}

export interface LocalBackgroundDownloadsState {
  enabled: boolean;
}

export interface LocalStickyNotificationState {
  enabled: boolean;
}

export interface LocalQuickDownloadResult {
  accepted: boolean;
  reason?: 'NO_CLIPBOARD_URL' | 'INVALID_QUICK_URL' | 'QUEUE_FULL' | 'PERMISSION_REQUIRED' | 'ALREADY_ACTIVE' | 'QUICK_DOWNLOAD_REJECTED' | 'QUICK_CAPTURE_CANCELLED' | 'PRIVATE_MODE_UNAVAILABLE';
  taskId?: string;
  queueSize?: number;
  queueMax?: number;
  resolvedUrl?: string | null;
  visibility?: 'public' | 'private';
  captureMode?: 'clipboard' | 'manual';
}

export interface LocalDownloadFailureLog {
  id: string;
  createdAt: number;
  taskId?: string | null;
  code?: string | null;
  url?: string | null;
  normalizedUrl?: string | null;
  preflightWarning?: Record<string, unknown> | null;
  preflightStrategy?: string | null;
  downloadStrategy?: string | null;
  extractorKey?: string | null;
  formatSelector?: string | null;
  attemptTrace?: Array<Record<string, unknown>> | null;
  toolOutput?: string | null;
  preflightBudgetSec?: number | null;
  preflightElapsedMs?: number | null;
  preflightAttemptLimit?: number | null;
  staticMediaCandidateCount?: number | null;
  message: string;
}

export interface LocalSaveToMediaStoreInput {
  filePath: string;
  filename: string;
  mimeType?: string;
  dateTakenMs?: number;
}

export interface LocalSaveToMediaStoreResult {
  uri: string;
  assetId?: string;
}

export type LocalTaskStatus = 'PENDING' | 'STARTED' | 'PROGRESS' | 'SUCCESS' | 'FAILURE' | 'CANCELLED';

export interface LocalTaskStatusResult {
  taskId: string;
  status: LocalTaskStatus;
  url?: string | null;
  state?: 'starting' | 'downloading' | 'processing' | 'saving' | 'completed' | 'error';
  filename?: string;
  filePath?: string;
  isPrivate?: boolean;
  privateVideoId?: string;
  sizeMb?: number;
  progressPercent?: number;
  speedBytesPerSec?: number;
  errorCode?: string;
  errorMessage?: string;
  estimatedSizeMb?: number | null;
  timestampNormalized?: boolean;
  warningCode?: string;
}

export interface LocalCookieProfile {
  profileName: string;
  path: string;
  lastModified: number;
}

export interface LocalCustomCookieImportInput {
  uri: string;
  profileName?: string;
  domain?: string | null;
}

export interface LocalCustomCookieImportResult {
  profileId: string;
  profileName: string;
  detectedDomains: string[];
  boundDomains: string[];
}

export interface LocalCustomDomainSummary {
  domain: string;
  profileCount: number;
  defaultProfileName: string | null;
}

export interface LocalCustomDomainProfile {
  profileName: string;
  profileId: string;
  lastModified: number;
}

export interface LocalDownloadEvent {
  taskId: string;
  status: LocalTaskStatus;
  state: 'starting' | 'downloading' | 'processing' | 'saving' | 'completed' | 'error';
  message?: string;
  progressPercent?: number;
  speedBytesPerSec?: number;
}

export interface LocalBackgroundStateEvent extends LocalBackgroundState {}

export type LocalYtDlpUpdatePhase =
  | 'checking'
  | 'available'
  | 'up_to_date'
  | 'downloading'
  | 'installing'
  | 'verifying'
  | 'installed'
  | 'failed';

export interface LocalYtDlpUpdateProgressEvent {
  phase: LocalYtDlpUpdatePhase;
  version?: string | null;
  bytesDownloaded?: number | null;
  bytesTotal?: number | null;
  percent?: number | null;
  message?: string | null;
}

export interface LocalYtDlpUpdateStatus {
  source: 'bundled' | 'override' | string;
  bundledVersion?: string | null;
  activeVersion?: string | null;
  overrideVersion?: string | null;
  pendingVersion?: string | null;
  failedVersion?: string | null;
  failedReason?: string | null;
  effectiveInstalledVersion?: string | null;
  installedVersions?: string[];
  latestVersion?: string | null;
  latestCheckError?: string | null;
  updateAvailable?: boolean;
  requiresRestart?: boolean;
  updateRunning?: boolean;
  storageReady?: boolean;
  overridePath?: string | null;
  activeTaskId?: string | null;
}

export interface LocalYtDlpUpdateCheckResult extends LocalYtDlpUpdateStatus {
  status: 'available' | 'up_to_date' | string;
}

export interface LocalYtDlpUpdateResult {
  status: 'up_to_date' | 'installed' | 'failed' | 'blocked' | 'running' | string;
  success: boolean;
  previousVersion?: string | null;
  installedVersion?: string | null;
  latestVersion?: string | null;
  pendingVersion?: string | null;
  requiresRestart: boolean;
  code?: string;
  message?: string;
}

export interface LocalPrivateModeState {
  enabled: boolean;
}

export type LocalPrivateAuthPurpose =
  | 'view'
  | 'delete'
  | 'unprivate'
  | 'import'
  | 'export'
  | 'rename'
  | 'migrate'
  | 'tag'
  | 'folder'
  | 'bundleExport'
  | 'bundleImport';

export interface LocalPrivateAuthResult {
  granted: boolean;
  reason?: string;
}

export interface LocalPrivateVideoItem {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  mimeType: string;
  durationSec?: number | null;
  sizeBytesEncrypted: number;
  cipherVersion: string;
  containerExt?: string | null;
  hasThumbnail?: boolean;
  thumbnailUri?: string | null;
  thumbWidth?: number | null;
  thumbHeight?: number | null;
  migrationFailed?: boolean;
  migrationFailedCode?: string | null;
  tags?: string[];
  folderId?: string | null;
}

export interface PrivateVaultTag {
  id: string;
  name: string;
  color: string;
  createdAt: number;
}

export interface PrivateVaultFolder {
  id: string;
  name: string;
  createdAt: number;
}

export interface PrivateVaultTagDeleteResult {
  success: boolean;
  removedFromCount?: number;
  code?: string;
}

export interface PrivateVaultFolderDeleteResult {
  success: boolean;
  movedToRootCount?: number;
  code?: string;
}

export interface LocalPrivateRenameResult {
  success: boolean;
  code?: string;
  entry?: LocalPrivateVideoItem;
}

export interface LocalPrivateThumbnailUriResult {
  success: boolean;
  uri?: string | null;
  hasThumbnail?: boolean;
  code?: string;
}

export type LocalPrivateMigrationOutcome = 'STARTED' | 'COMPLETED' | 'CANCELLED' | 'BLOCKED_KEY_INVALIDATED';

export interface LocalPrivateMigrationStartResult {
  success: boolean;
  outcome?: LocalPrivateMigrationOutcome;
  total?: number;
  code?: string;
  freeBytes?: number;
  requiredBytes?: number;
  batteryLevel?: number;
  isCharging?: boolean;
}

export interface LocalPrivateMigrationCancelResult {
  success: boolean;
  wasRunning?: boolean;
}

export interface LocalPrivateMigrationProgress {
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  skipped: number;
  currentEntryId?: string | null;
  currentTitle?: string | null;
  lastErrorCode?: string | null;
  lastErrorDetail?: string | null;
}

export interface LocalPrivateMigrationStatus extends LocalPrivateMigrationProgress {
  running: boolean;
}

export interface LocalVaultDiagnostics {
  loopbackRunning: boolean;
  loopbackPort?: number | null;
  activeVideoSessions: number;
  evictedVideoSessions: number;
  cipherCounts: {
    v4: number;
    v3: number;
    other: number;
  };
  migration: {
    running: boolean;
    lastProcessed?: number | null;
    lastTotal?: number | null;
    lastErrorCode?: string | null;
  };
}

export interface LocalPrivateCopyToPublicResult {
  success: boolean;
  uri?: string;
  code?: string;
  message?: string;
}

export interface LocalPrivateImportResult {
  success: boolean;
  item?: LocalPrivateVideoItem;
  code?: string;
  message?: string;
}

export interface LocalDiagnostics {
  ytDlpVersion: string;
  ytDlpAvailable: boolean;
  pythonReady: boolean;
  ytDlpBundledVersion?: string | null;
  ytDlpActiveVersion?: string | null;
  ytDlpOverrideVersion?: string | null;
  ytDlpPendingVersion?: string | null;
  ytDlpFailedVersion?: string | null;
  ytDlpFailedReason?: string | null;
  ytDlpOverrideSource?: string | null;
  ytDlpOverridePath?: string | null;
  ytDlpOverrideStorageReady?: boolean;
  normalizedUrlLast?: string | null;
  attemptTraceCount?: number;
  attemptTrace?: Array<{
    timeMs?: number;
    phase?: string;
    attemptId?: string;
    strategy?: string;
    status?: string;
    platform?: string;
    cookieUsed?: boolean;
    retryIndex?: number;
    extractorKey?: string;
    errorCode?: string;
    errorMessage?: string;
    impersonate?: string;
  }>;
  lastExtractorKey?: string | null;
  lastRawYtDlpError?: string | null;
  lastCookieCheck?: {
    platform?: string;
    hasCookieFile: boolean;
    domainCoverage: string[];
    unexpiredCount: number;
  } | null;
  ytDlpVersionAgeDays?: number | null;
  platformStrategyLast?: string | null;
  impersonationRuntimeAvailable?: boolean | null;
  impersonationEnabled?: boolean;
  impersonationBackend?: 'curl_cffi' | 'none';
  impersonationRequiredByExtractorLast?: string | null;
  impersonationAttemptedTargetsLast?: string[];
  impersonationResolvedTargetLast?: string | null;
  impersonationWheelVersion?: string | null;
  impersonationBuildAbiCoverage?: string[];
  impersonationBootstrapError?: string | null;
  ffmpegPath: string | null;
  ffprobePath: string | null;
  ffmpegAbi?: string | null;
  ffmpegRuntimeSource?: 'native_library' | 'asset_fallback' | 'none';
  nativeLibraryDir?: string | null;
  nativeLibraryEntries?: string[];
  ffmpegVersion?: string | null;
  ffprobeVersion?: string | null;
  ffmpegExists: boolean;
  ffprobeExists: boolean;
  ffmpegExecutable?: boolean;
  ffprobeExecutable?: boolean;
  ffmpegProbeError?: string | null;
  ffprobeProbeError?: string | null;
  mergeCapable: boolean;
  activeHttpUserAgent: string;
  serviceRunning?: boolean;
  queuedDownloadCount?: number;
  privateModeEnabled?: boolean;
  privateVaultCount?: number;
  privateVaultCipherActive?: 'v1' | 'v2' | 'v3' | 'v4';
  privateVaultLegacyCount?: number;
  privateLastEncryptMs?: number | null;
  privateLastDecryptMs?: number | null;
  privateLastThroughputMbps?: number | null;
  lastBackgroundServiceError?: string | null;
  secureCookieStoreEnabled: boolean;
  cookieEncryptionVersion: string;
  cookieProfilesEncryptedCount: number;
  customDomainsCount?: number;
  customProfilesCount?: number;
  cookieLegacyPlaintextCount: number;
  cookieMigrationStatus: 'not_needed' | 'migrated' | 'partial' | 'failed';
  customDomainMatchLast?: {
    urlHost: string;
    matchedDomain?: string | null;
    profileName?: string | null;
  } | null;
  activeTaskId: string | null;
  lastErrors: string[];
}

export interface LocalImpersonationSelfTestResult {
  success: boolean;
  code: string;
  message?: string | null;
  impersonation_enabled?: boolean;
  backend?: string | null;
  wheel_version?: string | null;
  build_abi_coverage?: string[];
}

export type LocalPlatform = 'youtube' | 'instagram' | 'facebook' | 'twitter' | 'reddit' | 'tiktok';

export interface LocalDownloadStartInput {
  url: string;
  cookiePlatform?: LocalPlatform;
  cookieProfile?: string;
  // 0 or undefined means unlimited file size.
  maxFileSizeMb?: number;
  visibility?: 'public' | 'private';
}

export interface LocalDownloadStartResult {
  taskId: string;
  estimatedSizeMb?: number | null;
}

export interface LocalBackgroundState {
  serviceRunning: boolean;
  activeTaskId: string | null;
  queueSize: number;
  maxQueueSize?: number;
  queuedUrls: string[];
  lastQuickReason?: string | null;
  notificationPhase?: string;
  privateModeEnabled?: boolean;
  notificationPermissionRequired: boolean;
  notificationPermissionGranted: boolean;
}

export interface LocalBackgroundPermissionResult {
  granted: boolean;
  canAskAgain: boolean;
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
  filename?: string;
  filePath?: string;
  isPrivate?: boolean;
  privateVideoId?: string;
  sizeMb?: number;
  progressPercent?: number;
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
}

export interface LocalBackgroundStateEvent extends LocalBackgroundState {}

export interface LocalPrivateModeState {
  enabled: boolean;
}

export type LocalPrivateAuthPurpose = 'view' | 'delete' | 'unprivate';

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
}

export interface LocalDiagnostics {
  ytDlpVersion: string;
  ytDlpAvailable: boolean;
  pythonReady: boolean;
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
  privateVaultCipherActive?: 'v1' | 'v2';
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

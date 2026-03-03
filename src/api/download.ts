import { getErrorMessage } from './errors';
import {
  cancelLocalTask,
  getLocalTaskStatus,
  listenDownloadProgress,
  startLocalDownload,
} from './localDownloader';
import type {
  ApiErrorCode,
  DownloadProgress,
  DownloadStartResponse,
  TaskStatusResponse,
} from './types';
import { getDefaultCookieProfile, isValidUrl, getPlatformFromUrl } from '../services';

const POLLING_INTERVALS = {
  initial: 1500,
  medium: 3000,
  slow: 6000,
};

const DEFAULT_MAX_FILE_SIZE_MB = 0;

function extractErrorCode(error: unknown): ApiErrorCode {
  if (!(error instanceof Error)) {
    return 'UNKNOWN_ERROR';
  }

  const knownCodes: ApiErrorCode[] = [
    'INVALID_URL',
    'UNSUPPORTED_PLATFORM',
    'DOWNLOAD_ALREADY_IN_PROGRESS',
    'FILE_TOO_LARGE',
    'SERVER_BUSY',
    'DOWNLOAD_FAILED',
    'DOWNLOAD_CANCELLED',
    'TASK_CANCELLED',
    'TASK_CANCEL_TIMEOUT',
    'PROCESS_RESTARTED',
    'COOKIE_STORE_ENCRYPT_FAILED',
    'COOKIE_STORE_DECRYPT_FAILED',
    'COOKIE_MIGRATION_FAILED',
    'COOKIE_PROFILE_NOT_FOUND',
    'INVALID_CUSTOM_DOMAIN',
    'CUSTOM_COOKIE_NO_DOMAIN_DETECTED',
    'CUSTOM_COOKIE_DOMAIN_NOT_FOUND',
    'CUSTOM_COOKIE_PROFILE_NOT_FOUND',
    'REDDIT_COOKIE_REQUIRED',
    'FFMPEG_NATIVE_RUNTIME_UNAVAILABLE',
    'FFMPEG_MISSING',
    'FFPROBE_MISSING',
    'MERGE_DEPENDENCY_MISSING',
    'SITE_BLOCKED_403',
    'COOKIE_STALE_OR_INVALID',
    'REDDIT_SHARE_URL_RESOLUTION_FAILED',
    'REDDIT_EXTRACTOR_ROUTE_FAILED',
    'TIKTOK_API_STATUS_ZERO',
    'TIKTOK_EXTRACTOR_UNSTABLE',
    'IMPERSONATION_BOOTSTRAP_FAILED',
    'IMPERSONATION_TARGET_REQUIRED_UNAVAILABLE',
    'IMPERSONATION_DEPENDENCY_MISSING',
    'IMPERSONATION_RUNTIME_UNAVAILABLE',
    'COOKIE_DOMAIN_MISMATCH',
    'COOKIE_EMPTY_OR_EXPIRED',
    'TIMESTAMP_POSTPROCESS_FAILED',
    'PREFLIGHT_FAILED',
    'INTERNAL_ERROR',
    'FILE_NOT_FOUND',
    'UNKNOWN_ERROR',
  ];

  const normalized = error.message.trim();
  const match = knownCodes.find((code) => normalized.includes(code));
  return match ?? 'UNKNOWN_ERROR';
}

function getPollingInterval(elapsedMs: number): number {
  if (elapsedMs < 30_000) return POLLING_INTERVALS.initial;
  if (elapsedMs < 120_000) return POLLING_INTERVALS.medium;
  return POLLING_INTERVALS.slow;
}

export async function startDownload(url: string, maxFileSizeMb: number = DEFAULT_MAX_FILE_SIZE_MB): Promise<DownloadStartResponse> {
  const platform = getPlatformFromUrl(url);
  const cookieProfile = platform ? await getDefaultCookieProfile(platform) : null;

  const result = await startLocalDownload({
    url,
    cookiePlatform: platform ?? undefined,
    cookieProfile: cookieProfile ?? undefined,
    maxFileSizeMb,
  });

  return {
    taskId: result.taskId,
    estimatedSizeMb: result.estimatedSizeMb,
  };
}

export async function checkTaskStatus(taskId: string): Promise<TaskStatusResponse> {
  return getLocalTaskStatus(taskId);
}

export async function cancelTask(taskId: string): Promise<{ success: boolean }> {
  return cancelLocalTask(taskId);
}

export async function pollTaskStatus(
  taskId: string,
  onProgress?: (status: TaskStatusResponse) => void
): Promise<TaskStatusResponse> {
  const startTime = Date.now();

  while (true) {
    const status = await checkTaskStatus(taskId);
    onProgress?.(status);

    if (status.status === 'SUCCESS') {
      return status;
    }

    if (status.status === 'FAILURE' || status.status === 'CANCELLED') {
      const code = (status.errorCode || 'INTERNAL_ERROR') as ApiErrorCode;
      const translated = getErrorMessage(code);
      const details = status.errorMessage?.trim();
      throw new Error(details ? `${translated} (${details})` : translated);
    }

    const elapsed = Date.now() - startTime;
    const interval = getPollingInterval(elapsed);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export async function downloadMedia(
  url: string,
  onProgressChange?: (progress: DownloadProgress) => void
): Promise<{ taskId: string; localPath: string; filename: string }> {
  if (!isValidUrl(url)) {
    const errorCode = 'INVALID_URL' as ApiErrorCode;
    onProgressChange?.({
      state: 'error',
      errorCode,
      errorMessage: getErrorMessage(errorCode),
    });
    throw new Error(getErrorMessage(errorCode));
  }

  onProgressChange?.({ state: 'starting' });

  let startResult: DownloadStartResponse;
  try {
    startResult = await startDownload(url, DEFAULT_MAX_FILE_SIZE_MB);
  } catch (error) {
    const errorCode = extractErrorCode(error);
    const errorMessage = getErrorMessage(errorCode);
    onProgressChange?.({
      state: 'error',
      errorCode,
      errorMessage,
    });
    throw new Error(errorMessage);
  }
  const taskId = startResult.taskId;
  onProgressChange?.({ state: 'downloading', taskId });

  const subscription = listenDownloadProgress((event) => {
    if (event.taskId !== taskId) return;

    if (event.state === 'starting') {
      onProgressChange?.({ state: 'starting', taskId });
      return;
    }

    if (event.state === 'downloading') {
      onProgressChange?.({ state: 'downloading', taskId });
      return;
    }

    if (event.state === 'completed') {
      onProgressChange?.({ state: 'processing', taskId });
    }
  });

  try {
    const finalStatus = await pollTaskStatus(taskId, (status) => {
      if (status.status === 'STARTED' || status.status === 'PROGRESS') {
        onProgressChange?.({ state: 'processing', taskId });
      }
    });

    const filename = finalStatus.filename;
    const localPath = finalStatus.filePath;

    if (!filename || !localPath) {
      throw new Error(getErrorMessage('FILE_NOT_FOUND'));
    }

    onProgressChange?.({ state: 'completed', taskId, filename });

    return {
      taskId,
      localPath,
      filename,
    };
  } finally {
    subscription.remove();
  }
}

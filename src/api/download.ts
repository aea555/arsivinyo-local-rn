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
type DownloadVisibility = 'public' | 'private';

class DownloadCancelledError extends Error {
  code: ApiErrorCode;

  constructor(message: string, code: ApiErrorCode = 'DOWNLOAD_CANCELLED') {
    super(message);
    this.name = 'DownloadCancelledError';
    this.code = code;
  }
}

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
    'BACKGROUND_PERMISSION_REQUIRED',
    'NO_CLIPBOARD_URL',
    'INVALID_QUICK_URL',
    'QUICK_CAPTURE_CANCELLED',
    'DOWNLOAD_QUEUE_FULL',
    'BACKGROUND_SERVICE_START_FAILED',
    'QUICK_DOWNLOAD_REJECTED',
    'PRIVATE_AUTH_REQUIRED',
    'PRIVATE_AUTH_FAILED',
    'PRIVATE_STORAGE_WRITE_FAILED',
    'PRIVATE_IMPORT_PICK_CANCELLED',
    'PRIVATE_IMPORT_FAILED',
    'PRIVATE_IMPORT_UNSUPPORTED_TYPE',
    'PRIVATE_PUBLIC_COPY_FAILED',
    'PRIVATE_PUBLIC_COPY_LEGACY_UNSUPPORTED',
    'PRIVATE_LEGACY_VAULT_UNSUPPORTED',
    'PRIVATE_VIDEO_NOT_FOUND',
    'PRIVATE_EXPORT_FAILED',
    'PRIVATE_EXPORT_DISABLED',
    'PRIVATE_MODE_UNAVAILABLE',
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

export async function startDownload(
  url: string,
  maxFileSizeMb: number = DEFAULT_MAX_FILE_SIZE_MB,
  visibility: DownloadVisibility = 'public'
): Promise<DownloadStartResponse> {
  const platform = getPlatformFromUrl(url);
  const cookieProfile = platform ? await getDefaultCookieProfile(platform) : null;

  const result = await startLocalDownload({
    url,
    cookiePlatform: platform ?? undefined,
    cookieProfile: cookieProfile ?? undefined,
    maxFileSizeMb,
    visibility,
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

    if (status.status === 'CANCELLED') {
      const code = (status.errorCode || 'DOWNLOAD_CANCELLED') as ApiErrorCode;
      const translated = getErrorMessage(code);
      const details = status.errorMessage?.trim();
      throw new DownloadCancelledError(details ? `${translated} (${details})` : translated, code);
    }

    if (status.status === 'FAILURE') {
      const code = (status.errorCode || 'INTERNAL_ERROR') as ApiErrorCode;
      const translated = getErrorMessage(code);
      throw new Error(translated);
    }

    const elapsed = Date.now() - startTime;
    const interval = getPollingInterval(elapsed);
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
}

export async function downloadMedia(
  url: string,
  onProgressChange?: (progress: DownloadProgress) => void,
  visibility: DownloadVisibility = 'public'
): Promise<{ taskId: string; localPath?: string; filename: string; isPrivate: boolean; privateVideoId?: string }> {
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
    startResult = await startDownload(url, DEFAULT_MAX_FILE_SIZE_MB, visibility);
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
      onProgressChange?.({
        state: 'downloading',
        taskId,
        progressPercent: event.progressPercent,
        speedBytesPerSec: event.speedBytesPerSec,
      });
      return;
    }

    if (event.state === 'processing') {
      onProgressChange?.({ state: 'processing', taskId, progressPercent: event.progressPercent });
      return;
    }

    if (event.state === 'saving') {
      onProgressChange?.({ state: 'saving', taskId, progressPercent: event.progressPercent });
      return;
    }

    if (event.state === 'completed') {
      onProgressChange?.({ state: 'processing', taskId });
    }
  });

  try {
    const finalStatus = await pollTaskStatus(taskId, (status) => {
      if (status.status === 'STARTED') {
        onProgressChange?.({ state: 'starting', taskId, progressPercent: status.progressPercent });
        return;
      }
      if (status.status === 'PROGRESS') {
        const statusState = status.state;
        const mappedState =
          statusState === 'processing' || statusState === 'saving' || statusState === 'starting'
            ? statusState
            : 'downloading';
        onProgressChange?.({
          state: mappedState,
          taskId,
          progressPercent: status.progressPercent,
          speedBytesPerSec: mappedState === 'downloading' ? status.speedBytesPerSec : undefined,
        });
      }
    });

    const filename = finalStatus.filename;
    const localPath = finalStatus.filePath;
    const isPrivate = Boolean(finalStatus.isPrivate);
    const privateVideoId = finalStatus.privateVideoId;

    if (isPrivate) {
      if (!filename || !privateVideoId) {
        throw new Error(getErrorMessage('FILE_NOT_FOUND'));
      }
      onProgressChange?.({ state: 'completed', taskId, filename });
      return {
        taskId,
        filename,
        isPrivate: true,
        privateVideoId,
      };
    }

    if (!filename || !localPath) {
      throw new Error(getErrorMessage('FILE_NOT_FOUND'));
    }

    onProgressChange?.({ state: 'completed', taskId, filename });

    return {
      taskId,
      localPath,
      filename,
      isPrivate: false,
    };
  } finally {
    subscription.remove();
  }
}

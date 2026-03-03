/**
 * API Types matching backend response structure
 */

export interface ApiResponse<T = unknown> {
    success: boolean;
    code: string;
    status_code: number;
    message?: string;
    data?: T;
}

export interface DownloadStartResponse {
    taskId: string;
    estimatedSizeMb?: number | null;
}

export type TaskStatus = 'PENDING' | 'STARTED' | 'PROGRESS' | 'SUCCESS' | 'FAILURE' | 'CANCELLED';

export interface TaskStatusResponse {
    taskId: string;
    status: TaskStatus;
    filePath?: string;
    filename?: string;
    sizeMb?: number;
    progressPercent?: number;
    errorCode?: string;
    errorMessage?: string;
    estimatedSizeMb?: number | null;
    timestampNormalized?: boolean;
    warningCode?: string;
}

/**
 * Error codes returned by the API
 */
export type ApiErrorCode =
    | 'API_READY'
    | 'DOWNLOAD_STARTED'
    | 'INVALID_URL'
    | 'UNSUPPORTED_PLATFORM'
    | 'INVALID_TOKEN'
    | 'FILE_NOT_READY'
    | 'FILE_NOT_FOUND'
    | 'TOO_MANY_REQUESTS'
    | 'VOLUME_LIMIT_EXCEEDED'
    | 'SPAM_DETECTED'
    | 'FILE_TOO_LARGE'
    | 'SERVER_BUSY'
    | 'DOWNLOAD_ALREADY_IN_PROGRESS'
    | 'DOWNLOAD_CANCELLED'
    | 'TASK_CANCEL_TIMEOUT'
    | 'PROCESS_RESTARTED'
    | 'COOKIE_STORE_ENCRYPT_FAILED'
    | 'COOKIE_STORE_DECRYPT_FAILED'
    | 'COOKIE_MIGRATION_FAILED'
    | 'COOKIE_PROFILE_NOT_FOUND'
    | 'INVALID_CUSTOM_DOMAIN'
    | 'CUSTOM_COOKIE_NO_DOMAIN_DETECTED'
    | 'CUSTOM_COOKIE_DOMAIN_NOT_FOUND'
    | 'CUSTOM_COOKIE_PROFILE_NOT_FOUND'
    | 'REDDIT_COOKIE_REQUIRED'
    | 'FFMPEG_NATIVE_RUNTIME_UNAVAILABLE'
    | 'FFMPEG_MISSING'
    | 'FFPROBE_MISSING'
    | 'MERGE_DEPENDENCY_MISSING'
    | 'SITE_BLOCKED_403'
    | 'COOKIE_STALE_OR_INVALID'
    | 'REDDIT_SHARE_URL_RESOLUTION_FAILED'
    | 'REDDIT_EXTRACTOR_ROUTE_FAILED'
    | 'TIKTOK_API_STATUS_ZERO'
    | 'TIKTOK_EXTRACTOR_UNSTABLE'
    | 'IMPERSONATION_BOOTSTRAP_FAILED'
    | 'IMPERSONATION_TARGET_REQUIRED_UNAVAILABLE'
    | 'IMPERSONATION_DEPENDENCY_MISSING'
    | 'IMPERSONATION_RUNTIME_UNAVAILABLE'
    | 'COOKIE_DOMAIN_MISMATCH'
    | 'COOKIE_EMPTY_OR_EXPIRED'
    | 'TIMESTAMP_POSTPROCESS_FAILED'
    | 'INTERNAL_ERROR'
    | 'DOWNLOAD_FAILED'
    | 'PREFLIGHT_FAILED'
    | 'NETWORK_ERROR'
    | 'UNKNOWN_ERROR'
    | 'TASK_IN_PROGRESS'
    | 'TASK_COMPLETED'
    | 'TASK_CANCELLED';

/**
 * Download state for UI
 */
export type DownloadState =
    | 'idle'
    | 'starting'
    | 'downloading'
    | 'processing'
    | 'saving'
    | 'completed'
    | 'error';

export interface DownloadProgress {
    state: DownloadState;
    taskId?: string;
    filename?: string;
    progressPercent?: number;
    errorCode?: ApiErrorCode;
    errorMessage?: string;
}

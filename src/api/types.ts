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
    errorCode?: string;
    errorMessage?: string;
    estimatedSizeMb?: number | null;
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
    errorCode?: ApiErrorCode;
    errorMessage?: string;
}

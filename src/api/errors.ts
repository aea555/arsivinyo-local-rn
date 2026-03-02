import i18n from '../i18n';

/**
 * Error codes that map to i18n keys
 */
export type AppErrorCode =
    | 'INVALID_URL'
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
    | 'INVALID_COOKIE_PROFILE'
    | 'DOWNLOAD_FAILED'
    | 'PREFLIGHT_FAILED'
    | 'TASK_CANCELLED'
    | 'INTERNAL_ERROR'
    | 'UNKNOWN_ERROR'
    | 'UNSUPPORTED_PLATFORM'
    | 'SERVER_ERROR'
    | 'NETWORK_ERROR';

/**
 * Get user-friendly error message for an error code
 * Uses i18n for localization
 */
export function getErrorMessage(code: string | undefined): string {
    if (!code) {
        return i18n.t('errors.UNKNOWN_ERROR');
    }

    // Check if we have a translation for this code
    const key = `errors.${code}`;
    const translation = i18n.t(key);

    // If no translation found (i18n returns the key itself), use unknown error
    if (translation === key) {
        return i18n.t('errors.UNKNOWN_ERROR');
    }

    return translation;
}

/**
 * Check if HTTP status code indicates a server error (5xx)
 */
export function isServerError(statusCode: number): boolean {
    return statusCode >= 500 && statusCode < 600;
}

/**
 * Get appropriate error code for HTTP status
 */
export function getErrorCodeForStatus(statusCode: number): AppErrorCode {
    if (isServerError(statusCode)) {
        return 'SERVER_ERROR';
    }

    switch (statusCode) {
        case 400:
            return 'INVALID_URL';
        case 401:
        case 403:
            return 'INVALID_TOKEN';
        case 404:
            return 'FILE_NOT_FOUND';
        case 429:
            return 'TOO_MANY_REQUESTS';
        default:
            return 'UNKNOWN_ERROR';
    }
}

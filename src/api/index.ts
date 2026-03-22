export { cancelTask, checkTaskStatus, downloadMedia, pollTaskStatus, startDownload } from './download';
export {
    authenticateLocalPrivateAccess,
    clearLocalPrivatePlaybackCache,
    copyLocalPrivateVideoToPublicGallery,
    deleteLocalPrivateVideo,
    ensureLocalBackgroundPermission,
    getLocalPrivateModeState,
    getLocalBackgroundState,
    getLocalDiagnostics,
    listenBackgroundState,
    listenDownloadProgress,
    listLocalPrivateVideos,
    makeLocalVideoPublic,
    prepareLocalPrivatePlayback,
    pickAndImportLocalVideoToPrivateVault,
    runLocalImpersonationSelfTest,
    saveLocalFileToMediaStore,
    setLocalSecureScreen,
    setLocalPrivateModeEnabled,
    startQuickLocalDownloadFromClipboard,
    startQuickLocalDownloadWithUrl
} from './localDownloader';
export type {
    ApiErrorCode, ApiResponse, DownloadProgress, DownloadStartResponse, DownloadState, TaskStatus, TaskStatusResponse
} from './types';

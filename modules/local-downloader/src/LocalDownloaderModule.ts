import { EventEmitter, type EventSubscription, requireNativeModule } from 'expo-modules-core';
import { Platform } from 'react-native';
import type {
  LocalCookieProfile,
  LocalBackgroundDownloadsState,
  LocalBackgroundPermissionResult,
  LocalBackgroundState,
  LocalBackgroundStateEvent,
  LocalStickyNotificationState,
  LocalCustomCookieImportInput,
  LocalCustomCookieImportResult,
  LocalCustomDomainProfile,
  LocalCustomDomainSummary,
  LocalDiagnostics,
  LocalDownloadFailureLog,
  LocalDownloadEvent,
  LocalDownloadStartInput,
  LocalDownloadStartResult,
  LocalPrivateAuthPurpose,
  LocalPrivateAuthResult,
  LocalPrivateModeState,
  LocalPrivateVideoItem,
  LocalImpersonationSelfTestResult,
  LocalPrivateCopyToPublicResult,
  LocalSaveToMediaStoreInput,
  LocalSaveToMediaStoreResult,
  LocalPlatform,
  LocalPrivateImportResult,
  LocalPrivateMigrationCancelResult,
  LocalPrivateMigrationProgress,
  LocalPrivateMigrationStartResult,
  LocalPrivateMigrationStatus,
  LocalPrivateRenameResult,
  LocalPrivateThumbnailUriResult,
  PrivateVaultFolder,
  PrivateVaultFolderDeleteResult,
  PrivateVaultTag,
  PrivateVaultTagDeleteResult,
  LocalQuickDownloadResult,
  LocalSound,
  LocalSoundPlaylist,
  LocalSoundsImportResult,
  LocalSoundsLibrary,
  LocalTaskStatusResult,
  LocalVaultDiagnostics,
  LocalYtDlpUpdateCheckResult,
  LocalYtDlpUpdateProgressEvent,
  LocalYtDlpUpdateResult,
  LocalYtDlpUpdateStatus,
} from './LocalDownloader.types';

type LocalDownloaderNativeModule = {
  startDownload(input: LocalDownloadStartInput): Promise<LocalDownloadStartResult>;
  getTaskStatus(taskId: string): Promise<LocalTaskStatusResult>;
  cancelTask(taskId: string): Promise<{ success: boolean }>;
  getBackgroundState(): Promise<LocalBackgroundState>;
  ensureBackgroundPermission(): Promise<LocalBackgroundPermissionResult>;
  setBackgroundDownloadsEnabled(input: { enabled: boolean }): Promise<LocalBackgroundDownloadsState>;
  setStickyNotificationEnabled(input: { enabled: boolean }): Promise<LocalStickyNotificationState>;
  startQuickDownloadFromClipboard(): Promise<LocalQuickDownloadResult>;
  startQuickDownloadWithUrl(input: { url: string }): Promise<LocalQuickDownloadResult>;
  getPrivateModeState(): Promise<LocalPrivateModeState>;
  setPrivateModeEnabled(input: { enabled: boolean }): Promise<LocalPrivateModeState>;
  getAudioModeState(): Promise<{ enabled: boolean }>;
  setAudioModeEnabled(input: { enabled: boolean }): Promise<{ enabled: boolean }>;
  authenticatePrivateAccess(input: { purpose: LocalPrivateAuthPurpose }): Promise<LocalPrivateAuthResult>;
  listPrivateVideos(): Promise<LocalPrivateVideoItem[]>;
  deletePrivateVideo(input: { id: string }): Promise<{ success: boolean }>;
  copyPrivateVideoToPublicGallery(input: { id: string }): Promise<LocalPrivateCopyToPublicResult>;
  pickAndImportVideoToPrivateVault(): Promise<LocalPrivateImportResult>;
  makeVideoPublic(input: { id: string }): Promise<{ success: boolean; uri?: string; code?: string; message?: string }>;
  preparePrivatePlayback(input: { id: string; traceId?: string }): Promise<{ success: boolean; tempUri?: string; mimeType?: string; streaming?: boolean }>;
  setSecureScreen(input: { enabled: boolean }): Promise<{ success: boolean }>;
  clearPrivatePlaybackCache(): Promise<void>;
  renamePrivateVideo(input: { id: string; title: string }): Promise<LocalPrivateRenameResult>;
  getPrivateThumbnailUri(input: { id: string }): Promise<LocalPrivateThumbnailUriResult>;
  listVaultTags(): Promise<PrivateVaultTag[]>;
  createVaultTag(input: { name: string; color?: string }): Promise<PrivateVaultTag>;
  renameVaultTag(input: { id: string; name: string }): Promise<PrivateVaultTag>;
  setVaultTagColor(input: { id: string; color: string }): Promise<PrivateVaultTag>;
  deleteVaultTag(input: { id: string }): Promise<PrivateVaultTagDeleteResult>;
  setVaultEntryTags(input: { ids: string[]; tagIds: string[] }): Promise<{ success: boolean; updatedCount?: number }>;
  listVaultFolders(): Promise<PrivateVaultFolder[]>;
  createVaultFolder(input: { name: string }): Promise<PrivateVaultFolder>;
  renameVaultFolder(input: { id: string; name: string }): Promise<PrivateVaultFolder>;
  deleteVaultFolder(input: { id: string }): Promise<PrivateVaultFolderDeleteResult>;
  setVaultEntryFolder(input: { ids: string[]; folderId: string | null }): Promise<{ success: boolean; updatedCount?: number }>;
  startPrivateVaultMigration(): Promise<LocalPrivateMigrationStartResult>;
  cancelPrivateVaultMigration(): Promise<LocalPrivateMigrationCancelResult>;
  getPrivateVaultMigrationStatus(): Promise<LocalPrivateMigrationStatus>;
  getVaultDiagnostics(): Promise<LocalVaultDiagnostics>;
  isSoundsSupported(): boolean;
  listSounds(): Promise<LocalSoundsLibrary>;
  importSounds(): Promise<LocalSoundsImportResult>;
  deleteSounds(input: { ids: string[] }): Promise<{ deletedCount: number }>;
  renameSound(input: { id: string; title: string }): Promise<LocalSound>;
  getSoundThumbnail(input: { id: string }): Promise<{ path: string | null }>;
  listSoundPlaylists(): Promise<LocalSoundPlaylist[]>;
  createSoundPlaylist(input: { name: string }): Promise<LocalSoundPlaylist>;
  renameSoundPlaylist(input: { id: string; name: string }): Promise<LocalSoundPlaylist>;
  deleteSoundPlaylist(input: { id: string }): Promise<{ success: boolean }>;
  setSoundPlaylistSongs(input: { id: string; songIds: string[] }): Promise<LocalSoundPlaylist>;
  addSoundsToPlaylists(input: { songIds: string[]; playlistIds: string[] }): Promise<{ success: boolean }>;
  removeSoundsFromPlaylist(input: { playlistId: string; songIds: string[] }): Promise<LocalSoundPlaylist>;
  setSoundsFavorite(input: { songIds: string[]; favorite: boolean }): Promise<LocalSoundPlaylist>;
  importCookie(input: { platform: LocalPlatform; uri: string; profileName: string }): Promise<{ profileName: string; path: string }>;
  listCookieProfiles(platform: LocalPlatform): Promise<LocalCookieProfile[]>;
  setCookieDefault(input: { platform: LocalPlatform; profileName: string }): Promise<{ success: boolean }>;
  deleteCookieProfile(input: { platform: LocalPlatform; profileName: string }): Promise<{ success: boolean }>;
  getCookieDefaults(): Promise<Record<LocalPlatform, string | null>>;
  importCustomCookie(input: LocalCustomCookieImportInput): Promise<LocalCustomCookieImportResult>;
  listCustomDomains(): Promise<LocalCustomDomainSummary[]>;
  listCustomDomainProfiles(domain: string): Promise<LocalCustomDomainProfile[]>;
  setCustomDomainDefault(input: { domain: string; profileName: string }): Promise<{ success: boolean }>;
  deleteCustomDomainProfile(input: { domain: string; profileName: string }): Promise<{ success: boolean }>;
  getDiagnostics(): Promise<LocalDiagnostics>;
  getDownloadFailureLogs(): Promise<LocalDownloadFailureLog[]>;
  runImpersonationSelfTest(): Promise<LocalImpersonationSelfTestResult>;
  saveToMediaStore(input: LocalSaveToMediaStoreInput): Promise<LocalSaveToMediaStoreResult>;
  getYtDlpUpdateStatus(): Promise<LocalYtDlpUpdateStatus>;
  checkYtDlpUpdate(): Promise<LocalYtDlpUpdateCheckResult>;
  updateYtDlp(): Promise<LocalYtDlpUpdateResult>;
  clearYtDlpOverride(): Promise<{ success: boolean; requiresRestart?: boolean }>;
};

const unsupported = (): never => {
  throw new Error('Local downloader native module is available on Android development builds only.');
};

const NativeLocalDownloader: LocalDownloaderNativeModule = Platform.OS === 'android'
  ? requireNativeModule<LocalDownloaderNativeModule>('LocalDownloader')
  : {
      startDownload: async () => unsupported(),
      getTaskStatus: async () => unsupported(),
      cancelTask: async () => unsupported(),
      getBackgroundState: async () => unsupported(),
      ensureBackgroundPermission: async () => unsupported(),
      setBackgroundDownloadsEnabled: async () => unsupported(),
      setStickyNotificationEnabled: async () => unsupported(),
      startQuickDownloadFromClipboard: async () => unsupported(),
      startQuickDownloadWithUrl: async () => unsupported(),
      getPrivateModeState: async () => unsupported(),
      setPrivateModeEnabled: async () => unsupported(),
      getAudioModeState: async () => unsupported(),
      setAudioModeEnabled: async () => unsupported(),
      authenticatePrivateAccess: async () => unsupported(),
      listPrivateVideos: async () => unsupported(),
      deletePrivateVideo: async () => unsupported(),
      copyPrivateVideoToPublicGallery: async () => unsupported(),
      pickAndImportVideoToPrivateVault: async () => unsupported(),
      makeVideoPublic: async () => unsupported(),
      preparePrivatePlayback: async () => unsupported(),
      setSecureScreen: async () => unsupported(),
      clearPrivatePlaybackCache: async () => unsupported(),
      renamePrivateVideo: async () => unsupported(),
      getPrivateThumbnailUri: async () => unsupported(),
      listVaultTags: async () => unsupported(),
      createVaultTag: async () => unsupported(),
      renameVaultTag: async () => unsupported(),
      setVaultTagColor: async () => unsupported(),
      deleteVaultTag: async () => unsupported(),
      setVaultEntryTags: async () => unsupported(),
      listVaultFolders: async () => unsupported(),
      createVaultFolder: async () => unsupported(),
      renameVaultFolder: async () => unsupported(),
      deleteVaultFolder: async () => unsupported(),
      setVaultEntryFolder: async () => unsupported(),
      startPrivateVaultMigration: async () => unsupported(),
      cancelPrivateVaultMigration: async () => unsupported(),
      getPrivateVaultMigrationStatus: async () => unsupported(),
      getVaultDiagnostics: async () => unsupported(),
      isSoundsSupported: () => false,
      listSounds: async () => unsupported(),
      importSounds: async () => unsupported(),
      deleteSounds: async () => unsupported(),
      renameSound: async () => unsupported(),
      getSoundThumbnail: async () => unsupported(),
      listSoundPlaylists: async () => unsupported(),
      createSoundPlaylist: async () => unsupported(),
      renameSoundPlaylist: async () => unsupported(),
      deleteSoundPlaylist: async () => unsupported(),
      setSoundPlaylistSongs: async () => unsupported(),
      addSoundsToPlaylists: async () => unsupported(),
      removeSoundsFromPlaylist: async () => unsupported(),
      setSoundsFavorite: async () => unsupported(),
      importCookie: async () => unsupported(),
      listCookieProfiles: async () => unsupported(),
      setCookieDefault: async () => unsupported(),
      deleteCookieProfile: async () => unsupported(),
      getCookieDefaults: async () => unsupported(),
      importCustomCookie: async () => unsupported(),
      listCustomDomains: async () => unsupported(),
      listCustomDomainProfiles: async () => unsupported(),
      setCustomDomainDefault: async () => unsupported(),
      deleteCustomDomainProfile: async () => unsupported(),
      getDiagnostics: async () => unsupported(),
      getDownloadFailureLogs: async () => unsupported(),
      runImpersonationSelfTest: async () => unsupported(),
      saveToMediaStore: async () => unsupported(),
      getYtDlpUpdateStatus: async () => unsupported(),
      checkYtDlpUpdate: async () => unsupported(),
      updateYtDlp: async () => unsupported(),
      clearYtDlpOverride: async () => unsupported(),
    };
const emitter: any = Platform.OS === 'android' ? new EventEmitter(NativeLocalDownloader as never) : null;

export function addDownloadProgressListener(listener: (event: LocalDownloadEvent) => void): EventSubscription {
  if (!emitter) {
    return { remove: () => undefined };
  }
  return emitter.addListener('downloadProgress', listener);
}

export function addBackgroundStateListener(listener: (event: LocalBackgroundStateEvent) => void): EventSubscription {
  if (!emitter) {
    return { remove: () => undefined };
  }
  return emitter.addListener('backgroundStateChanged', listener);
}

export function addYtDlpUpdateProgressListener(listener: (event: LocalYtDlpUpdateProgressEvent) => void): EventSubscription {
  if (!emitter) {
    return { remove: () => undefined };
  }
  return emitter.addListener('ytDlpUpdateProgress', listener);
}

export function addPrivateVaultMigrationProgressListener(
  listener: (event: LocalPrivateMigrationProgress) => void
): EventSubscription {
  if (!emitter) {
    return { remove: () => undefined };
  }
  return emitter.addListener('privateVaultMigrationProgress', listener);
}

export default NativeLocalDownloader;

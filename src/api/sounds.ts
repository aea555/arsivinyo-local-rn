import { Platform } from 'react-native';
import LocalDownloaderModule, {
  type LocalSound,
  type LocalSoundPlaylist,
  type LocalSoundsImportResult,
  type LocalSoundsLibrary,
} from '../native/localDownloader';

function ensureAndroid(): void {
  if (Platform.OS !== 'android') {
    throw new Error('The music library is Android-only in this release.');
  }
}

/**
 * Whether the on-device music library is usable. Requires scoped storage
 * (Android 10 / API 29+), since tracks live in the public Music/Arsivinyo folder
 * and are accessed via the MediaStore owner model (no broad storage permission).
 */
export function isLocalSoundsSupported(): boolean {
  if (Platform.OS !== 'android') return false;
  try {
    return LocalDownloaderModule.isSoundsSupported();
  } catch {
    return false;
  }
}

export async function listLocalSounds(): Promise<LocalSoundsLibrary> {
  ensureAndroid();
  return LocalDownloaderModule.listSounds();
}

/** Opens a multi-select audio picker (SAF) and imports the chosen files. */
export async function importLocalSounds(): Promise<LocalSoundsImportResult> {
  ensureAndroid();
  if (__DEV__) console.log('[sounds-import] → native importSounds()');
  try {
    const result = await LocalDownloaderModule.importSounds();
    if (__DEV__) {
      console.log('[sounds-import] ← native result', {
        success: result.success,
        importedCount: result.importedCount,
        failedCount: result.failedCount,
        songs: result.songs?.length,
        code: result.code,
        message: result.message,
        failures: result.failures,
      });
    }
    return result;
  } catch (e) {
    if (__DEV__) console.warn('[sounds-import] native importSounds() threw', e);
    throw e;
  }
}

export async function deleteLocalSounds(ids: string[]): Promise<{ deletedCount: number }> {
  ensureAndroid();
  return LocalDownloaderModule.deleteSounds({ ids });
}

export async function renameLocalSound(id: string, title: string): Promise<LocalSound> {
  ensureAndroid();
  return LocalDownloaderModule.renameSound({ id, title });
}

export async function getLocalSoundThumbnail(id: string): Promise<string | null> {
  ensureAndroid();
  const result = await LocalDownloaderModule.getSoundThumbnail({ id });
  return result.path ?? null;
}

export async function listLocalSoundPlaylists(): Promise<LocalSoundPlaylist[]> {
  ensureAndroid();
  return LocalDownloaderModule.listSoundPlaylists();
}

export async function createLocalSoundPlaylist(name: string): Promise<LocalSoundPlaylist> {
  ensureAndroid();
  return LocalDownloaderModule.createSoundPlaylist({ name });
}

export async function renameLocalSoundPlaylist(id: string, name: string): Promise<LocalSoundPlaylist> {
  ensureAndroid();
  return LocalDownloaderModule.renameSoundPlaylist({ id, name });
}

export async function deleteLocalSoundPlaylist(id: string): Promise<{ success: boolean }> {
  ensureAndroid();
  return LocalDownloaderModule.deleteSoundPlaylist({ id });
}

/** Replace a playlist's ordered membership (used for in-playlist reordering). */
export async function setLocalSoundPlaylistSongs(id: string, songIds: string[]): Promise<LocalSoundPlaylist> {
  ensureAndroid();
  return LocalDownloaderModule.setSoundPlaylistSongs({ id, songIds });
}

/** Add songs to one or more playlists (union-merge, preserves existing order). */
export async function addLocalSoundsToPlaylists(
  songIds: string[],
  playlistIds: string[]
): Promise<{ success: boolean }> {
  ensureAndroid();
  return LocalDownloaderModule.addSoundsToPlaylists({ songIds, playlistIds });
}

export async function removeLocalSoundsFromPlaylist(
  playlistId: string,
  songIds: string[]
): Promise<LocalSoundPlaylist> {
  ensureAndroid();
  return LocalDownloaderModule.removeSoundsFromPlaylist({ playlistId, songIds });
}

/** Add or remove songs from the special, non-deletable Favorites playlist. */
export async function setLocalSoundsFavorite(
  songIds: string[],
  favorite: boolean
): Promise<LocalSoundPlaylist> {
  ensureAndroid();
  return LocalDownloaderModule.setSoundsFavorite({ songIds, favorite });
}

/** Reserved id of the Favorites playlist (mirrors the native constant). */
export const FAVORITES_PLAYLIST_ID = 'favorites';

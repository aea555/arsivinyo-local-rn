import { File } from 'expo-file-system';
import * as MediaLibrary from 'expo-media-library';
import { Platform } from 'react-native';
import LocalDownloaderModule from '../native/localDownloader';

/**
 * Download status callback
 */
export type DownloadProgressCallback = (progress: {
  totalBytesWritten: number;
  totalBytesExpectedToWrite: number;
}) => void;

/**
 * Save a locally-downloaded file to device media library.
 */
export async function downloadAndSaveFile(
  localFilePath: string,
  filename: string,
  onProgress?: DownloadProgressCallback
): Promise<{ uri: string; assetId?: string }> {
  const sourcePath = localFilePath.startsWith('file://') ? localFilePath.slice(7) : localFilePath;
  const normalizedPath = sourcePath.startsWith('file://') ? sourcePath : `file://${sourcePath}`;
  const file = new File(normalizedPath);

  if (!file.exists) {
    throw new Error(`Local file not found: ${normalizedPath}`);
  }

  if (!file.size || file.size <= 0) {
    throw new Error('Local file is empty');
  }

  const fileSize = file.size;
  try {
    const nativeSaveToMediaStore = (LocalDownloaderModule as Partial<typeof LocalDownloaderModule>).saveToMediaStore;
    if (Platform.OS === 'android' && typeof nativeSaveToMediaStore === 'function') {
      const saved = await nativeSaveToMediaStore({
        filePath: sourcePath,
        filename,
        dateTakenMs: Date.now(),
      });

      if (onProgress) {
        onProgress({
          totalBytesWritten: fileSize,
          totalBytesExpectedToWrite: fileSize,
        });
      }

      return {
        uri: saved.uri,
        assetId: saved.assetId,
      };
    }

    const asset = await MediaLibrary.createAssetAsync(normalizedPath);

    if (onProgress) {
      onProgress({
        totalBytesWritten: fileSize,
        totalBytesExpectedToWrite: fileSize,
      });
    }

    return {
      uri: asset.uri,
      assetId: asset.id,
    };
  } finally {
    try {
      file.delete();
    } catch (error) {
      console.warn('[FileManager] Temp file cleanup failed:', error);
    }
  }
}

export async function getFileInfo(uri: string): Promise<{
  exists: boolean;
  size?: number;
  isDirectory?: boolean;
}> {
  try {
    const normalized = uri.startsWith('file://') ? uri : `file://${uri}`;
    const file = new File(normalized);
    return {
      exists: file.exists,
      size: file.size ?? undefined,
      isDirectory: false,
    };
  } catch {
    return { exists: false };
  }
}

export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 B';

  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(1))} ${sizes[i]}`;
}

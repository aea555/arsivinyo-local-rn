export type LocalPlatform = 'youtube' | 'instagram' | 'facebook' | 'twitter' | 'reddit';

export interface LocalDownloadStartInput {
  url: string;
  cookieProfile?: string;
}

export interface LocalDownloadStartResult {
  taskId: string;
  estimatedSizeMb?: number | null;
}

export type LocalTaskStatus = 'PENDING' | 'STARTED' | 'PROGRESS' | 'SUCCESS' | 'FAILURE' | 'CANCELLED';

export interface LocalTaskStatusResult {
  taskId: string;
  status: LocalTaskStatus;
  filename?: string;
  filePath?: string;
  sizeMb?: number;
  errorCode?: string;
  errorMessage?: string;
  estimatedSizeMb?: number | null;
}

export interface LocalCookieProfile {
  profileName: string;
  path: string;
  lastModified: number;
}

export interface LocalDownloadEvent {
  taskId: string;
  status: LocalTaskStatus;
  state: 'starting' | 'downloading' | 'processing' | 'saving' | 'completed' | 'error';
  message?: string;
}

export interface LocalDiagnostics {
  ytDlpVersion: string;
  ffmpegPath: string | null;
  ffmpegExists: boolean;
  activeTaskId: string | null;
  lastErrors: string[];
}

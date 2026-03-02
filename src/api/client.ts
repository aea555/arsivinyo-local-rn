import type { ApiResponse } from './types';

const unsupported = <T>(): ApiResponse<T> => ({
  success: false,
  code: 'NETWORK_ERROR',
  status_code: 0,
  message: 'Remote API mode is disabled in local build.',
});

export async function apiGet<T>(_endpoint: string): Promise<ApiResponse<T>> {
  return unsupported<T>();
}

export async function apiPost<T, B = unknown>(_endpoint: string, _body: B): Promise<ApiResponse<T>> {
  return unsupported<T>();
}

export const getFileDownloadUrl = (_taskId: string): string => '';

export const getHeaders = (): Record<string, string> => ({
  'Content-Type': 'application/json',
});

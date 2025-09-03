/**
 * Installation stage tracking for ComfyUI Desktop
 * Provides detailed tracking of the installation process stages
 */
import { InstallStage } from '../constants';

type ValuesOf<T> = T[keyof T];

export type InstallStageName = ValuesOf<typeof InstallStage>;

export interface InstallStageInfo {
  stage: InstallStageName;
  progress: number; // 0-100
  message?: string;
  error?: string;
  timestamp: number;
}

/**
 * Helper to create install stage info
 */
export function createInstallStageInfo(
  stage: InstallStageName,
  options?: {
    progress?: number;
    message?: string;
    error?: string;
  }
): InstallStageInfo {
  return {
    stage,
    progress: options?.progress ?? 0,
    message: options?.message,
    error: options?.error,
    timestamp: Date.now(),
  };
}

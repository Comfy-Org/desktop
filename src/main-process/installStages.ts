/**
 * Installation stage tracking for ComfyUI Desktop
 * Provides detailed tracking of the installation process stages
 */
import { InstallStage } from '../constants';

export type InstallStageType = (typeof InstallStage)[keyof typeof InstallStage];

export interface InstallStageInfo {
  stage: InstallStageType;
  progress: number; // 0-100
  message?: string;
  error?: string;
  timestamp: number;
}

/**
 * Helper to create install stage info
 */
export function createInstallStageInfo(
  stage: InstallStageType,
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
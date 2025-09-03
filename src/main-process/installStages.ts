/**
 * Installation stage tracking for ComfyUI Desktop
 * Provides detailed tracking of the installation process stages
 */
import { InstallStage } from '../constants';

export type InstallStageType = (typeof InstallStage)[keyof typeof InstallStage];
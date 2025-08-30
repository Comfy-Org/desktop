/**
 * Installation stage tracking for ComfyUI Desktop
 * Provides detailed tracking of the installation process stages
 */

export const InstallStage = {
  // Initial stages
  IDLE: 'idle',
  APP_INITIALIZING: 'app_initializing',
  CHECKING_EXISTING_INSTALL: 'checking_existing_install',

  // Pre-installation checks
  HARDWARE_VALIDATION: 'hardware_validation',
  GIT_CHECK: 'git_check',

  // User interaction
  WELCOME_SCREEN: 'welcome_screen',
  INSTALL_OPTIONS_SELECTION: 'install_options_selection',

  // Installation process
  CREATING_DIRECTORIES: 'creating_directories',
  INITIALIZING_CONFIG: 'initializing_config',
  PYTHON_ENVIRONMENT_SETUP: 'python_environment_setup',
  INSTALLING_REQUIREMENTS: 'installing_requirements',
  MIGRATING_CUSTOM_NODES: 'migrating_custom_nodes',

  // Validation stages
  VALIDATION_IN_PROGRESS: 'validation_in_progress',
  VALIDATION_BASEPATH: 'validation_basepath',
  VALIDATION_VENV: 'validation_venv',
  VALIDATION_PYTHON: 'validation_python',
  VALIDATION_UV: 'validation_uv',
  VALIDATION_PACKAGES: 'validation_packages',
  VALIDATION_GIT: 'validation_git',
  VALIDATION_VCREDIST: 'validation_vcredist',

  // Post-installation
  MAINTENANCE_MODE: 'maintenance_mode',
  STARTING_SERVER: 'starting_server',
  READY: 'ready',
  ERROR: 'error',
} as const;

export type InstallStageType = (typeof InstallStage)[keyof typeof InstallStage];

export interface InstallStageInfo {
  stage: InstallStageType;
  progress?: number; // 0-100
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
    progress: options?.progress,
    message: options?.message,
    error: options?.error,
    timestamp: Date.now(),
  };
}

/**
 * Get human-readable name for install stage
 */
export function getInstallStageName(stage: InstallStageType): string {
  const stageNames: Record<InstallStageType, string> = {
    [InstallStage.IDLE]: 'Idle',
    [InstallStage.APP_INITIALIZING]: 'Initializing Application',
    [InstallStage.CHECKING_EXISTING_INSTALL]: 'Checking Existing Installation',
    [InstallStage.HARDWARE_VALIDATION]: 'Validating Hardware',
    [InstallStage.GIT_CHECK]: 'Checking Git Installation',
    [InstallStage.WELCOME_SCREEN]: 'Welcome Screen',
    [InstallStage.INSTALL_OPTIONS_SELECTION]: 'Selecting Installation Options',
    [InstallStage.CREATING_DIRECTORIES]: 'Creating Directories',
    [InstallStage.INITIALIZING_CONFIG]: 'Initializing Configuration',
    [InstallStage.PYTHON_ENVIRONMENT_SETUP]: 'Setting up Python Environment',
    [InstallStage.INSTALLING_REQUIREMENTS]: 'Installing Requirements',
    [InstallStage.MIGRATING_CUSTOM_NODES]: 'Migrating Custom Nodes',
    [InstallStage.VALIDATION_IN_PROGRESS]: 'Validating Installation',
    [InstallStage.VALIDATION_BASEPATH]: 'Validating Base Path',
    [InstallStage.VALIDATION_VENV]: 'Validating Virtual Environment',
    [InstallStage.VALIDATION_PYTHON]: 'Validating Python Interpreter',
    [InstallStage.VALIDATION_UV]: 'Validating UV Package Manager',
    [InstallStage.VALIDATION_PACKAGES]: 'Validating Python Packages',
    [InstallStage.VALIDATION_GIT]: 'Validating Git',
    [InstallStage.VALIDATION_VCREDIST]: 'Validating Visual C++ Redistributable',
    [InstallStage.MAINTENANCE_MODE]: 'Maintenance Mode',
    [InstallStage.STARTING_SERVER]: 'Starting Server',
    [InstallStage.READY]: 'Ready',
    [InstallStage.ERROR]: 'Error',
  };

  return stageNames[stage] || stage;
}

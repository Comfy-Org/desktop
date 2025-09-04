export const IPC_CHANNELS = {
  LOADING_PROGRESS: 'loading-progress',
  IS_PACKAGED: 'is-packaged',
  RENDERER_READY: 'renderer-ready',
  RESTART_APP: 'restart-app',
  REINSTALL: 'reinstall',
  QUIT: 'quit',
  LOG_MESSAGE: 'log-message',
  DOWNLOAD_PROGRESS: 'download-progress',
  START_DOWNLOAD: 'start-download',
  PAUSE_DOWNLOAD: 'pause-download',
  RESUME_DOWNLOAD: 'resume-download',
  CANCEL_DOWNLOAD: 'cancel-download',
  DELETE_MODEL: 'delete-model',
  GET_ALL_DOWNLOADS: 'get-all-downloads',
  GET_ELECTRON_VERSION: 'get-electron-version',
  GET_BASE_PATH: 'get-base-path',
  SET_BASE_PATH: 'set-base-path',
  GET_MODEL_CONFIG_PATH: 'get-model-config-path',
  OPEN_PATH: 'open-path',
  OPEN_LOGS_PATH: 'open-logs-path',
  OPEN_DEV_TOOLS: 'open-dev-tools',
  TERMINAL_WRITE: 'execute-terminal-command',
  TERMINAL_RESIZE: 'resize-terminal',
  TERMINAL_RESTORE: 'restore-terminal',
  TERMINAL_ON_OUTPUT: 'terminal-output',
  GET_SYSTEM_PATHS: 'get-system-paths',
  VALIDATE_INSTALL_PATH: 'validate-install-path',
  VALIDATE_COMFYUI_SOURCE: 'validate-comfyui-source',
  SHOW_DIRECTORY_PICKER: 'show-directory-picker',
  INSTALL_COMFYUI: 'install-comfyui',
  CHANGE_THEME: 'change-theme',
  SHOW_CONTEXT_MENU: 'show-context-menu',
  RESTART_CORE: 'restart-core',
  GET_GPU: 'get-gpu',
  SET_WINDOW_STYLE: 'set-window-style',
  GET_VALIDATION_STATE: 'get-validation-state',
  VALIDATION_UPDATE: 'validation-update',
  COMPLETE_VALIDATION: 'complete-validation',
  CANCEL_VALIDATION: 'cancel-validation',
  VALIDATE_INSTALLATION: 'start-validation',
  UV_INSTALL_REQUIREMENTS: 'uv-install-requirements',
  GET_WINDOW_STYLE: 'get-window-style',
  TRACK_EVENT: 'track-event',
  SET_METRICS_CONSENT: 'set-metrics-consent',
  INCREMENT_USER_PROPERTY: 'increment-user-property',
  UV_CLEAR_CACHE: 'uv-clear-cache',
  UV_RESET_VENV: 'uv-delete-venv',
  CAN_ACCESS_URL: 'can-access-url',
  START_TROUBLESHOOTING: 'start-troubleshooting',
  DISABLE_CUSTOM_NODES: 'disable-custom-nodes',
  CHECK_FOR_UPDATES: 'check-for-updates',
  RESTART_AND_INSTALL: 'restart-and-install',
  CHECK_BLACKWELL: 'check-blackwell',
  GET_INSTALL_STAGE: 'get-install-stage',
  INSTALL_STAGE_UPDATE: 'install-stage-update',
} as const;

export enum ProgressStatus {
  /**
   * Initial state, after the app has started.
   */
  INITIAL_STATE = 'initial-state',
  /**
   * Setting up Python Environment.
   */
  PYTHON_SETUP = 'python-setup',
  /**
   * Starting ComfyUI server.
   */
  STARTING_SERVER = 'starting-server',
  /**
   * Ending state.
   * The ComfyUI server successfully started. ComfyUI loaded into the main window.
   */
  READY = 'ready',
  /**
   * Ending state. General error state.
   */
  ERROR = 'error',
}

export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

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
  INSTALLING_PYTORCH: 'installing_pytorch',
  INSTALLING_COMFYUI_REQUIREMENTS: 'installing_comfyui_requirements',
  INSTALLING_MANAGER_REQUIREMENTS: 'installing_manager_requirements',
  MIGRATING_CUSTOM_NODES: 'migrating_custom_nodes',

  // Post-installation
  MAINTENANCE_MODE: 'maintenance_mode',
  STARTING_SERVER: 'starting_server',
  READY: 'ready',
  ERROR: 'error',
} as const;

export const ELECTRON_BRIDGE_API = 'electronAPI';

export const SENTRY_URL_ENDPOINT =
  'https://942cadba58d247c9cab96f45221aa813@o4507954455314432.ingest.us.sentry.io/4508007940685824';

export interface MigrationItem {
  id: string;
  label: string;
  description: string;
}

export const MigrationItems: MigrationItem[] = [
  {
    id: 'user_files',
    label: 'User Files',
    description: 'Settings and user-created workflows',
  },
  {
    id: 'models',
    label: 'Models',
    description: 'Reference model files from existing ComfyUI installations. (No copy)',
  },
  {
    id: 'custom_nodes',
    label: 'Custom Nodes',
    description: 'Reinstall custom nodes from existing ComfyUI installations.',
  },
] as const;

export interface ServerArgs {
  /** The host to use for the ComfyUI server. */
  listen: string;
  /** The port to use for the ComfyUI server. */
  port: string;
  /** Extra arguments to pass to the ComfyUI server. */
  [key: string]: string | number;
}
export const DEFAULT_SERVER_ARGS: ServerArgs = {
  listen: '127.0.0.1',
  port: '8000',
};

export enum DownloadStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  PAUSED = 'paused',
  ERROR = 'error',
  CANCELLED = 'cancelled',
}

/** Python package index URLs to use when installing torch, torchvision, and torchaudio. */
export enum TorchMirrorUrl {
  /** Regular PyPI index URL. */
  Default = 'https://pypi.org/simple/',
  /** PyTorch CUDA mirror. */
  Cuda = 'https://download.pytorch.org/whl/cu129',
  /** PyTorch Nightly CUDA mirror. */
  NightlyCuda = 'https://download.pytorch.org/whl/nightly/cu129',
  /** PyTorch nightly CPU mirror. */
  NightlyCpu = 'https://download.pytorch.org/whl/nightly/cpu',
}

/** @deprecated Use {@link TorchMirrorUrl} instead. */
export const CUDA_TORCH_URL = TorchMirrorUrl.Cuda;
/** @deprecated Use {@link TorchMirrorUrl} instead. */
export const NIGHTLY_CPU_TORCH_URL = TorchMirrorUrl.NightlyCpu;
/** @deprecated Use {@link TorchMirrorUrl} instead. */
export const DEFAULT_PYPI_INDEX_URL = TorchMirrorUrl.Default;

/** The log files used by the desktop process. */
export enum LogFile {
  /** The ComfyUI server log file. */
  ComfyUI = 'comfyui.log',
  /** The desktop process log file. */
  Main = 'main.log',
}

export const IPC_CHANNELS = {
  LOADING_PROGRESS: 'loading-progress',
  IS_PACKAGED: 'is-packaged',
  RENDERER_READY: 'renderer-ready',
  RESTART_APP: 'restart-app',
  REINSTALL: 'reinstall',
  LOG_MESSAGE: 'log-message',
  OPEN_DIALOG: 'open-dialog',
  DOWNLOAD_PROGRESS: 'download-progress',
  START_DOWNLOAD: 'start-download',
  PAUSE_DOWNLOAD: 'pause-download',
  RESUME_DOWNLOAD: 'resume-download',
  CANCEL_DOWNLOAD: 'cancel-download',
  DELETE_MODEL: 'delete-model',
  GET_ALL_DOWNLOADS: 'get-all-downloads',
  GET_ELECTRON_VERSION: 'get-electron-version',
  SEND_ERROR_TO_SENTRY: 'send-error-to-sentry',
  GET_BASE_PATH: 'get-base-path',
  GET_MODEL_CONFIG_PATH: 'get-model-config-path',
  OPEN_PATH: 'open-path',
  OPEN_LOGS_PATH: 'open-logs-path',
  OPEN_DEV_TOOLS: 'open-dev-tools',
  TERMINAL_WRITE: 'execute-terminal-command',
  TERMINAL_RESIZE: 'resize-terminal',
  TERMINAL_RESTORE: 'restore-terminal',
  TERMINAL_ON_OUTPUT: 'terminal-output',
  IS_FIRST_TIME_SETUP: 'is-first-time-setup',
  GET_SYSTEM_PATHS: 'get-system-paths',
  VALIDATE_INSTALL_PATH: 'validate-install-path',
  VALIDATE_COMFYUI_SOURCE: 'validate-comfyui-source',
  SHOW_DIRECTORY_PICKER: 'show-directory-picker',
  INSTALL_COMFYUI: 'install-comfyui',
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

export const ProgressMessages = {
  [ProgressStatus.INITIAL_STATE]: 'Loading...',
  [ProgressStatus.PYTHON_SETUP]: 'Setting up Python Environment...',
  [ProgressStatus.STARTING_SERVER]: 'Starting ComfyUI server...',
  [ProgressStatus.READY]: 'Finishing...',
  [ProgressStatus.ERROR]:
    'Was not able to start ComfyUI. Please check the logs for more details. You can open it from the Help menu. Please report issues to: https://forum.comfy.org',
} as const;

export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

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
  // TODO: Decide whether we want to auto-migrate custom nodes, and install their dependencies.
  // huchenlei: This is a very essential thing for migration experience.
  // {
  //   id: 'custom_nodes',
  //   label: 'Custom Nodes',
  //   description: 'Reference custom node files from existing ComfyUI installations. (No copy)',
  // },
] as const;

export const DEFAULT_SERVER_ARGS = {
  /** The host to use for the ComfyUI server. */
  host: '127.0.0.1',
  /** The port to use for the ComfyUI server. */
  port: 8000,
  // Extra arguments to pass to the ComfyUI server.
  extraServerArgs: {} as Record<string, string | boolean>,
};

export type ServerArgs = typeof DEFAULT_SERVER_ARGS;

export enum DownloadStatus {
  PENDING = 'pending',
  IN_PROGRESS = 'in_progress',
  COMPLETED = 'completed',
  PAUSED = 'paused',
  ERROR = 'error',
  CANCELLED = 'cancelled',
}

export const IPC_CHANNELS = {
  LOADING_PROGRESS: 'loading-progress',
  IS_PACKAGED: 'is-packaged',
  RENDERER_READY: 'renderer-ready',
  RESTART_APP: 'restart-app',
  REINSTALL: 'reinstall',
  LOG_MESSAGE: 'log-message',
  SHOW_SELECT_DIRECTORY: 'show-select-directory',
  SELECTED_DIRECTORY: 'selected-directory',
  OPEN_DIALOG: 'open-dialog',
  FIRST_TIME_SETUP_COMPLETE: 'first-time-setup-complete',
  DEFAULT_INSTALL_LOCATION: 'default-install-location',
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
  OPEN_FORUM: 'open-forum',
  TERMINAL_WRITE: "execute-terminal-command",
  TERMINAL_RESIZE: "resize-terminal",
  TERMINAL_RESTORE: "restore-terminal",
  TERMINAL_ON_OUTPUT: 'terminal-output',
  IS_FIRST_TIME_SETUP: 'is-first-time-setup',
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
  /**
   * Error state. Installation path does not exist.
   */
  ERROR_INSTALL_PATH = 'error-install-path',
}

export const ProgressMessages = {
  [ProgressStatus.INITIAL_STATE]: 'Loading...',
  [ProgressStatus.PYTHON_SETUP]: 'Setting up Python Environment...',
  [ProgressStatus.STARTING_SERVER]: 'Starting ComfyUI server...',
  [ProgressStatus.READY]: 'Finishing...',
  [ProgressStatus.ERROR]:
    'Was not able to start ComfyUI. Please check the logs for more details. You can open it from the Help menu. Please report issues to: https://forum.comfy.org',
  [ProgressStatus.ERROR_INSTALL_PATH]: 'Installation path does not exist. Please reset the installation location.',
} as const;

export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const ELECTRON_BRIDGE_API = 'electronAPI';

export const SENTRY_URL_ENDPOINT =
  'https://942cadba58d247c9cab96f45221aa813@o4507954455314432.ingest.us.sentry.io/4508007940685824';

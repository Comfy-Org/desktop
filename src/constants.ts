export const IPC_CHANNELS = {
  LOADING_PROGRESS: 'loading-progress',
  IS_PACKAGED: 'is-packaged',
  RENDERER_READY: 'renderer-ready',
  RESTART_APP: 'restart-app',
  LOG_MESSAGE: 'log-message',
  SHOW_SELECT_DIRECTORY: 'show-select-directory',
  SELECTED_DIRECTORY: 'selected-directory',
  OPEN_DIALOG: 'open-dialog',
  FIRST_TIME_SETUP_COMPLETE: 'first-time-setup-complete',
  DEFAULT_INSTALL_LOCATION: 'default-install-location',
  GET_PRELOAD_SCRIPT: 'get-preload-script',
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
} as const;

export const COMFY_ERROR_MESSAGE =
  'Was not able to start ComfyUI. Please check the logs for more details. You can open it from the Help menu. Please report issues to: https://forum.comfy.org';

export const COMFY_FINISHING_MESSAGE = 'Finishing...';

export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const ELECTRON_BRIDGE_API = 'electronAPI';

export const SENTRY_URL_ENDPOINT =
  'https://942cadba58d247c9cab96f45221aa813@o4507954455314432.ingest.us.sentry.io/4508007940685824';

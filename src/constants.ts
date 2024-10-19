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
  GET_LOGS: 'get-logs',
  GET_COMFYUI_URL: 'get-comfyui-url',
  TOGGLE_LOGS: 'toggle-logs',
  COMFYUI_READY: 'comfyui-ready',
} as const;

export const COMFY_ERROR_MESSAGE =
  'Was not able to start ComfyUI. Please check the logs for more details. You can open it from the tray icon.';

export const COMFY_FINISHING_MESSAGE = 'Finishing...';

export type IPCChannel = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

export const ELECTRON_BRIDGE_API = 'electronAPI';

export const SENTRY_URL_ENDPOINT =
  'https://942cadba58d247c9cab96f45221aa813@o4507954455314432.ingest.us.sentry.io/4508007940685824';

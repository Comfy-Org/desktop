import { app } from 'electron';
import log from 'electron-log/main';

/**
 * Reads environment variables and provides a simple interface for development overrides.
 *
 * In production, overrides are disabled (`undefined`).  Use the `--dev-mode` command line argument to re-enable them.
 */
export class DevOverrides {
  /** The host to use for the ComfyUI server. */
  public readonly COMFY_HOST?: string;
  /** The port to use for the ComfyUI server. */
  public readonly COMFY_PORT?: string;
  /** Forces the Desktop UI to be loaded from this URL (e.g. vite dev server). */
  public readonly DEV_SERVER_URL?: string;
  /** Loads the ComfyUI frontend from this URL (e.g. vite dev server). */
  public readonly DEV_COMFY_URL?: string;
  /** Whether to use an external server instead of starting one locally. */
  public readonly USE_EXTERNAL_SERVER?: string;
  /** When DEV_SERVER_URL is set, whether to automatically open dev tools on app start. */
  public readonly DEV_TOOLS_AUTO?: string;
  /** Send events to Sentry */
  public readonly SENTRY_ENABLED?: string;

  constructor() {
    if (app.commandLine.hasSwitch('dev-mode') || !app.isPackaged) {
      log.info('Developer environment variable overrides enabled.');

      this.DEV_SERVER_URL = process.env.DEV_SERVER_URL;
      this.DEV_COMFY_URL = process.env.DEV_COMFY_URL;
      this.COMFY_HOST = process.env.COMFY_HOST;
      this.COMFY_PORT = process.env.COMFY_PORT;
      this.USE_EXTERNAL_SERVER = process.env.USE_EXTERNAL_SERVER;
      this.DEV_TOOLS_AUTO = process.env.DEV_TOOLS_AUTO;
      this.SENTRY_ENABLED = process.env.SENTRY_ENABLED;
    }
  }

  get useExternalServer() {
    return this.USE_EXTERNAL_SERVER === 'true';
  }
}

import { app, dialog, shell } from 'electron';
import fs from 'fs/promises';
import log from 'electron-log/main';
import path from 'node:path';

type RequireProperties<T, K extends keyof T> = Omit<T, K> & Required<Pick<T, K>>;

type MessageBoxOptions = RequireProperties<Electron.MessageBoxOptions, 'buttons' | 'defaultId' | 'cancelId'>;

export class InstallationValidator {
  /**
   * Shows a dialog box with an option to open the problematic file in the native shell file viewer.
   * @param options The options paramter of {@link dialog.showMessageBox}, filled with defaults for invalid config
   * @returns
   */
  static async showInvalidFileAndQuit(file: string, options: MessageBoxOptions): Promise<void> {
    const defaults: Partial<Electron.MessageBoxOptions> = {
      title: 'Invalid file',
      type: 'error',
      buttons: ['Open the &directory and quit', '&Quit'],
      defaultId: 0,
      cancelId: 1,
      normalizeAccessKeys: true,
    };
    const opt = Object.assign(defaults, options);

    const result = await dialog.showMessageBox(opt);

    // Try show the file in file manager
    if (result.response === 0) {
      try {
        const parsed = path.parse(file);
        log.debug(`Attempting to open containing directory: ${parsed.dir}`);
        await fs.access(file);
        shell.showItemInFolder(file);
      } catch {
        log.warn(`Could not access file whilst attempting to exit gracefully after a critical error.`, file);
        try {
          // Failed - try the parent dir
          const parsed = path.parse(file);
          await fs.access(parsed.dir);
          await shell.openPath(parsed.dir);
        } catch {
          // Nothing works.  Log, notify, quit.
          log.error(
            `Could not read directory containing file, whilst attempting to exit gracefully after a critical error.`
          );
          dialog.showErrorBox(
            'Unable to fine file',
            `Unable to find the file.  Please navigate to it manually:\n\n${file}`
          );
        }
      }
    }

    app.quit();
    // Wait patiently for graceful termination.
    await new Promise(() => {});
  }
}

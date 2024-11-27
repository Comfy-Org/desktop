import { app, dialog, shell } from 'electron';

export class InstallationValidator {
  /**
   * Shows a dialog box with an option to open the problematic file in the native shell file viewer.
   * @param options The options paramter of {@link dialog.showMessageBox}, filled with defaults for invalid config
   * @returns
   */
  static async showInvalidFileAndQuit(file: string, options: Electron.MessageBoxOptions): Promise<void> {
    const defaults: Electron.MessageBoxOptions = {
      // Message must be set by caller.
      message: `Was unable to read the file shown below.  It could be missing, inaccessible, or corrupt.\n\n${file}`,
      title: 'Invalid file',
      type: 'error',
      buttons: ['Locate the &file (then quit)', '&Quit'],
      defaultId: 0,
      cancelId: 1,
      normalizeAccessKeys: true,
    };
    const opt = Object.assign(defaults, options);

    const result = await dialog.showMessageBox(opt);

    if (result.response === 0) shell.showItemInFolder(file);
    app.quit();
    // Wait patiently for graceful termination.
    await new Promise(() => {});
  }
}

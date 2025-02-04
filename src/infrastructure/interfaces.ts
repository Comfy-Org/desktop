export interface FatalErrorOptions {
  /** The message to display to the user.  Also used for logging if {@link logMessage} is not set. */
  message: string;
  /** The {@link Error} to log. */
  error?: unknown;
  /** The title of the error message box. */
  title?: string;
  /** If set, this replaces the {@link message} for logging. */
  logMessage?: string;
  /** The exit code to use when the app is exited. Default: 2 */
  exitCode?: number;
}

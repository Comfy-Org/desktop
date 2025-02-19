/**
 * An error that occurs when the app starts.
 */
export class AppStartError extends Error {
  constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = 'AppStartError';
  }
}

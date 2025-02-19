/** Generic error that should only be thrown if the app cannot continue executing. */
export class FatalError extends Error {
  private constructor(message: string, cause?: Error) {
    super(message, { cause });
    this.name = 'FatalError';
  }

  /**
   * Static factory. Ensures the error is a subclass of Error - returns the original error if it is.
   * @param error The unknown error that was caught (try/catch).
   * @returns A FatalError with the cause set, if the error is an instance of Error.
   */
  static wrapIfGeneric(error: unknown): FatalError | Error {
    // Return the original error if it's not a generic Error
    if (error instanceof Error) {
      return error.name !== 'Error' ? error : new FatalError(error.message, error);
    }
    return new FatalError(String(error));
  }
}

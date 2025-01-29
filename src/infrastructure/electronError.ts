/**
 * An original error thrown by the electron API.
 * @see {@link ElectronError}
 */
type RawElectronError = Error & Pick<ElectronError, 'errno' | 'code' | 'url'>;

/**
 * A strongly-typed error object created from a thrown Electron error.
 * @see {@link ElectronError.fromCaught} for usage.
 */
export class ElectronError extends Error {
  /** Electron error number */
  readonly errno: number;
  /** Electron error code */
  readonly code: string;
  /** URL of the page associated with the error. */
  readonly url?: string;

  private constructor(error: RawElectronError) {
    super(error.message, { cause: error });
    this.errno = error.errno;
    this.code = error.code;
    this.url = error.url;
  }

  /**
   * Static factory. If possible, creates an strongly-typed ElectronError from an unknown error.
   * @param error The error object to create an ElectronError from.
   * @returns A strongly-typed electron error if the error object is an instance of Error and has the required properties, otherwise `undefined`.
   */
  static fromCaught(error: unknown): ElectronError | undefined {
    return this.isRawError(error) ? new ElectronError(error) : undefined;
  }

  /**
   * Checks if the error was a generic Chromium `ERR_FAILED` error.
   * @returns `true` if the error is a generic Chromium error, otherwise `false`.
   */
  isGenericChromiumError(): boolean {
    return this.code === 'ERR_FAILED' && this.errno === -2 && typeof this.url === 'string';
  }

  /**
   * Type guard. Confirms {@link error} is an {@link Error}, `errno`, and `code` properties.
   * @param error The error object to check.
   * @returns `true` if the error is a raw Electron error, otherwise `false`.
   */
  private static isRawError(error: unknown): error is RawElectronError {
    return (
      error instanceof Error &&
      'errno' in error &&
      'code' in error &&
      typeof error.errno === 'number' &&
      typeof error.code === 'string'
    );
  }
}

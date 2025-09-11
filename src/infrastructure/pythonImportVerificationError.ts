/** Error thrown when Python import verification fails in the virtual environment. */
export class PythonImportVerificationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PythonImportVerificationError';
  }
}

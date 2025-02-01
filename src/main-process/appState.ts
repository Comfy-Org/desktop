import { app } from 'electron';

/**
 * Stores global state for the app.
 *
 * @see {@link AppState}
 */
export interface IAppState {
  /** Whether the app is already quitting. */
  readonly isQuitting: boolean;
}

/**
 * Concrete implementation of {@link IAppState}.
 */
export class AppState implements IAppState {
  isQuitting = false;

  constructor() {
    // Store quitting state - suppresses errors when already quitting
    app.once('before-quit', () => {
      this.isQuitting = true;
    });
  }
}

import { app } from 'electron';

import type { Page } from '@/infrastructure/interfaces';

/**
 * Stores global state for the app.
 *
 * @see {@link AppState}
 */
export interface IAppState {
  /** Whether the app is already quitting. */
  readonly isQuitting: boolean;
  /** The last page the app loaded from the desktop side. @see {@link AppWindow.loadPage} */
  currentPage?: Page;
}

/**
 * Concrete implementation of {@link IAppState}.
 */
export class AppState implements IAppState {
  isQuitting = false;
  currentPage?: Page;

  constructor() {
    // Store quitting state - suppresses errors when already quitting
    app.once('before-quit', () => {
      this.isQuitting = true;
    });
  }
}

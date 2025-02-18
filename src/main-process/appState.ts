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
  /** Whether the pre-start IPC handlers have been loaded. */
  readonly hasIpcHandlers: boolean;
  /** The last page the app loaded from the desktop side. @see {@link AppWindow.loadPage} */
  currentPage?: Page;

  /** Updates state - IPC handlers have been registered. */
  setHasIpcHandlers(): void;
}

/**
 * Concrete implementation of {@link IAppState}.
 */
export class AppState implements IAppState {
  isQuitting = false;
  hasIpcHandlers = false;
  currentPage?: Page;

  constructor() {
    // Store quitting state - suppresses errors when already quitting
    app.once('before-quit', () => {
      this.isQuitting = true;
    });
  }

  setHasIpcHandlers(): void {
    this.hasIpcHandlers = true;
  }
}

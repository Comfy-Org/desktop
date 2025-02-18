import { app } from 'electron';
import { EventEmitter } from 'node:events';

import type { Page } from '@/infrastructure/interfaces';

/** App event names */
type AppStateEvents = {
  /** Occurs once, immediately before registering IPC handlers. */
  ipcRegistered: [];
  /** Occurs once, immediately after the ComfyUI server has finished loading. */
  loaded: [];
};

/**
 * Stores global state for the app.
 *
 * @see {@link AppState}
 */
export interface IAppState extends Pick<EventEmitter<AppStateEvents>, 'on' | 'once' | 'off'> {
  /** Whether the app is already quitting. */
  readonly isQuitting: boolean;
  /** Whether the pre-start IPC handlers have been loaded. */
  readonly ipcRegistered: boolean;
  /** Whether the app has loaded. */
  readonly loaded: boolean;
  /** The last page the app loaded from the desktop side. @see {@link AppWindow.loadPage} */
  currentPage?: Page;

  /** Updates state - IPC handlers have been registered. */
  emitIpcRegistered(): void;
  /** Updates state - the app has loaded. */
  emitLoaded(): void;
}

/**
 * Concrete implementation of {@link IAppState}.
 */
export class AppState extends EventEmitter<AppStateEvents> implements IAppState {
  isQuitting = false;
  ipcRegistered = false;
  loaded = false;
  currentPage?: Page;

  constructor() {
    super();

    // Store quitting state - suppresses errors when already quitting
    app.once('before-quit', () => {
      this.isQuitting = true;
    });

    this.once('loaded', () => {
      this.loaded = true;
    });
    this.once('ipcRegistered', () => {
      this.ipcRegistered = true;
    });
  }

  emitIpcRegistered() {
    if (!this.ipcRegistered) this.emit('ipcRegistered');
  }

  emitLoaded() {
    if (!this.loaded) this.emit('loaded');
  }
}

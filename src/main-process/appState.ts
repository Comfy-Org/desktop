import { app } from 'electron';
import { EventEmitter } from 'node:events';

import { AppStartError } from '@/infrastructure/appStartError';
import type { Page } from '@/infrastructure/interfaces';
import { getUVState } from '@/uv-parser/uv-state';
import type { IUVState } from '@/uv-parser/uv-state-interfaces';

import type { InstallStageInfo } from './installStages';

/** App event names */
type AppStateEvents = {
  /** Occurs once, immediately before registering IPC handlers. */
  ipcRegistered: [];
  /** Occurs once, immediately after the ComfyUI server has finished loading. */
  loaded: [];
  /** Occurs when the installation stage changes */
  installStageChanged: [InstallStageInfo];
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
  /** UV process state manager for tracking package installations. */
  readonly uvState: IUVState;
  /** The current installation stage information */
  installStage?: InstallStageInfo;

  /** Updates state - IPC handlers have been registered. */
  emitIpcRegistered(): void;
  /** Updates state - the app has loaded. */
  emitLoaded(): void;
  /** Updates the installation stage */
  setInstallStage(stage: InstallStageInfo): void;
}

/**
 * Concrete implementation of {@link IAppState}.
 */
class AppState extends EventEmitter<AppStateEvents> implements IAppState {
  isQuitting = false;
  ipcRegistered = false;
  loaded = false;
  currentPage?: Page;
  readonly uvState: IUVState;
  installStage?: InstallStageInfo;

  constructor() {
    super();
    // Initialize UV state
    this.uvState = getUVState();
  }

  initialize() {
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

  setInstallStage(stage: InstallStageInfo) {
    this.installStage = stage;
    this.emit('installStageChanged', stage);
  }
}

const appState = new AppState();
let initialized = false;

/**
 * Initializes the app state singleton.
 * @throws {AppStartError} if called more than once.
 */
export function initializeAppState(): void {
  if (initialized) throw new AppStartError('AppState already initialized');
  appState.initialize();
  initialized = true;
}

/**
 * Returns the app state singleton.
 * @see {@link initializeAppState}
 * @throws {AppStartError} if {@link initializeAppState} is not called first.
 */
export function useAppState(): IAppState {
  if (!initialized) throw new AppStartError('AppState not initialized');
  return appState;
}

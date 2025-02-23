import { app } from 'electron';
import { test as baseTest, beforeEach, describe, expect, vi } from 'vitest';

import type { Page } from '@/infrastructure/interfaces';

// Clear global mock
vi.unmock('@/main-process/appState');

type AppStateModule = typeof import('@/main-process/appState');

const test = baseTest.extend<AppStateModule & { imported: AppStateModule }>({
  imported: async ({}, use) => {
    const imported = await import('@/main-process/appState');
    await use(imported);
    vi.resetModules();
  },
  initializeAppState: async ({ imported }, use) => {
    const { initializeAppState } = imported;
    await use(initializeAppState);
  },
  useAppState: async ({ imported }, use) => {
    const { useAppState } = imported;
    await use(useAppState);
  },
});

describe('AppState initialization', () => {
  test('should initialize app state successfully', ({ initializeAppState }) => {
    expect(initializeAppState).not.toThrow();
    expect(app.once).toHaveBeenCalledWith('before-quit', expect.any(Function));
  });

  test('should throw error when initializing multiple times', ({ initializeAppState }) => {
    initializeAppState();
    expect(initializeAppState).toThrowErrorMatchingInlineSnapshot('[AppStartError: AppState already initialized]');
  });

  test('should throw error when using uninitialized app state', ({ useAppState }) => {
    expect(useAppState).toThrowErrorMatchingInlineSnapshot('[AppStartError: AppState not initialized]');
  });
});

describe('AppState management', () => {
  beforeEach<AppStateModule>(({ initializeAppState }) => {
    initializeAppState();
  });

  test('should have correct initial state', ({ useAppState }) => {
    const state = useAppState();
    expect(state.isQuitting).toBe(false);
    expect(state.ipcRegistered).toBe(false);
    expect(state.loaded).toBe(false);
    expect(state.currentPage).toBeUndefined();
  });

  test('should update isQuitting state when app is quitting', ({ useAppState }) => {
    const quitHandler = vi.mocked(app.once).mock.calls[0][1] as () => void;
    const state = useAppState();

    expect(state.isQuitting).toBe(false);
    quitHandler();
    expect(state.isQuitting).toBe(true);
  });

  test('should emit and update ipcRegistered state', ({ useAppState }) => {
    const state = useAppState();
    const listener = vi.fn();

    state.once('ipcRegistered', listener);
    expect(state.ipcRegistered).toBe(false);

    state.emitIpcRegistered();
    expect(listener).toHaveBeenCalled();
    expect(state.ipcRegistered).toBe(true);

    // Should not emit again if already registered
    state.emitIpcRegistered();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('should emit and update loaded state', ({ useAppState }) => {
    const state = useAppState();
    const listener = vi.fn();

    state.once('loaded', listener);
    expect(state.loaded).toBe(false);

    state.emitLoaded();
    expect(listener).toHaveBeenCalled();
    expect(state.loaded).toBe(true);

    // Should not emit again if already loaded
    state.emitLoaded();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('should allow setting and getting currentPage', ({ useAppState }) => {
    const state = useAppState();
    const testPage: Page = 'desktop-start';

    expect(state.currentPage).toBeUndefined();
    state.currentPage = testPage;
    expect(state.currentPage).toBe(testPage);
  });
});

describe('AppState event handling', () => {
  beforeEach<AppStateModule>(({ initializeAppState }) => {
    initializeAppState();
  });

  test('should allow adding and removing event listeners', ({ useAppState }) => {
    const state = useAppState();
    const listener = vi.fn();

    state.on('loaded', listener);
    state.emitLoaded();
    expect(listener).toHaveBeenCalled();

    state.off('loaded', listener);
    state.emitLoaded();
    expect(listener).toHaveBeenCalledTimes(1);
  });

  test('should handle once listeners correctly', ({ useAppState }) => {
    const state = useAppState();
    const listener = vi.fn();

    state.once('ipcRegistered', listener);
    state.emitIpcRegistered();
    state.emitIpcRegistered();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});

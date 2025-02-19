import { app } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Page } from '@/infrastructure/interfaces';
import { initializeAppState, useAppState } from '@/main-process/appState';

vi.unmock('@/main-process/appState');

// Mock electron app
vi.mock('electron', () => ({
  app: {
    once: vi.fn(),
  },
}));

describe('AppState', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Reset module state between tests
    vi.resetModules();
  });

  describe('initialization', () => {
    it('should initialize app state successfully', () => {
      expect(() => initializeAppState()).not.toThrow();
      expect(app.once).toHaveBeenCalledWith('before-quit', expect.any(Function));
    });

    it('should throw error when initializing multiple times', async () => {
      const { initializeAppState } = await import('@/main-process/appState');
      initializeAppState();
      expect(initializeAppState).toThrowErrorMatchingInlineSnapshot('[AppStartError: AppState already initialized]');
    });

    it('should throw error when using uninitialized app state', async () => {
      const { useAppState } = await import('@/main-process/appState');
      expect(useAppState).toThrowErrorMatchingInlineSnapshot('[AppStartError: AppState not initialized]');
    });
  });

  describe('state management', () => {
    it('should have correct initial state', () => {
      const state = useAppState();
      expect(state.isQuitting).toBe(false);
      expect(state.ipcRegistered).toBe(false);
      expect(state.loaded).toBe(false);
      expect(state.currentPage).toBeUndefined();
    });

    it('should update isQuitting state when app is quitting', async () => {
      const { initializeAppState, useAppState } = await import('@/main-process/appState');
      initializeAppState();

      const quitHandler = vi.mocked(app.once).mock.calls[0][1] as () => void;
      const state = useAppState();

      expect(state.isQuitting).toBe(false);
      quitHandler();
      expect(state.isQuitting).toBe(true);
    });

    it('should emit and update ipcRegistered state', () => {
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

    it('should emit and update loaded state', () => {
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

    it('should allow setting and getting currentPage', () => {
      const state = useAppState();
      const testPage: Page = 'desktop-start';

      expect(state.currentPage).toBeUndefined();
      state.currentPage = testPage;
      expect(state.currentPage).toBe(testPage);
    });
  });

  describe('event handling', () => {
    it('should allow adding and removing event listeners', async () => {
      const { initializeAppState, useAppState } = await import('@/main-process/appState');
      initializeAppState();

      const state = useAppState();
      const listener = vi.fn();

      state.on('loaded', listener);
      state.emitLoaded();
      expect(listener).toHaveBeenCalled();

      state.off('loaded', listener);
      state.emitLoaded();
      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should handle once listeners correctly', async () => {
      const { initializeAppState, useAppState } = await import('@/main-process/appState');
      initializeAppState();

      const state = useAppState();
      const listener = vi.fn();

      state.once('ipcRegistered', listener);
      state.emitIpcRegistered();
      state.emitIpcRegistered();
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });
});

import { vi } from 'vitest';

vi.mock('electron-log/main');

vi.mock('@/main-process/appState', () => ({
  initializeAppState: vi.fn(),
  useAppState: vi.fn().mockReturnValue({
    initialize: vi.fn(),
    isQuitting: false,
    ipcRegistered: false,
    loaded: false,
    currentPage: undefined,
    emitIpcRegistered: vi.fn(),
    emitLoaded: vi.fn(),
  }),
}));

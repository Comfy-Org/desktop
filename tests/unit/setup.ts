import type { FileTransport, MainLogger, MainTransports } from 'electron-log';
import log from 'electron-log/main';
import { beforeEach, vi } from 'vitest';

import { ComfySettings } from '@/config/comfySettings';
import type { IAppState } from '@/main-process/appState';
import type { ITelemetry } from '@/services/telemetry';

// Shared setup - run once before each test file

/** I find this deeply mocking. */
export type PartialMock<T> = { -readonly [K in keyof T]?: PartialMock<T[K]> };

// Logging
vi.mock('electron-log/main');

vi.mocked(log.create).mockReturnValue({
  transports: {
    file: {
      transforms: [],
    } as unknown as FileTransport,
  } as unknown as MainTransports,
} as unknown as MainLogger & { default: MainLogger });

/** Partially mocks Electron API, but guarantees a few properties are non-null. */
type ElectronMock = PartialMock<typeof Electron> & {
  app: Partial<Electron.App>;
  dialog: Partial<Electron.Dialog>;
  ipcMain: Partial<Electron.IpcMain>;
};

export const quitMessage = /^Test exited via app\.quit\(\)$/;

export const electronMock: ElectronMock = {
  app: {
    isPackaged: true,
    quit: vi.fn(() => {
      throw new Error('Test exited via app.quit()');
    }),
    exit: vi.fn(() => {
      throw new Error('Test exited via app.exit()');
    }),
    getPath: vi.fn(() => '/mock/app/path'),
    getAppPath: vi.fn(() => '/mock/app/path'),
    relaunch: vi.fn(),
    getVersion: vi.fn(() => '1.0.0'),
    on: vi.fn(),
    once: vi.fn(),
    dock: {
      show: vi.fn().mockResolvedValue(undefined),
      hide: vi.fn(),
      bounce: vi.fn(),
      cancelBounce: vi.fn(),
      downloadFinished: vi.fn(),
      getBadge: vi.fn(),
      setBadge: vi.fn(),
      getMenu: vi.fn(),
      setMenu: vi.fn(),
      setIcon: vi.fn(),
    } as any,
  },
  dialog: {
    showErrorBox: vi.fn(),
    showMessageBox: vi.fn(),
    showOpenDialog: vi.fn(),
  },
  ipcMain: {
    on: vi.fn(),
    once: vi.fn(),
    handle: vi.fn(),
    handleOnce: vi.fn(),
    removeHandler: vi.fn(),
  },
};

// Electron
vi.mock('electron', () => electronMock);

// App State
const appState: PartialMock<IAppState> = {
  isQuitting: false,
  ipcRegistered: false,
  loaded: false,
  currentPage: undefined,
  emitIpcRegistered: vi.fn(),
  emitLoaded: vi.fn(),
};
vi.mock('@/main-process/appState', () => ({
  initializeAppState: vi.fn(),
  useAppState: vi.fn(() => appState),
}));

// Sentry & Telemetry
const mockTelemetry: ITelemetry = {
  track: vi.fn(),
  hasConsent: true,
  loadGenerationCount: vi.fn(),
  flush: vi.fn(),
  registerHandlers: vi.fn(),
};
vi.mock('@/services/sentry');
vi.mock('@/services/telemetry', async () => {
  const actual = await vi.importActual<typeof import('@/services/telemetry')>('@/services/telemetry');

  return {
    ...actual,
    getTelemetry: vi.fn(() => mockTelemetry),
    promptMetricsConsent: vi.fn().mockResolvedValue(true),
  };
});

// Initialize ComfySettings for tests
beforeEach(async () => {
  await ComfySettings.load('/test/path');
});

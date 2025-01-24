import { BrowserWindow } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppWindow } from '@/main-process/appWindow';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  app: {
    // Required if process.resourcesPath is not mocked
    isPackaged: false,
    on: vi.fn(),
  },
  ipcMain: {
    on: vi.fn(),
    handle: vi.fn(),
  },
  nativeTheme: {
    shouldUseDarkColors: true,
  },
  Menu: {
    buildFromTemplate: vi.fn(),
    getApplicationMenu: vi.fn(() => null),
  },
  Tray: vi.fn(() => ({
    setContextMenu: vi.fn(),
    setToolTip: vi.fn(),
    on: vi.fn(),
  })),
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      workAreaSize: { width: 1024, height: 768 },
    })),
  },
}));

vi.mock('electron-store', () => ({
  default: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

vi.mock('electron-log/main', () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

vi.mock('@/store/desktopConfig', () => ({
  useDesktopConfig: vi.fn().mockReturnValue({
    get: vi.fn().mockImplementation((key) => {
      if (key === 'installState') return 'installed';
    }),
    set: vi.fn().mockReturnValue(true),
  }),
}));

describe('AppWindow.isOnPage', () => {
  let appWindow: AppWindow;
  let mockWebContents: Pick<Electron.WebContents, 'getURL' | 'setWindowOpenHandler'>;

  beforeEach(() => {
    mockWebContents = {
      getURL: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };

    vi.mocked(BrowserWindow).mockImplementation(
      () =>
        ({
          webContents: mockWebContents,
          on: vi.fn(),
          once: vi.fn(),
        }) as unknown as BrowserWindow
    );

    appWindow = new AppWindow();
  });

  it('should handle file protocol URLs with hash correctly', () => {
    vi.mocked(mockWebContents.getURL).mockReturnValue('file:///path/to/index.html#welcome');
    expect(appWindow.isOnPage('welcome')).toBe(true);
  });

  it('should handle http protocol URLs correctly', () => {
    vi.mocked(mockWebContents.getURL).mockReturnValue('http://localhost:3000/welcome');
    expect(appWindow.isOnPage('welcome')).toBe(true);
  });

  it('should handle empty pages correctly', () => {
    vi.mocked(mockWebContents.getURL).mockReturnValue('file:///path/to/index.html');
    expect(appWindow.isOnPage('')).toBe(true);
  });

  it('should return false for non-matching pages', () => {
    vi.mocked(mockWebContents.getURL).mockReturnValue('file:///path/to/index.html#welcome');
    expect(appWindow.isOnPage('desktop-start')).toBe(false);
  });

  it('should handle URLs with no hash or path', () => {
    vi.mocked(mockWebContents.getURL).mockReturnValue('http://localhost:3000');
    expect(appWindow.isOnPage('')).toBe(true);
  });

  it('should handle URLs with query parameters', () => {
    vi.mocked(mockWebContents.getURL).mockReturnValue('http://localhost:3000/server-start?param=value');
    expect(appWindow.isOnPage('server-start')).toBe(true);
  });

  it('should handle file URLs with both hash and query parameters', () => {
    vi.mocked(mockWebContents.getURL).mockReturnValue('file:///path/to/index.html?param=value#welcome');
    expect(appWindow.isOnPage('welcome')).toBe(true);
  });
});

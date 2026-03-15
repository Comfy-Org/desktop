import { BrowserWindow, type Tray, dialog } from 'electron';
import fs from 'node:fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { IPC_CHANNELS } from '@/constants';
import { AppWindow } from '@/main-process/appWindow';

import { type PartialMock, electronMock } from '../setup';

const additionalMocks: PartialMock<typeof Electron> = {
  BrowserWindow: vi.fn() as PartialMock<BrowserWindow>,
  nativeTheme: {
    shouldUseDarkColors: true,
  },
  Menu: {
    buildFromTemplate: vi.fn(),
    getApplicationMenu: vi.fn(() => null),
  },
  Tray: vi.fn(() => ({
    setContextMenu: vi.fn(),
    setPressedImage: vi.fn(),
    setToolTip: vi.fn(),
    on: vi.fn(),
  })) as PartialMock<Tray>,
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      workAreaSize: { width: 1024, height: 768 },
    })),
  },
};

Object.assign(electronMock, additionalMocks);

vi.mock('electron-store', () => ({
  default: vi.fn(() => ({
    get: vi.fn(),
    set: vi.fn(),
  })),
}));

vi.mock('@/store/desktopConfig', () => ({
  useDesktopConfig: vi.fn(() => ({
    get: vi.fn((key: string) => {
      if (key === 'installState') return 'installed';
    }),
    set: vi.fn(),
  })),
}));

describe('AppWindow.isOnPage', () => {
  let appWindow: AppWindow;
  let mockWebContents: Pick<Electron.WebContents, 'getURL' | 'setWindowOpenHandler'>;

  beforeEach(() => {
    mockWebContents = {
      getURL: vi.fn(),
      setWindowOpenHandler: vi.fn(),
    };

    vi.stubGlobal('process', {
      ...process,
      resourcesPath: '/mock/app/path/assets',
    });

    vi.mocked(BrowserWindow).mockImplementation(
      () =>
        ({
          webContents: mockWebContents,
          on: vi.fn(),
          once: vi.fn(),
          isMaximized: vi.fn(() => false),
          getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1024, height: 768 })),
        }) as unknown as BrowserWindow
    );

    appWindow = new AppWindow(undefined, undefined, false);
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

vi.mock('node:fs/promises', () => ({
  default: { access: vi.fn() },
  access: vi.fn(),
}));

describe('AppWindow.handleDeepLink', () => {
  let appWindow: AppWindow;
  let sendSpy: ReturnType<typeof vi.fn>;
  let mockIsMinimized: ReturnType<typeof vi.fn>;
  let mockRestore: ReturnType<typeof vi.fn>;
  let mockFocus: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    vi.stubGlobal('process', {
      ...process,
      resourcesPath: '/mock/app/path/assets',
    });

    mockIsMinimized = vi.fn(() => false);
    mockRestore = vi.fn();
    mockFocus = vi.fn();

    vi.mocked(BrowserWindow).mockImplementation(
      () =>
        ({
          webContents: {
            getURL: vi.fn(),
            setWindowOpenHandler: vi.fn(),
            isDestroyed: vi.fn(() => false),
            send: vi.fn(),
          },
          on: vi.fn(),
          once: vi.fn(),
          isMaximized: vi.fn(() => false),
          getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1024, height: 768 })),
          isDestroyed: vi.fn(() => false),
          isMinimized: mockIsMinimized,
          restore: mockRestore,
          focus: mockFocus,
        }) as unknown as BrowserWindow
    );

    appWindow = new AppWindow(undefined, undefined, false);
    sendSpy = vi.fn();
    vi.spyOn(appWindow, 'send').mockImplementation(sendSpy);
  });

  it('should send DEEP_LINK_OPEN IPC for a valid comfy://open URL with existing file', async () => {
    vi.mocked(fs.access).mockResolvedValue();

    await appWindow.handleDeepLink('comfy://open?file=/path/to/workflow.json');

    expect(sendSpy).toHaveBeenCalledWith(IPC_CHANNELS.DEEP_LINK_OPEN, '/path/to/workflow.json');
  });

  it('should not send IPC for an invalid URL', async () => {
    await appWindow.handleDeepLink('not-a-valid-url');

    expect(fs.access).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('should not send IPC for an unsupported action', async () => {
    await appWindow.handleDeepLink('comfy://install?file=/path/to/node.json');

    expect(fs.access).not.toHaveBeenCalled();
    expect(sendSpy).not.toHaveBeenCalled();
  });

  it('should not send IPC when file does not exist', async () => {
    vi.mocked(fs.access).mockRejectedValue(new Error('ENOENT'));

    await appWindow.handleDeepLink('comfy://open?file=/nonexistent/file.json');

    expect(sendSpy).not.toHaveBeenCalled();
    expect(dialog.showErrorBox).toHaveBeenCalledWith(
      'File Not Found',
      expect.stringContaining('/nonexistent/file.json')
    );
  });

  it('should focus the window when handling a valid deep link', async () => {
    vi.mocked(fs.access).mockResolvedValue();

    await appWindow.handleDeepLink('comfy://open?file=/path/to/workflow.json');

    expect(mockFocus).toHaveBeenCalled();
  });

  it('should restore and focus the window when minimized', async () => {
    vi.mocked(fs.access).mockResolvedValue();
    mockIsMinimized.mockReturnValue(true);

    await appWindow.handleDeepLink('comfy://open?file=/path/to/workflow.json');

    expect(mockRestore).toHaveBeenCalled();
    expect(mockFocus).toHaveBeenCalled();
  });
});

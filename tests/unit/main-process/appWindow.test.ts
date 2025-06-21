import { BrowserWindow, type Tray } from 'electron';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppWindow } from '@/main-process/appWindow';

import { type PartialMock, electronMock } from '../setup';

const mockAppState = {
  isQuitting: false,
};

vi.mock('@/main-process/appState', () => ({
  useAppState: vi.fn(() => mockAppState),
}));

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

describe('AppWindow tray behavior', () => {
  let mockWindow: PartialMock<BrowserWindow>;
  let windowCloseHandler: (event: Electron.Event) => void;

  beforeEach(() => {
    vi.clearAllMocks();
    mockAppState.isQuitting = false;

    mockWindow = {
      show: vi.fn(),
      hide: vi.fn(),
      on: vi.fn((event: string, handler: any) => {
        if (event === 'close') windowCloseHandler = handler;
      }),
      once: vi.fn(),
      webContents: { getURL: vi.fn(), setWindowOpenHandler: vi.fn() },
    };

    vi.mocked(BrowserWindow).mockImplementation(() => mockWindow as BrowserWindow);
  });

  it('should hide to tray when window closed and app not quitting', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32', resourcesPath: '/mock' });
    new AppWindow();
    const mockEvent = { preventDefault: vi.fn() };

    windowCloseHandler(mockEvent as any);

    expect(mockEvent.preventDefault).toHaveBeenCalled();
    expect(mockWindow.hide).toHaveBeenCalled();
  });

  it('should allow window close when app is quitting', () => {
    vi.stubGlobal('process', { ...process, platform: 'win32', resourcesPath: '/mock' });
    mockAppState.isQuitting = true;
    new AppWindow();
    const mockEvent = { preventDefault: vi.fn() };

    windowCloseHandler(mockEvent as any);

    expect(mockEvent.preventDefault).not.toHaveBeenCalled();
    expect(mockWindow.hide).not.toHaveBeenCalled();
  });

  describe('macOS dock behavior', () => {
    beforeEach(() => {
      vi.stubGlobal('process', { ...process, platform: 'darwin', resourcesPath: '/mock' });
      electronMock.app.dock = {
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
      } as any;
    });

    it('should hide dock when hiding window on macOS', () => {
      const appWindow = new AppWindow();

      appWindow.hide();

      expect(mockWindow.hide).toHaveBeenCalled();
      expect(electronMock.app.dock?.hide).toHaveBeenCalled();
    });

    it('should show dock when showing window on macOS', () => {
      const appWindow = new AppWindow();

      appWindow.show();

      expect(mockWindow.show).toHaveBeenCalled();
      expect(electronMock.app.dock?.show).toHaveBeenCalled();
    });

    it('should register activate handler for dock clicks on macOS', () => {
      new AppWindow();

      expect(electronMock.app.on).toHaveBeenCalledWith('activate', expect.any(Function));
    });
  });
});

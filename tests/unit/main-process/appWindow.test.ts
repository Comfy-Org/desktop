import { beforeEach, describe, expect, it, vi } from 'vitest';
import { BrowserWindow, dialog } from 'electron';
import fs from 'node:fs/promises';

import { AppWindow } from '../../../src/main-process/appWindow';
import { IPC_CHANNELS } from '../../../src/constants';

vi.mock('electron', () => ({
  BrowserWindow: vi.fn(),
  ipcMain: { on: vi.fn(), handle: vi.fn() },
  dialog: { showErrorBox: vi.fn() },
  screen: {
    getPrimaryDisplay: vi.fn(() => ({
      workAreaSize: { width: 1920, height: 1080 },
    })),
  },
}));

describe('AppWindow', () => {
  beforeEach(() => {
    vi.stubGlobal('process', {
      ...process,
      resourcesPath: '/mock/app/path/assets',
    });

    vi.mocked(BrowserWindow).mockImplementation(
      () =>
        ({
          webContents: {
            getURL: vi.fn(),
            setWindowOpenHandler: vi.fn(),
          },
          on: vi.fn(),
          once: vi.fn(),
          isMaximized: vi.fn(() => false),
          getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1024, height: 768 })),
        }) as unknown as BrowserWindow
    );
  });

  it('creates a BrowserWindow', () => {
    new AppWindow(undefined, undefined, false);
    expect(BrowserWindow).toHaveBeenCalled();
  });
});

describe('AppWindow popup handler', () => {
  let mockSetWindowOpenHandler: ReturnType<typeof vi.fn>;
  let windowOpenHandler: (details: { url: string }) => { action: string };

  beforeEach(() => {
    mockSetWindowOpenHandler = vi.fn((handler) => {
      windowOpenHandler = handler;
    });

    vi.stubGlobal('process', {
      ...process,
      resourcesPath: '/mock/app/path/assets',
    });

    vi.mocked(BrowserWindow).mockImplementation(
      () =>
        ({
          webContents: {
            getURL: vi.fn(),
            setWindowOpenHandler: mockSetWindowOpenHandler,
          },
          on: vi.fn(),
          once: vi.fn(),
          isMaximized: vi.fn(() => false),
          getBounds: vi.fn(() => ({ x: 0, y: 0, width: 1024, height: 768 })),
        }) as unknown as BrowserWindow
    );

    new AppWindow(undefined, undefined, false);
  });

  it('allows Firebase auth popup', () => {
    const result = windowOpenHandler({ url: 'https://dreamboothy.firebaseapp.com/__/auth/handler' });
    expect(result.action).toBe('allow');
  });

  it('allows checkout popup', () => {
    const result = windowOpenHandler({ url: 'https://checkout.comfy.org/session/abc123' });
    expect(result.action).toBe('allow');
  });

  it('allows Google accounts popup for passkey auth', () => {
    const result = windowOpenHandler({ url: 'https://accounts.google.com/o/oauth2/auth?client_id=abc' });
    expect(result.action).toBe('allow');
  });

  it('allows GitHub OAuth popup', () => {
    const result = windowOpenHandler({ url: 'https://github.com/login/oauth/authorize?client_id=abc' });
    expect(result.action).toBe('allow');
  });

  it('denies unknown URLs', () => {
    const result = windowOpenHandler({ url: 'https://evil.example.com/' });
    expect(result.action).toBe('deny');
  });

  it('strips preload script from allowed popups', () => {
    const result = windowOpenHandler({ url: 'https://accounts.google.com/o/oauth2/auth?client_id=abc' });
    expect(result).toEqual({
      action: 'allow',
      overrideBrowserWindowOptions: { webPreferences: { preload: undefined } },
    });
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

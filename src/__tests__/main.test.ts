import { expect, jest, describe, it } from '@jest/globals';
import { createWindow } from '../main';
import { BrowserWindow } from 'electron';

global.MAIN_WINDOW_VITE_DEV_SERVER_URL = 'http://localhost:5173';
global.MAIN_WINDOW_VITE_NAME = 'index.html';

jest.mock('node:path', () => ({
  join: jest.fn((...args) => {
    return 'preload.js';
  }),
}));

jest.mock('tar', () => ({
  extract: jest.fn(),
}));
jest.mock('axios');
jest.mock('fs');
jest.mock('node:fs/promises');
// Mock the entire electron module
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    isReady: true,
    on: jest.fn(),
    getPath: jest.fn(),
  },
  BrowserWindow: jest.fn().mockImplementation((options) => {
    return {
      loadURL: jest.fn(),
      on: jest.fn(),
      webContents: {
        openDevTools: jest.fn(),
      },
    };
  }),
  ipcMain: {
    on: jest.fn(),
    handle: jest.fn(),
  },
  screen: {
    getPrimaryDisplay: jest.fn().mockReturnValue({
      workAreaSize: { width: 1920, height: 1080 },
    }),
  },
  // Add this line to mock Tray
  Tray: jest.fn().mockImplementation(() => ({
    setToolTip: jest.fn(),
    setContextMenu: jest.fn(),
    on: jest.fn(),
    setPressedImage: jest.fn(),
  })),
  // Add this line to mock Menu
  Menu: {
    buildFromTemplate: jest.fn().mockReturnValue({
      items: [],
    }),
  },
  // Mock other Electron modules if necessary
}));

jest.mock('electron-log/main', () => ({
  initialize: jest.fn(),
  info: jest.fn(),
  error: jest.fn(),
  // Add other methods you might use from electron-log
}));

// Mock the update-electron-app module
jest.mock('update-electron-app', () => ({
  updateElectronApp: jest.fn(),
  UpdateSourceType: {
    StaticStorage: 'StaticStorage',
  },
}));

describe('createWindow', () => {
  it('should create a new BrowserWindow with correct options', async () => {
    const window = await createWindow();

    expect(BrowserWindow).toHaveBeenCalledWith(
      expect.objectContaining({
        title: 'ComfyUI',
        webPreferences: expect.objectContaining({
          preload: expect.stringContaining('preload.js'),
          nodeIntegration: true,
          contextIsolation: true,
        }),
        autoHideMenuBar: true,
      })
    );
    expect(window.loadURL).toHaveBeenCalled();
  });
});

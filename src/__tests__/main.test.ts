// src/__tests__/main.test.ts

import { describe, it } from 'node:test';
import { createWindow } from '../main';
import { BrowserWindow } from 'electron';

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

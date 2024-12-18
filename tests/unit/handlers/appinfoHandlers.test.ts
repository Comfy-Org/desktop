import { ipcMain } from 'electron';
import { AppInfoHandlers } from '../../../src/handlers/appInfoHandlers';
import { IPC_CHANNELS } from '../../../src/constants';

jest.mock('electron', () => ({
  ipcMain: {
    on: jest.fn(),
    handle: jest.fn(),
  },
}));

describe('AppInfoHandlers', () => {
  let handler: AppInfoHandlers;
  beforeEach(() => {
    handler = new AppInfoHandlers();
    handler.registerHandlers();
  });

  it('should register all expected handle channels', () => {
    const expectedChannels = [IPC_CHANNELS.IS_PACKAGED, IPC_CHANNELS.GET_ELECTRON_VERSION];

    for (const channel of expectedChannels) {
      expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    }
  });
});

import { ipcMain } from 'electron';
import { AppInfoHandlers } from '../../../src/handlers/appInfoHandlers';
import { IPC_CHANNELS } from '../../../src/constants';

jest.mock('electron', () => ({
  ipcMain: {
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
    const expectedChannels = [
      IPC_CHANNELS.IS_PACKAGED,
      IPC_CHANNELS.GET_ELECTRON_VERSION,
      IPC_CHANNELS.DEFAULT_INSTALL_LOCATION,
    ];

    expectedChannels.forEach((channel) => {
      expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    });
  });
});

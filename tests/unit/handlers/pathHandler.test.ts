import { ipcMain } from 'electron';

import { PathHandlers } from '../../../src/handlers/pathHandlers';
import { IPC_CHANNELS } from '../../../src/constants';

jest.mock('electron', () => ({
  ipcMain: {
    on: jest.fn(),
    handle: jest.fn(),
  },
}));

describe('PathHandlers', () => {
  let handler: PathHandlers;
  beforeEach(() => {
    handler = new PathHandlers();
    handler.registerHandlers();
  });

  it('should register all expected handle channels', () => {
    const expectedChannelsForHandle = [IPC_CHANNELS.GET_MODEL_CONFIG_PATH];

    for (const channel of expectedChannelsForHandle) {
      expect(ipcMain.handle).toHaveBeenCalledWith(channel, expect.any(Function));
    }
  });

  it('should register all expected on channels', () => {
    const expectedChannelsForOn = [IPC_CHANNELS.OPEN_LOGS_PATH, IPC_CHANNELS.OPEN_PATH];

    for (const channel of expectedChannelsForOn) {
      expect(ipcMain.on).toHaveBeenCalledWith(channel, expect.any(Function));
    }
  });
});

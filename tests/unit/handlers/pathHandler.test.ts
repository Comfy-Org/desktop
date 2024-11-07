import { ipcMain } from 'electron';

import { PathHandlers } from '../../../src/handlers/pathHandlers';
import { IPC_CHANNELS } from '../../../src/constants';

const isChannelRegistered = (channel: string): boolean => {
  // @ts-ignore - accessing private property for testing
  return ipcMain.listeners(channel).length > 0;
};

describe('IPC Handlers', () => {
  beforeEach(() => {
    // Clear all existing listeners before each test
    ipcMain.removeAllListeners();
  });
  describe('PathHandlers', () => {
    let handler: PathHandlers;
    beforeEach(() => {
      // Clear all existing listeners before each test
      ipcMain.removeAllListeners();
      handler = new PathHandlers();
      handler.registerHandlers();
    });

    it('should register all expected channels', () => {
      handler.registerHandlers();

      const expectedChannels = [
        IPC_CHANNELS.GET_MODEL_CONFIG_PATH,
        IPC_CHANNELS.GET_BASE_PATH,
        IPC_CHANNELS.OPEN_LOGS_PATH,
        IPC_CHANNELS.OPEN_PATH,
      ];

      expectedChannels.forEach((channel) => {
        expect(isChannelRegistered(channel)).toBe(true);
      });
    });
  });
});

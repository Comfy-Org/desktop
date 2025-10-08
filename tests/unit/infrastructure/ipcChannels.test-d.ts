import { describe, expectTypeOf, test } from 'vitest';

import { IPC_CHANNELS } from '@/constants';
import type { IpcChannels } from '@/infrastructure/ipcChannels';

type ChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

describe('IpcChannels type contract', () => {
  test('IpcChannels includes all channels from IPC_CHANNELS', () => {
    type MissingChannels = Exclude<ChannelName, keyof IpcChannels>;
    expectTypeOf<MissingChannels>().toEqualTypeOf<never>();
  });

  test('IpcChannels does not have extra channels not in IPC_CHANNELS', () => {
    type ExtraChannels = Exclude<keyof IpcChannels, ChannelName>;
    expectTypeOf<ExtraChannels>().toEqualTypeOf<never>();
  });

  test('All channels have params and return properties', () => {
    // Verify structure of each channel
    type AllChannelsValid = {
      [K in keyof IpcChannels]: IpcChannels[K] extends { params: unknown[]; return: unknown } ? true : never;
    };

    // This will error if any channel doesn't have the correct structure
    expectTypeOf<AllChannelsValid>().toMatchObjectType<Record<keyof IpcChannels, true>>();
  });
});

import { describe, expectTypeOf, test } from 'vitest';

import { IPC_CHANNELS } from '@/constants';
import type { IpcChannels } from '@/infrastructure/ipcChannels';

type ChannelName = (typeof IPC_CHANNELS)[keyof typeof IPC_CHANNELS];

describe('IpcChannels type contract', () => {
  test('IpcChannels includes all channels from IPC_CHANNELS', () => {
    // If this type check fails, it means a channel from IPC_CHANNELS is missing in IpcChannels
    type MissingChannels = Exclude<ChannelName, keyof IpcChannels>;
    expectTypeOf<MissingChannels>().toEqualTypeOf<never>();
  });

  test('IpcChannels does not have extra channels not in IPC_CHANNELS', () => {
    // If this type check fails, it means IpcChannels has a key that doesn't exist in IPC_CHANNELS
    type ExtraChannels = Exclude<keyof IpcChannels, ChannelName>;
    expectTypeOf<ExtraChannels>().toEqualTypeOf<never>();
  });

  test('All channels have params and return properties', () => {
    // Verify structure of each channel
    type AllChannelsValid = {
      [K in keyof IpcChannels]: IpcChannels[K] extends { params: unknown[]; return: unknown } ? true : never;
    };

    // This will error if any channel doesn't have the correct structure
    expectTypeOf<AllChannelsValid>().toMatchTypeOf<Record<keyof IpcChannels, true>>();
  });
});

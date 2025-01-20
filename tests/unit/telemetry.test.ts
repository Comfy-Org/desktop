import { IpcMainEvent, ipcMain } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { Mock, beforeEach, describe, expect, it, vi } from 'vitest';

import { MixpanelTelemetry, promptMetricsConsent } from '../../src/services/telemetry';
import { IPC_CHANNELS } from '/src/constants';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/user/data'),
    isPackaged: true,
  },
  ipcMain: {
    on: vi.fn(),
    once: vi.fn(),
    handleOnce: vi.fn(),
    removeHandler: vi.fn(),
  },
}));

vi.mock('fs');
vi.mock('mixpanel', () => ({
  default: {
    init: vi.fn(),
    track: vi.fn(),
    people: {
      increment: vi.fn(),
    },
  },
}));

describe('MixpanelTelemetry', () => {
  let telemetry: MixpanelTelemetry;
  const mockInitializedMixpanelClient = {
    track: vi.fn(),
    people: {
      set: vi.fn(),
      increment: vi.fn(),
    },
  };
  const mockMixpanelClient = {
    init: vi.fn().mockReturnValue(mockInitializedMixpanelClient),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('distinct ID management', () => {
    it('should read existing distinct ID from file', () => {
      const existingId = 'existing-uuid';
      vi.mocked(fs.existsSync).mockReturnValue(true);
      vi.mocked(fs.readFileSync).mockReturnValue(existingId);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      expect(fs.readFileSync).toHaveBeenCalledWith(path.join('/mock/user/data', 'telemetry.txt'), 'utf8');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should create new distinct ID if file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);

      expect(fs.writeFileSync).toHaveBeenCalled();
      const writtenId = vi.mocked(fs.writeFileSync).mock.calls[0][1] as string;
      expect(typeof writtenId).toBe('string');
      expect(writtenId.length).toBeGreaterThan(0);
    });
  });

  describe('event queueing and consent', () => {
    it('should queue events when consent is not given', () => {
      const eventName = 'test_event';
      const properties = { foo: 'bar' };
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      telemetry.track(eventName, properties);

      expect(telemetry['queue'].length).toBe(1);
      expect(telemetry['queue'][0].eventName).toBe(eventName);
      expect(telemetry['queue'][0].properties).toMatchObject({
        ...properties,
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        distinct_id: expect.any(String),
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        time: expect.any(Date),
      });
    });

    it('should flush queue when consent is given', () => {
      const eventName = 'test_event';
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      telemetry.track(eventName);

      // Simulate receiving consent
      const installOptionsHandler = vi.mocked(ipcMain.once).mock.calls[0][1];
      const mockIpcEvent = {} as IpcMainEvent;
      installOptionsHandler(mockIpcEvent, { allowMetrics: true });

      // Track a new event which should trigger flush
      telemetry.track('another_event');

      expect(telemetry['queue'].length).toBe(0);
      expect(mockInitializedMixpanelClient.track).toHaveBeenCalledTimes(2);
    });
  });

  describe('IPC event handling', () => {
    it('should handle INSTALL_COMFYUI event and update consent', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      const mockIpcEvent = {} as IpcMainEvent;
      const installOptionsHandler = vi.mocked(ipcMain.once).mock.calls[0][1];
      installOptionsHandler(mockIpcEvent, { allowMetrics: true });
      expect(telemetry.hasConsent).toBe(true);
    });

    it('should register ipc handler for TRACK_EVENT', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      telemetry.registerHandlers();

      expect(ipcMain.on).toHaveBeenCalledWith(IPC_CHANNELS.TRACK_EVENT, expect.any(Function));
    });

    it('should handle TRACK_EVENT messages', () => {
      // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      telemetry.registerHandlers();
      const trackEventHandler = vi.mocked(ipcMain.on).mock.calls[0][1];

      // Simulate receiving a track event
      const mockIpcEvent = {} as IpcMainEvent;
      trackEventHandler(mockIpcEvent, 'test_event', { foo: 'bar' });

      // Since consent is false by default, it should be queued
      expect(telemetry['queue'].length).toBe(1);
    });

    it('should register ipc handler for INCREMENT_USER_PROPERTY', () => {
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      telemetry.registerHandlers();

      expect(ipcMain.on).toHaveBeenCalledWith(IPC_CHANNELS.INCREMENT_USER_PROPERTY, expect.any(Function));
    });

    it('should handle INCREMENT_USER_PROPERTY messages', () => {
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      telemetry.registerHandlers();
      // Get the callback that was registered
      const [channel, callback] = (ipcMain.on as any).mock.calls.find(
        ([channel]: any) => channel === IPC_CHANNELS.INCREMENT_USER_PROPERTY
      );

      // Simulate IPC call
      callback({}, 'test_property', 5);

      // Verify mixpanel client was called correctly
      expect(mockInitializedMixpanelClient.people.increment).toHaveBeenCalledWith(
        telemetry['distinctId'],
        'test_property',
        5
      );
    });
  });
});

describe('MixpanelTelemetry', () => {
  it('should properly initialize mixpanel client', () => {
    // Create a mock mixpanel client
    const mockInitializedClient = { track: vi.fn(), people: { set: vi.fn() } };
    const mockMixpanelClient = {
      init: vi.fn().mockReturnValue(mockInitializedClient),
    };

    // Create telemetry instance with mock client
    // eslint-disable-next-line @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-explicit-any
    const telemetry = new MixpanelTelemetry(mockMixpanelClient as any);

    // Verify init was called
    expect(mockMixpanelClient.init).toHaveBeenCalled();

    // This will fail because the initialized client isn't being assigned
    expect(telemetry['mixpanelClient']).toBe(mockInitializedClient);
  });
});

describe('promptMetricsConsent', () => {
  let store: { get: Mock; set: Mock };
  let appWindow: { loadRenderer: Mock };
  let comfyDesktopApp: { comfySettings: { get: Mock; set: Mock; saveSettings: Mock } };

  const versionBeforeUpdate = '0.4.1';
  const versionAfterUpdate = '1.0.1';

  beforeEach(() => {
    vi.clearAllMocks();
    store = { get: vi.fn(), set: vi.fn() };
    appWindow = { loadRenderer: vi.fn() };
    comfyDesktopApp = { comfySettings: { get: vi.fn(), set: vi.fn(), saveSettings: vi.fn() } };
  });

  const runTest = async ({
    storeValue,
    settingsValue,
    expectedResult,
    mockConsent,
    promptUser,
  }: {
    storeValue: string | null | undefined;
    settingsValue: boolean | null | undefined;
    expectedResult: boolean;
    mockConsent?: boolean;
    promptUser?: boolean;
  }) => {
    store.get.mockReturnValue(storeValue);
    comfyDesktopApp.comfySettings.get.mockReturnValue(settingsValue);

    if (promptUser) {
      vi.mocked(ipcMain.handleOnce).mockImplementationOnce((channel, handler) => {
        if (channel === IPC_CHANNELS.SET_METRICS_CONSENT) {
          handler(null!, mockConsent);
        }
      });
    }

    // @ts-expect-error - store is a mock and doesn't implement all of DesktopConfig
    const result = await promptMetricsConsent(store, appWindow, comfyDesktopApp);
    expect(result).toBe(expectedResult);

    if (promptUser) ipcMain.removeHandler(IPC_CHANNELS.SET_METRICS_CONSENT);
  };

  it('should prompt for update if metrics were previously enabled', async () => {
    await runTest({
      storeValue: versionBeforeUpdate,
      settingsValue: true,
      expectedResult: true,
      mockConsent: true,
      promptUser: true,
    });
    expect(store.set).toHaveBeenCalled();
    expect(appWindow.loadRenderer).toHaveBeenCalledWith('metrics-consent');
    expect(ipcMain.handleOnce).toHaveBeenCalledWith(IPC_CHANNELS.SET_METRICS_CONSENT, expect.any(Function));
  });

  it('should not show prompt if consent is up-to-date', async () => {
    await runTest({
      storeValue: versionAfterUpdate,
      settingsValue: true,
      expectedResult: true,
    });
    expect(store.get).toHaveBeenCalledWith('versionConsentedMetrics');
    expect(store.set).not.toHaveBeenCalled();
    expect(appWindow.loadRenderer).not.toHaveBeenCalled();
    expect(ipcMain.handleOnce).not.toHaveBeenCalled();
  });

  it('should return true if consent is up-to-date and metrics enabled', async () => {
    await runTest({
      storeValue: versionAfterUpdate,
      settingsValue: true,
      expectedResult: true,
    });
    expect(store.set).not.toHaveBeenCalled();
  });

  it('should return false if consent is up-to-date and metrics are disabled', async () => {
    await runTest({
      storeValue: versionAfterUpdate,
      settingsValue: false,
      expectedResult: false,
    });
    expect(store.set).not.toHaveBeenCalled();
    expect(appWindow.loadRenderer).not.toHaveBeenCalled();
    expect(ipcMain.handleOnce).not.toHaveBeenCalled();
  });

  it('should return false if consent is out-of-date and metrics are disabled', async () => {
    await runTest({
      storeValue: versionBeforeUpdate,
      settingsValue: false,
      expectedResult: false,
    });
    expect(store.set).toHaveBeenCalled();
    expect(appWindow.loadRenderer).not.toHaveBeenCalled();
    expect(ipcMain.handleOnce).not.toHaveBeenCalled();
  });

  it('should update consent to false if the user denies', async () => {
    await runTest({
      storeValue: versionBeforeUpdate,
      settingsValue: true,
      expectedResult: false,
      mockConsent: false,
      promptUser: true,
    });
    expect(store.set).toHaveBeenCalled();
    expect(appWindow.loadRenderer).toHaveBeenCalledWith('metrics-consent');
    expect(ipcMain.handleOnce).toHaveBeenCalledWith(IPC_CHANNELS.SET_METRICS_CONSENT, expect.any(Function));
  });

  it('should return false if previous metrics setting is null', async () => {
    await runTest({
      storeValue: versionBeforeUpdate,
      settingsValue: null,
      expectedResult: false,
    });
    expect(store.set).toHaveBeenCalled();
    expect(appWindow.loadRenderer).not.toHaveBeenCalled();
    expect(ipcMain.handleOnce).not.toHaveBeenCalled();
  });

  it('should prompt for update if versionConsentedMetrics is undefined', async () => {
    await runTest({
      storeValue: undefined,
      settingsValue: true,
      expectedResult: true,
      mockConsent: true,
      promptUser: true,
    });
    expect(store.set).toHaveBeenCalled();
    expect(appWindow.loadRenderer).toHaveBeenCalledWith('metrics-consent');
    expect(ipcMain.handleOnce).toHaveBeenCalledWith(IPC_CHANNELS.SET_METRICS_CONSENT, expect.any(Function));
  });

  it('should return false if both settings are null or undefined', async () => {
    await runTest({
      storeValue: null,
      settingsValue: null,
      expectedResult: false,
    });
    expect(store.set).toHaveBeenCalled();
    expect(appWindow.loadRenderer).not.toHaveBeenCalled();
    expect(ipcMain.handleOnce).not.toHaveBeenCalled();
  });

  it('should return false if metrics are disabled and consent is null', async () => {
    await runTest({
      storeValue: versionBeforeUpdate,
      settingsValue: null,
      expectedResult: false,
    });
    expect(store.set).toHaveBeenCalled();
    expect(appWindow.loadRenderer).not.toHaveBeenCalled();
    expect(ipcMain.handleOnce).not.toHaveBeenCalled();
  });
});

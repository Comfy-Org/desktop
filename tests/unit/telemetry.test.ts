// @ts-strict-ignore
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { MixpanelTelemetry, promptMetricsConsent } from '../../src/services/telemetry';
import * as fs from 'fs';
import * as path from 'path';
import { IPC_CHANNELS } from '/src/constants';
import { ipcMain, IpcMainEvent } from 'electron';

vi.mock('electron', () => ({
  app: {
    getPath: vi.fn().mockReturnValue('/mock/user/data'),
    isPackaged: true,
  },
  ipcMain: {
    on: vi.fn(),
    once: vi.fn(),
  },
}));

vi.mock('fs');
vi.mock('mixpanel', () => ({
  default: {
    init: vi.fn(),
    track: vi.fn(),
  },
}));

describe('MixpanelTelemetry', () => {
  let telemetry: MixpanelTelemetry;
  const mockInitializedMixpanelClient = {
    track: vi.fn(),
    default: {
      init: vi.fn(),
      track: vi.fn(),
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
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      expect(fs.readFileSync).toHaveBeenCalledWith(path.join('/mock/user/data', 'telemetry.txt'), 'utf8');
      expect(fs.writeFileSync).not.toHaveBeenCalled();
    });

    it('should create new distinct ID if file does not exist', () => {
      vi.mocked(fs.existsSync).mockReturnValue(false);

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
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      telemetry.track(eventName, properties);

      expect(telemetry['queue'].length).toBe(1);
      expect(telemetry['queue'][0].eventName).toBe(eventName);
      expect(telemetry['queue'][0].properties).toMatchObject({
        ...properties,
        distinct_id: expect.any(String),
        time: expect.any(Date),
      });
    });

    it('should flush queue when consent is given', () => {
      const eventName = 'test_event';

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
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      const mockIpcEvent = {} as IpcMainEvent;
      const installOptionsHandler = vi.mocked(ipcMain.once).mock.calls[0][1];
      installOptionsHandler(mockIpcEvent, { allowMetrics: true });
      expect(telemetry.hasConsent).toBe(true);
    });

    it('should register ipc handler for TRACK_EVENT', () => {
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      telemetry.registerHandlers();

      expect(ipcMain.on).toHaveBeenCalledWith(IPC_CHANNELS.TRACK_EVENT, expect.any(Function));
    });

    it('should handle TRACK_EVENT messages', () => {
      telemetry = new MixpanelTelemetry(mockMixpanelClient as any);
      telemetry.registerHandlers();
      const trackEventHandler = vi.mocked(ipcMain.on).mock.calls[0][1];

      // Simulate receiving a track event
      const mockIpcEvent = {} as IpcMainEvent;
      trackEventHandler(mockIpcEvent, 'test_event', { foo: 'bar' });

      // Since consent is false by default, it should be queued
      expect(telemetry['queue'].length).toBe(1);
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
    const telemetry = new MixpanelTelemetry(mockMixpanelClient as any);

    // Verify init was called
    expect(mockMixpanelClient.init).toHaveBeenCalled();

    // This will fail because the initialized client isn't being assigned
    expect(telemetry['mixpanelClient']).toBe(mockInitializedClient);
  });
});

describe('promptMetricsConsent', () => {
  let store: { get: vi.Mock; set: vi.Mock };
  let appWindow: { loadRenderer: vi.Mock };
  let comfyDesktopApp: { comfySettings: { get: vi.Mock } };

  beforeEach(() => {
    vi.clearAllMocks();
    store = { get: vi.fn(), set: vi.fn() };
    appWindow = { loadRenderer: vi.fn() };
    comfyDesktopApp = { comfySettings: { get: vi.fn() } };
  });

  const runTest = async (
    storeValue: any,
    settingsValue: any,
    expectedResult: any,
    { mockConsent, promptUser }: { mockConsent?: boolean; promptUser?: boolean } = {}
  ) => {
    store.get.mockReturnValue(storeValue);
    comfyDesktopApp.comfySettings.get.mockReturnValue(settingsValue);

    if (promptUser) {
      vi.mocked(ipcMain.once).mockImplementationOnce((_, handler) => handler(null, mockConsent));
    }

    const result = await promptMetricsConsent(store as any, appWindow as any, comfyDesktopApp as any);
    expect(result).toBe(expectedResult);
  };

  it('should return consent immediately if already updated', async () => {
    await runTest(true, true, true);
    expect(store.get).toHaveBeenCalledWith('updatedMetricsConsent');
    expect(store.set).not.toHaveBeenCalled();
    expect(appWindow.loadRenderer).not.toHaveBeenCalled();
    expect(ipcMain.once).not.toHaveBeenCalled();
  });

  it('should return false immediately if metrics are disabled', async () => {
    await runTest(false, false, false);
    expect(store.set).toHaveBeenCalledWith('updatedMetricsConsent', true);
    expect(appWindow.loadRenderer).not.toHaveBeenCalled();
    expect(ipcMain.once).not.toHaveBeenCalled();
  });

  it('should prompt for update if metrics were previously enabled', async () => {
    await runTest(false, true, true, { mockConsent: true, promptUser: true });
    expect(store.set).toHaveBeenCalledWith('updatedMetricsConsent', true);
    expect(appWindow.loadRenderer).toHaveBeenCalledWith('metrics-consent');
    expect(ipcMain.once).toHaveBeenCalledWith(IPC_CHANNELS.SET_METRICS_CONSENT, expect.any(Function));
  });

  it('should update consent to false if the user denies', async () => {
    await runTest(false, true, false, { mockConsent: false, promptUser: true });
    expect(store.set).toHaveBeenCalledWith('updatedMetricsConsent', true);
    expect(appWindow.loadRenderer).toHaveBeenCalledWith('metrics-consent');
    expect(ipcMain.once).toHaveBeenCalledWith(IPC_CHANNELS.SET_METRICS_CONSENT, expect.any(Function));
  });

  it('should return false if previous metrics setting is null or undefined', async () => {
    await runTest(false, null, false);
    expect(store.set).toHaveBeenCalledWith('updatedMetricsConsent', true);
    expect(appWindow.loadRenderer).not.toHaveBeenCalled();
    expect(ipcMain.once).not.toHaveBeenCalled();
  });

  it('should prompt for update if updatedMetricsConsent is null or undefined', async () => {
    await runTest(null, true, true, { mockConsent: true, promptUser: true });
    expect(store.set).toHaveBeenCalledWith('updatedMetricsConsent', true);
    expect(appWindow.loadRenderer).toHaveBeenCalledWith('metrics-consent');
    expect(ipcMain.once).toHaveBeenCalledWith(IPC_CHANNELS.SET_METRICS_CONSENT, expect.any(Function));
  });

  it('should return false if both settings are null or undefined', async () => {
    await runTest(null, null, false);
    expect(store.set).toHaveBeenCalledWith('updatedMetricsConsent', true);
    expect(appWindow.loadRenderer).not.toHaveBeenCalled();
    expect(ipcMain.once).not.toHaveBeenCalled();
  });

  it('should return false if metrics are disabled and consent is null', async () => {
    await runTest(null, false, false);
    expect(store.set).toHaveBeenCalledWith('updatedMetricsConsent', true);
    expect(appWindow.loadRenderer).not.toHaveBeenCalled();
    expect(ipcMain.once).not.toHaveBeenCalled();
  });
});

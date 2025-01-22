import { app, ipcMain } from 'electron';
import log from 'electron-log/main';
import mixpanel, { PropertyDict } from 'mixpanel';
import { randomUUID } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import si from 'systeminformation';

import { IPC_CHANNELS } from '../constants';
import { AppWindow } from '../main-process/appWindow';
import { ComfyDesktopApp } from '../main-process/comfyDesktopApp';
import { InstallOptions } from '../preload';
import { DesktopConfig } from '../store/desktopConfig';
import { compareVersions } from '../utils';

let instance: ITelemetry | null = null;
export interface ITelemetry {
  hasConsent: boolean;
  track(eventName: string, properties?: PropertyDict): void;
  flush(): void;
  registerHandlers(): void;
}

interface GpuInfo {
  model: string;
  vendor: string;
  vram: number | null;
}

const MIXPANEL_TOKEN = '6a7f9f6ae2084b4e7ff7ced98a6b5988';
export class MixpanelTelemetry implements ITelemetry {
  public hasConsent: boolean = false;
  private readonly distinctId: string;
  private readonly storageFile: string;
  private readonly queue: { eventName: string; properties: PropertyDict }[] = [];
  private readonly mixpanelClient: mixpanel.Mixpanel;
  private cachedGpuInfo: GpuInfo[] | null = null;
  constructor(mixpanelClass: mixpanel.Mixpanel) {
    this.mixpanelClient = mixpanelClass.init(MIXPANEL_TOKEN, {
      geolocate: true,
    });
    // Store the distinct ID in a file in the user data directory for easy access.
    this.storageFile = path.join(app.getPath('userData'), 'telemetry.txt');
    this.distinctId = this.getOrCreateDistinctId(this.storageFile);
    this.queue = [];
    ipcMain.once(IPC_CHANNELS.INSTALL_COMFYUI, (_event, installOptions: InstallOptions) => {
      if (installOptions.allowMetrics) {
        this.hasConsent = true;
      }
    });
    // Eagerly fetch GPU info
    void this.fetchAndCacheGpuInformation();
  }

  private getOrCreateDistinctId(filePath: string): string {
    try {
      // Try to read existing ID
      if (fs.existsSync(filePath)) {
        return fs.readFileSync(filePath, 'utf8');
      }
      // Generate new ID if none exists
      const newId = randomUUID();
      fs.writeFileSync(filePath, newId);
      return newId;
    } catch (error) {
      log.error('Failed to manage distinct ID:', error);
      return '';
    }
  }

  /**
   * Track an event. If consent is not given, the event is queued for later.
   * @param eventName
   * @param properties
   */
  track(eventName: string, properties?: PropertyDict): void {
    const defaultProperties = {
      distinct_id: this.distinctId,
      time: new Date(),
      $os: os.platform(),
    };

    if (!this.hasConsent) {
      log.debug(`Queueing event ${eventName} with properties ${JSON.stringify(properties)}`);
      this.queue.push({
        eventName,
        properties: {
          ...defaultProperties,
          ...properties,
        },
      });
      return;
    }

    this.flush();

    try {
      const enrichedProperties = {
        ...defaultProperties,
        ...properties,
      };
      this.mixpanelTrack(eventName, enrichedProperties);

      this.identify();
    } catch (error) {
      log.error('Failed to track event:', error);
    }
  }

  /**
   * Empty the queue and send all events to Mixpanel.
   */
  flush(): void {
    while (this.queue.length > 0) {
      const { eventName, properties } = this.queue.pop()!;
      this.mixpanelTrack(eventName, properties);
    }
  }

  registerHandlers(): void {
    ipcMain.on(IPC_CHANNELS.TRACK_EVENT, (event, eventName: string, properties?: PropertyDict) => {
      this.track(eventName, properties);
    });

    ipcMain.on(IPC_CHANNELS.INCREMENT_USER_PROPERTY, (event, propertyName: string, number: number) => {
      this.mixpanelClient.people.increment(this.distinctId, propertyName, number);
    });
  }

  /**
   * Fetch GPU information and cache it.
   */
  private async fetchAndCacheGpuInformation(): Promise<void> {
    try {
      const gpuData = await si.graphics();
      this.cachedGpuInfo = gpuData.controllers.map((gpu) => ({
        model: gpu.model,
        vendor: gpu.vendor,
        vram: gpu.vram,
      }));
    } catch (error) {
      log.error('Failed to get GPU information:', error);
      this.cachedGpuInfo = [];
    }
  }

  private identify(): void {
    this.mixpanelClient.people.set(this.distinctId, {
      platform: process.platform,
      arch: os.arch(),
      gpus: this.cachedGpuInfo || [],
      app_version: app.getVersion(),
    });
  }

  private mixpanelTrack(eventName: string, properties: PropertyDict): void {
    if (app.isPackaged) {
      log.debug(`Tracking ${eventName} with properties ${JSON.stringify(properties)}`);
      this.mixpanelClient.track(eventName, properties);
    } else {
      log.info(`Would have tracked ${eventName} with properties ${JSON.stringify(properties)}`);
    }
  }
}

// Export a singleton instance
export function getTelemetry(): ITelemetry {
  if (!instance) {
    instance = new MixpanelTelemetry(mixpanel);
  }
  return instance;
}

// Classes that use the trackEvent decorator must implement this interface.
export interface HasTelemetry {
  telemetry: ITelemetry;
}

/**
 * Decorator to track the start, error, and end of a function.
 * @param eventName
 * @returns
 */
export function trackEvent(eventName: string) {
  return function <T extends HasTelemetry>(target: T, propertyKey: string, descriptor: PropertyDescriptor) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const originalMethod = descriptor.value;

    // eslint-disable-next-line @typescript-eslint/require-await, @typescript-eslint/no-explicit-any
    descriptor.value = async function (this: T, ...args: any[]) {
      this.telemetry.track(`${eventName}_start`);

      // eslint-disable-next-line @typescript-eslint/no-unsafe-return
      return (
        // eslint-disable-next-line @typescript-eslint/no-unsafe-call
        originalMethod
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          .apply(this, args)
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access
          .then(() => {
            this.telemetry.track(`${eventName}_end`);
          })
          // eslint-disable-next-line @typescript-eslint/no-unsafe-member-access, @typescript-eslint/no-explicit-any
          .catch((error: any) => {
            this.telemetry.track(`${eventName}_error`, {
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
              error_message: error.message,
              // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-member-access
              error_name: error.name,
            });
            throw error;
          })
      );
    };

    return descriptor;
  };
}

/** @returns Whether the user has consented to sending metrics. */
export async function promptMetricsConsent(
  store: DesktopConfig,
  appWindow: AppWindow,
  comfyDesktopApp: ComfyDesktopApp
): Promise<boolean> {
  const consent = comfyDesktopApp.comfySettings.get('Comfy-Desktop.SendStatistics') ?? false;
  const consentedOn = store.get('versionConsentedMetrics');
  const isOutdated = !consentedOn || compareVersions(consentedOn, '0.4.12') < 0;
  if (!isOutdated) return consent;

  store.set('versionConsentedMetrics', __COMFYUI_DESKTOP_VERSION__);
  if (consent) {
    const consentPromise = new Promise<boolean>((resolve) => {
      ipcMain.handleOnce(IPC_CHANNELS.SET_METRICS_CONSENT, (_event, consent: boolean) => resolve(consent));
    });

    await appWindow.loadRenderer('metrics-consent');
    const newConsent = await consentPromise;
    if (newConsent !== consent) {
      comfyDesktopApp.comfySettings.set('Comfy-Desktop.SendStatistics', newConsent);
      await comfyDesktopApp.comfySettings.saveSettings();
    }

    return newConsent;
  }

  return consent;
}

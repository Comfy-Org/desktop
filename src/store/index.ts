import type { GpuType, TorchDeviceType } from '../preload';

export type AppWindowSettings = {
  windowWidth: number;
  windowHeight: number;
  windowX: number | undefined;
  windowY: number | undefined;
  windowMaximized?: boolean;
};

export type DesktopSettings = {
  basePath?: string | null;
  /**
   * The state of the installation.
   * - `started`: The installation has started.
   * - `installed`: A fresh installation.
   * - `upgraded`: An upgrade from a previous version that stores the base path
   * in the yaml config.
   */
  installState?: 'started' | 'installed' | 'upgraded';
  /**
   * The path to the migration installation to migrate custom nodes from
   */
  migrateCustomNodesFrom?: string;
  /**
   * The last GPU that was detected during hardware validation.
   * Allows manual override of some install behaviour.
   */
  detectedGpu?: GpuType;
  /** The pytorch device that the user selected during installation. */
  selectedDevice?: TorchDeviceType;
  'Comfy-Desktop.RestoredCustomNodes': boolean;
};

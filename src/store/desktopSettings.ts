import type { TorchPinnedPackages, TorchUpdatePolicy } from '../constants';
import type { GpuType, TorchDeviceType } from '../preload';

export type DesktopInstallState = 'started' | 'installed' | 'upgraded';

export type DesktopWindowStyle = 'custom' | 'default';

export type DesktopSettings = {
  basePath?: string;
  /**
   * The state of the installation.
   * - `started`: The installation has started.
   * - `installed`: A fresh installation.
   * - `upgraded`: An upgrade from a previous version that stores the base path
   * in the yaml config.
   */
  installState?: DesktopInstallState;
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
  /**
   * Controls whether to use a custom window on linux/win32
   * - `custom`: Modern, theme-reactive, feels like an integral part of the UI
   * - `default`: Impersonal, static, plain - default window title bar
   */
  windowStyle?: DesktopWindowStyle;
  /** The version of comfyui-electron on which the user last consented to metrics. */
  versionConsentedMetrics?: string;
  /** Whether the user has generated an image successfully. */
  hasGeneratedSuccessfully?: boolean;
  /** How to handle NVIDIA PyTorch updates. */
  torchUpdatePolicy?: TorchUpdatePolicy;
  /** The pinned NVIDIA torch package versions when updates are disabled. */
  torchPinnedPackages?: TorchPinnedPackages;
  /** The last recommended NVIDIA torch version we prompted for. */
  torchLastPromptedVersion?: string;
};

export type AppWindowSettings = {
  windowWidth: number;
  windowHeight: number;
  windowX: number | undefined;
  windowY: number | undefined;
  windowMaximized?: boolean;
};

export type DesktopSettings = {
  basePath?: string;
  /**
   * The state of the installation.
   * - `started`: The installation has started.
   * - `installed`: A fresh installation.
   * - `upgraded`: An upgrade from a previous version that stores the base path
   * in the yaml config.
   */
  installState?: 'started' | 'installed' | 'upgraded';
};

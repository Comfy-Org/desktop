export type AppWindowSettings = {
  windowWidth: number;
  windowHeight: number;
  windowX: number | undefined;
  windowY: number | undefined;
  windowMaximized?: boolean;
};

export type DesktopSettings = {
  basePath?: string;
  installState?: 'started' | 'installed' | 'upgraded';
};

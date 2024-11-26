export type AppWindowSettings = {
  windowWidth: number;
  windowHeight: number;
  windowX: number | undefined;
  windowY: number | undefined;
  windowMaximized?: boolean;
};

export type DesktopSettings = {
  installState: 'started' | 'installed' | undefined;
}

import type { FileTransport, MainLogger, MainTransports } from 'electron-log';
import log from 'electron-log/main';
import { vi } from 'vitest';

import type { ITelemetry } from '@/services/telemetry';

vi.mock('electron-log/main');

vi.mocked(log.create).mockReturnValue({
  transports: {
    file: {
      transforms: [],
    } as unknown as FileTransport,
  } as unknown as MainTransports,
} as unknown as MainLogger & { default: MainLogger });

const appState = {
  initialize: vi.fn(),
  isQuitting: false,
  ipcRegistered: false,
  loaded: false,
  currentPage: undefined,
  emitIpcRegistered: vi.fn(),
  emitLoaded: vi.fn(),
};
vi.mock('@/main-process/appState', () => ({
  initializeAppState: vi.fn(),
  useAppState: vi.fn(() => appState),
}));

const mockTelemetry: ITelemetry = {
  track: vi.fn(),
  hasConsent: true,
  flush: vi.fn(),
  registerHandlers: vi.fn(),
};

vi.mock('@/services/sentry');

vi.mock('@/services/telemetry', async () => {
  const actual = await vi.importActual<typeof import('@/services/telemetry')>('@/services/telemetry');

  return {
    ...actual,
    getTelemetry: vi.fn(() => mockTelemetry),
    promptMetricsConsent: vi.fn().mockResolvedValue(true),
  };
});

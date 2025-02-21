import { vi } from 'vitest';

import type { ITelemetry } from '@/services/telemetry';

vi.mock('electron-log/main');

vi.mock('@/main-process/appState', () => ({
  initializeAppState: vi.fn(),
  useAppState: vi.fn().mockReturnValue({
    initialize: vi.fn(),
    isQuitting: false,
    ipcRegistered: false,
    loaded: false,
    currentPage: undefined,
    emitIpcRegistered: vi.fn(),
    emitLoaded: vi.fn(),
  }),
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
    getTelemetry: vi.fn().mockReturnValue(mockTelemetry),
    promptMetricsConsent: vi.fn().mockResolvedValue(true),
  };
});

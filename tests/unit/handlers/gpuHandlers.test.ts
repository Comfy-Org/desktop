import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mockExecAsync = vi.fn();
vi.mock('node:util', () => ({ promisify: () => mockExecAsync }));

describe('registerGpuHandlers', () => {
  let ipcMainHandleSpy: ReturnType<typeof vi.spyOn>;
  let IPC_CHANNELS: typeof import('@/constants').IPC_CHANNELS;
  let registerGpuHandlers: typeof import('@/handlers/gpuHandlers').registerGpuHandlers;

  beforeEach(async () => {
    const constantsModule = await import('@/constants');
    IPC_CHANNELS = constantsModule.IPC_CHANNELS;
    const electron = await import('electron');
    ipcMainHandleSpy = vi.spyOn(electron.ipcMain, 'handle').mockImplementation(() => undefined);
    const gpuModule = await import('@/handlers/gpuHandlers');
    registerGpuHandlers = gpuModule.registerGpuHandlers;
    mockExecAsync.mockReset();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('registers exactly one handler for CHECK_BLACKWELL', () => {
    registerGpuHandlers();
    expect(ipcMainHandleSpy).toHaveBeenCalledTimes(1);
    expect(ipcMainHandleSpy).toHaveBeenCalledWith(IPC_CHANNELS.CHECK_BLACKWELL, expect.any(Function));
  });

  describe('CHECK_BLACKWELL handler callback', () => {
    let handler: () => Promise<boolean>;

    beforeEach(() => {
      registerGpuHandlers();
      const call = ipcMainHandleSpy.mock.calls.find(([channel]) => channel === IPC_CHANNELS.CHECK_BLACKWELL)!;
      handler = call[1] as any;
    });

    it('invokes execAsync with the correct command', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'Product Architecture : Blackwell' });
      await handler();
      expect(mockExecAsync).toHaveBeenCalledOnce();
      expect(mockExecAsync).toHaveBeenCalledWith('nvidia-smi -q');
    });

    it('returns true when stdout contains "Blackwell" with exact casing', async () => {
      mockExecAsync.mockResolvedValue({ stdout: '...Product Architecture : Blackwell\n...' });
      await expect(handler()).resolves.toBe(true);
    });

    it('returns false when stdout does not contain "Blackwell"', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'Product Architecture : Ampere' });
      await expect(handler()).resolves.toBe(false);
    });

    it('is case-sensitive and returns false for lowercase "blackwell"', async () => {
      mockExecAsync.mockResolvedValue({ stdout: 'Product Architecture : blackwell' });
      await expect(handler()).resolves.toBe(false);
    });

    it('returns false when execAsync throws an error', async () => {
      mockExecAsync.mockRejectedValue(new Error('execution failed'));
      await expect(handler()).resolves.toBe(false);
    });
  });
});

import type { ChildProcess } from 'node:child_process';
import { exec } from 'node:child_process';
import type { Systeminformation } from 'systeminformation';
import si from 'systeminformation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { validateHardware } from '@/utils';

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));
vi.mock('systeminformation');

const execMock = vi.mocked(exec);

const createChildProcess = (): ChildProcess =>
  ({
    kill: vi.fn(),
    on: vi.fn(),
  }) as unknown as ChildProcess;

type ExecResponse = { error?: Error | null; stdout?: string; stderr?: string };

const withExecResponses = (responses: Array<[RegExp, ExecResponse]>, fallback: ExecResponse = {}) => {
  execMock.mockImplementation(((
    command: string,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    const match = responses.find(([pattern]) => pattern.test(command));
    const { error = null, stdout = '', stderr = '' } = match?.[1] ?? fallback;
    setImmediate(() => callback(error ?? null, stdout, stderr));
    return createChildProcess();
  }) as typeof exec);
};

beforeEach(() => {
  execMock.mockReset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateHardware', () => {
  it('accepts Apple Silicon Mac', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    vi.mocked(si.cpu).mockResolvedValue({ manufacturer: 'Apple' } as Systeminformation.CpuData);

    const result = await validateHardware();
    expect(result).toStrictEqual({ isValid: true, gpu: 'mps' });
  });

  it('rejects Intel Mac', async () => {
    vi.stubGlobal('process', { ...process, platform: 'darwin' });
    vi.mocked(si.cpu).mockResolvedValue({ manufacturer: 'Intel' } as Systeminformation.CpuData);

    const result = await validateHardware();
    expect(result).toStrictEqual({
      isValid: false,
      error: expect.stringContaining('Intel-based Macs are not supported'),
    });
  });

  it('accepts Windows with NVIDIA GPU', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    vi.mocked(si.graphics).mockResolvedValue({
      controllers: [{ vendor: 'NVIDIA Corporation' }],
    } as Systeminformation.GraphicsData);

    const result = await validateHardware();
    expect(result).toStrictEqual({ isValid: true, gpu: 'nvidia' });
  });

  it('accepts Windows with AMD GPU', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    vi.mocked(si.graphics).mockResolvedValue({
      controllers: [{ vendorId: '1002', vendor: 'AMD' }],
    } as Systeminformation.GraphicsData);

    const result = await validateHardware();
    expect(result).toStrictEqual({ isValid: true, gpu: 'amd' });
  });

  it('rejects Windows with unsupported GPU', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    vi.mocked(si.graphics).mockResolvedValue({
      controllers: [{ vendor: 'Intel', model: 'Iris Xe' }],
    } as Systeminformation.GraphicsData);

    withExecResponses([
      [/nvidia-smi/, { error: new Error('mocked exec failure') }],
      [/PNPDeviceID/, { stdout: '["PCI\\\\VEN_8086&DEV_46A6"]\r\n' }],
    ]);

    const result = await validateHardware();
    expect(result).toStrictEqual({
      isValid: false,
      error: expect.stringContaining('NVIDIA or AMD'),
    });
  });
});

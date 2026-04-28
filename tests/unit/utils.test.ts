import type { ChildProcess } from 'node:child_process';
import { exec } from 'node:child_process';
import type { Systeminformation } from 'systeminformation';
import si from 'systeminformation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { canExecuteGit, validateHardware } from '@/utils';

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

type ExitResponse = { code: number };

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

const withExitResponses = (responses: Array<[RegExp, ExitResponse]>, fallback?: ExitResponse) => {
  execMock.mockImplementation((command: string) => {
    const match = responses.find(([pattern]) => pattern.test(command));
    const { code } = match?.[1] ?? fallback ?? { code: 1 };

    return {
      kill: vi.fn(),
      on: vi.fn((event: string, callback: (code: number) => void) => {
        if (event === 'exit') setImmediate(() => callback(code));
      }),
    } as unknown as ChildProcess;
  });
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

describe('canExecuteGit', () => {
  it('falls back to the standard Git for Windows install path when git is missing from PATH', async () => {
    vi.stubGlobal('process', {
      ...process,
      platform: 'win32',
      env: { ...process.env, ProgramFiles: String.raw`C:\Program Files` },
    });
    withExitResponses([
      [/^git --help$/, { code: 1 }],
      [/^"C:\\Program Files\\Git\\cmd\\git\.exe" --help$/, { code: 0 }],
    ]);

    await expect(canExecuteGit()).resolves.toBe(true);
  });
});

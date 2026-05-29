import type { ChildProcess } from 'node:child_process';
import { exec } from 'node:child_process';
import type { Systeminformation } from 'systeminformation';
import si from 'systeminformation';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { collectGpuInformation, parseNvidiaDriverVersionFromSmiOutput } from '@/services/gpuInfo';

vi.mock('node:child_process', () => ({
  exec: vi.fn(),
}));

vi.mock('systeminformation', () => ({
  __esModule: true,
  default: {
    graphics: vi.fn(),
  },
}));

const execMock = vi.mocked(exec);
const graphicsMock = vi.mocked(si.graphics);

const createChildProcess = (): ChildProcess =>
  ({
    kill: vi.fn(),
    on: vi.fn(),
  }) as unknown as ChildProcess;

type ExecResponse = {
  error?: Error | null;
  stdout?: string;
  stderr?: string;
};

const withExecResponses = (responses: Array<[RegExp, ExecResponse]>, fallback: ExecResponse = {}) => {
  execMock.mockImplementation(((
    command: string,
    callback: (error: Error | null, stdout: string, stderr: string) => void
  ) => {
    const matched = responses.find(([pattern]) => pattern.test(command));
    const { error = null, stdout = '', stderr = '' } = matched?.[1] ?? fallback;
    setImmediate(() => callback(error, stdout, stderr));
    return createChildProcess();
  }) as typeof exec);
};

describe('gpuInfo', () => {
  beforeEach(() => {
    execMock.mockReset();
    graphicsMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('parses driver version from nvidia-smi output', () => {
    const output = 'NVIDIA-SMI 591.59 Driver Version: 591.59 CUDA Version: 13.1';

    expect(parseNvidiaDriverVersionFromSmiOutput(output)).toBe('591.59');
  });

  it('normalizes driver version from systeminformation', async () => {
    graphicsMock.mockResolvedValue({
      controllers: [
        {
          model: 'NVIDIA RTX 4090',
          vendor: 'NVIDIA',
          vram: 24_576,
          driverVersion: ' 551.61 ',
        },
      ],
    } as Systeminformation.GraphicsData);

    const result = await collectGpuInformation();

    expect(result).toEqual([
      {
        model: 'NVIDIA RTX 4090',
        vendor: 'NVIDIA',
        vram: 24_576,
        driverVersion: '551.61',
      },
    ]);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('backfills missing NVIDIA driver version via nvidia-smi query on Windows', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    graphicsMock.mockResolvedValue({
      controllers: [
        {
          model: 'NVIDIA RTX 5090',
          vendor: 'NVIDIA Corporation',
          vram: 32_768,
        },
        {
          model: 'AMD Radeon RX 7900 XTX',
          vendor: 'AMD',
          vram: 24_576,
        },
      ],
    } as Systeminformation.GraphicsData);

    withExecResponses([[/--query-gpu=driver_version/, { stdout: ' 591.59 \n' }]]);

    const result = await collectGpuInformation();

    expect(result).toEqual([
      {
        model: 'NVIDIA RTX 5090',
        vendor: 'NVIDIA Corporation',
        vram: 32_768,
        driverVersion: '591.59',
      },
      {
        model: 'AMD Radeon RX 7900 XTX',
        vendor: 'AMD',
        vram: 24_576,
        driverVersion: null,
      },
    ]);
    expect(execMock).toHaveBeenCalledTimes(1);
    platformSpy.mockRestore();
  });

  it('uses nvidia-smi text fallback when query fails', async () => {
    const platformSpy = vi.spyOn(process, 'platform', 'get').mockReturnValue('win32');
    graphicsMock.mockResolvedValue({
      controllers: [
        {
          model: 'NVIDIA RTX 5090',
          vendor: 'NVIDIA Corporation',
          vram: 32_768,
        },
      ],
    } as Systeminformation.GraphicsData);

    withExecResponses([
      [/--query-gpu=driver_version/, { error: new Error('query failed') }],
      [/^nvidia-smi$/, { stdout: 'Driver Version: 591.59 CUDA Version: 13.1' }],
    ]);

    const result = await collectGpuInformation();

    expect(result).toEqual([
      {
        model: 'NVIDIA RTX 5090',
        vendor: 'NVIDIA Corporation',
        vram: 32_768,
        driverVersion: '591.59',
      },
    ]);
    expect(execMock).toHaveBeenCalledTimes(2);
    platformSpy.mockRestore();
  });
});

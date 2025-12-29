import type { ChildProcess } from 'node:child_process';
import { exec } from 'node:child_process';
import type { Systeminformation } from 'systeminformation';
import si from 'systeminformation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

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

beforeEach(() => {
  execMock.mockReset();
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
      controllers: [{ vendor: 'Intel', model: 'Iris Xe' }],
    } as Systeminformation.GraphicsData);

    execMock.mockImplementation(((
      command: string,
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      if (command.includes('nvidia-smi')) {
        setImmediate(() => callback(new Error('mocked exec failure'), '', ''));
        return createChildProcess();
      }
      if (command.includes('PNPDeviceID')) {
        setImmediate(() => callback(null, 'PCI\\VEN_1002&DEV_73FF\r\n', ''));
        return createChildProcess();
      }

      setImmediate(() => callback(null, '', ''));
      return createChildProcess();
    }) as typeof exec);

    const result = await validateHardware();
    expect(result).toStrictEqual({ isValid: true, gpu: 'amd' });
  });

  it('rejects Windows with unsupported GPU', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
    vi.mocked(si.graphics).mockResolvedValue({
      controllers: [{ vendor: 'Intel', model: 'Iris Xe' }],
    } as Systeminformation.GraphicsData);

    execMock.mockImplementation(((
      command: string,
      callback: (error: Error | null, stdout: string, stderr: string) => void
    ) => {
      if (command.includes('nvidia-smi')) {
        setImmediate(() => callback(new Error('mocked exec failure'), '', ''));
        return createChildProcess();
      }
      if (command.includes('PNPDeviceID')) {
        setImmediate(() => callback(null, '', ''));
        return createChildProcess();
      }

      setImmediate(() => callback(null, '', ''));
      return createChildProcess();
    }) as typeof exec);

    const result = await validateHardware();
    expect(result).toStrictEqual({
      isValid: false,
      error: expect.stringContaining('NVIDIA or AMD'),
    });
  });
});

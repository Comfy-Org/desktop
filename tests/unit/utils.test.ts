import type { Systeminformation } from 'systeminformation';
import si from 'systeminformation';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { validateHardware } from '@/utils';

vi.mock('systeminformation');

describe('validateHardware', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.resetAllMocks();
  });

  it('accepts Apple Silicon Mac', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.mocked(si.cpu).mockResolvedValue({ manufacturer: 'Apple' } as Systeminformation.CpuData);

    const result = await validateHardware();
    expect(result).toStrictEqual({ isValid: true, gpu: 'mps' });
  });

  it('rejects Intel Mac', async () => {
    Object.defineProperty(process, 'platform', { value: 'darwin' });
    vi.mocked(si.cpu).mockResolvedValue({ manufacturer: 'Intel' } as Systeminformation.CpuData);

    const result = await validateHardware();
    expect(result).toStrictEqual({
      isValid: false,
      error: expect.stringContaining('Intel-based Macs are not supported'),
    });
  });

  it('accepts Windows with NVIDIA GPU', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    vi.mocked(si.graphics).mockResolvedValue({
      controllers: [{ vendor: 'NVIDIA Corporation' }],
    } as Systeminformation.GraphicsData);

    const result = await validateHardware();
    expect(result).toStrictEqual({ isValid: true, gpu: 'nvidia' });
  });

  it('rejects Windows with AMD GPU', async () => {
    Object.defineProperty(process, 'platform', { value: 'win32' });
    // Simulate a system with an AMD GPU
    vi.mocked(si.graphics).mockResolvedValue({
      controllers: [{ vendor: 'AMD', model: 'Radeon RX 6800' }],
    } as Systeminformation.GraphicsData);

    const result = await validateHardware();
    expect(result).toStrictEqual({
      isValid: false,
      error: expect.stringContaining('No NVIDIA GPU was detected'),
    });
  });
});

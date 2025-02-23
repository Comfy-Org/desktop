import type { Systeminformation } from 'systeminformation';
import si from 'systeminformation';
import { describe, expect, it, vi } from 'vitest';

import { validateHardware } from '@/utils';

vi.mock('systeminformation');

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

  it('rejects Windows with AMD GPU', async () => {
    vi.stubGlobal('process', { ...process, platform: 'win32' });
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

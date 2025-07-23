import { describe, expect, it, vi } from 'vitest';

import { ComfyManagerService } from '@/services/comfyManagerService';

// Mock axios
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      post: vi.fn(),
      get: vi.fn(),
      interceptors: {
        request: {
          use: vi.fn(),
        },
        response: {
          use: vi.fn(),
        },
      },
    })),
  },
}));

describe('ComfyManagerService', () => {
  describe('processProtocolAction', () => {
    it('should handle install-custom-node action', async () => {
      const service = new ComfyManagerService('http://localhost:8000');
      
      // Mock the installCustomNode method
      vi.spyOn(service, 'installCustomNode').mockResolvedValue({
        success: true,
        message: 'Node installed successfully',
      });

      const action = {
        action: 'install-custom-node' as const,
        params: { nodeId: 'test-node' },
        originalUrl: 'comfy://install-custom-node/test-node',
      };

      const result = await service.processProtocolAction(action);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Node installed successfully');
      expect(service.installCustomNode).toHaveBeenCalledWith('test-node');
    });

    it('should handle import action', async () => {
      const service = new ComfyManagerService('http://localhost:8000');
      
      // Mock the importResource method
      vi.spyOn(service, 'importResource').mockResolvedValue({
        success: true,
        message: 'Resource imported successfully',
      });

      const action = {
        action: 'import' as const,
        params: { nodeId: 'test-workflow' },
        originalUrl: 'comfy://import/test-workflow',
      };

      const result = await service.processProtocolAction(action);

      expect(result.success).toBe(true);
      expect(result.message).toBe('Resource imported successfully');
      expect(service.importResource).toHaveBeenCalledWith('test-workflow');
    });
  });
});
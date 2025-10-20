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

    it('should handle ComfyUI-AnimateDiff-Evolved installation specifically', async () => {
      const service = new ComfyManagerService('http://localhost:8188');

      // Mock the installCustomNode method to simulate actual API call
      const mockInstallResponse = {
        success: true,
        message: 'ComfyUI-AnimateDiff-Evolved installed successfully',
        data: { nodeId: 'ComfyUI-AnimateDiff-Evolved' },
      };

      vi.spyOn(service, 'installCustomNode').mockResolvedValue(mockInstallResponse);

      // Create the exact protocol action as requested
      const action = {
        action: 'install-custom-node' as const,
        params: { nodeId: 'ComfyUI-AnimateDiff-Evolved' },
        originalUrl: 'comfy://install-custom-node/ComfyUI-AnimateDiff-Evolved',
      };

      // Process the protocol action
      const result = await service.processProtocolAction(action);

      // Verify the installation function was called with correct parameters
      expect(service.installCustomNode).toHaveBeenCalledWith('ComfyUI-AnimateDiff-Evolved');
      expect(service.installCustomNode).toHaveBeenCalledTimes(1);

      // Verify the result
      expect(result.success).toBe(true);
      expect(result.message).toBe('ComfyUI-AnimateDiff-Evolved installed successfully');
      expect(result.data).toEqual({ nodeId: 'ComfyUI-AnimateDiff-Evolved' });
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

    it('should track that installCustomNode is called when processing protocol action', async () => {
      const service = new ComfyManagerService('http://localhost:8188');

      // Create a spy that tracks actual method calls
      const installSpy = vi.spyOn(service, 'installCustomNode').mockImplementation((nodeId: string) => {
        // Simulate the actual method behavior
        return Promise.resolve({
          success: true,
          message: `Installing custom node: ${nodeId}`,
          data: { nodeId, status: 'installing' },
        });
      });

      const protocolAction = {
        action: 'install-custom-node' as const,
        params: { nodeId: 'ComfyUI-AnimateDiff-Evolved' },
        originalUrl: 'comfy://install-custom-node/ComfyUI-AnimateDiff-Evolved',
      };

      // This is the key test: verify that processProtocolAction calls installCustomNode
      await service.processProtocolAction(protocolAction);

      // Verify the installing function is called
      expect(installSpy).toHaveBeenCalled();
      expect(installSpy).toHaveBeenCalledWith('ComfyUI-AnimateDiff-Evolved');
      expect(installSpy).toHaveBeenCalledTimes(1);

      // Verify the spy captured the correct call details
      const callArgs = installSpy.mock.calls[0];
      expect(callArgs[0]).toBe('ComfyUI-AnimateDiff-Evolved');
    });
  });
});

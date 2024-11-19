import { InstallWizard } from '../../src/install/installWizard';
import { ComfyServerConfig } from '../../src/config/comfyServerConfig';

describe('InstallWizard', () => {
  describe('getMigrationModelPaths', () => {
    it('should return empty object when no migration source is provided', async () => {
      const installWizard = new InstallWizard({
        installPath: '/fake/path',
        autoUpdate: false,
        allowMetrics: false,
      });

      const result = await installWizard.getMigrationModelPaths();
      expect(result).toEqual({
        comfyui: {},
      });
    });

    it('should merge configs and remove custom_nodes when migration source is provided', async () => {
      // Mock the getConfigFromRepoPath and getBaseModelPathsFromRepoPath methods
      const mockServerConfig = {
        comfyui: {
          checkpoints: '/server/path/checkpoints/',
          custom_nodes: '/server/path/custom_nodes/',
        },
      };

      jest.spyOn(ComfyServerConfig, 'getConfigFromRepoPath').mockResolvedValue(mockServerConfig);
      jest.spyOn(ComfyServerConfig, 'getBaseModelPathsFromRepoPath').mockReturnValue({
        checkpoints: '/base/path/checkpoints/',
        custom_nodes: '/base/path/custom_nodes/',
      });

      const installWizard = new InstallWizard({
        installPath: '',
        autoUpdate: false,
        allowMetrics: false,
        migrationSourcePath: '/fake/path',
        migrationItemIds: ['models'],
      });
      const result = await installWizard.getMigrationModelPaths();

      expect(result.comfyui).toBeDefined();
      expect(result.comfyui.checkpoints).toBe('/server/path/checkpoints/\n/base/path/checkpoints/');
      expect(result.comfyui.custom_nodes).toBeUndefined();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });
  });
});

import { app } from 'electron';
import path from 'path';
import { getBasePath, getPythonInstallPath, getAppResourcesPath } from '../../../src/install/resourcePaths';
import { getModelConfigPath, readBasePathFromConfig } from '../../../src/config/extra_model_config';

// Mock the external modules
jest.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: jest.fn(),
  },
}));

jest.mock('../../../src/config/extra_model_config', () => ({
  getModelConfigPath: jest.fn(),
  readBasePathFromConfig: jest.fn(),
}));

describe('resourcePaths', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('getBasePath', () => {
    it('should return the base path from config', async () => {
      const mockConfigPath = '/mock/config/path';
      const mockBasePath = '/mock/base/path';

      (getModelConfigPath as jest.Mock).mockReturnValue(mockConfigPath);
      (readBasePathFromConfig as jest.Mock).mockResolvedValue(mockBasePath);

      const result = await getBasePath();

      expect(getModelConfigPath).toHaveBeenCalled();
      expect(readBasePathFromConfig).toHaveBeenCalledWith(mockConfigPath);
      expect(result).toBe(mockBasePath);
    });
  });

  describe('getPythonInstallPath', () => {
    it('should return assets path when app is not packaged', async () => {
      const mockAppPath = '/mock/app/path';
      (app.getAppPath as jest.Mock).mockReturnValue(mockAppPath);
      (app.isPackaged as boolean) = false;

      const result = await getPythonInstallPath();

      expect(result).toBe(path.join(mockAppPath, 'assets'));
      expect(app.getAppPath).toHaveBeenCalled();
    });

    it('should return base path when app is packaged', async () => {
      const mockBasePath = '/mock/base/path';
      (app.isPackaged as boolean) = true;
      (getModelConfigPath as jest.Mock).mockReturnValue('/mock/config');
      (readBasePathFromConfig as jest.Mock).mockResolvedValue(mockBasePath);

      const result = await getPythonInstallPath();

      expect(result).toBe(mockBasePath);
    });
  });

  describe('getAppResourcesPath', () => {
    it('should return assets path when app is not packaged', async () => {
      const mockAppPath = '/mock/app/path';
      (app.getAppPath as jest.Mock).mockReturnValue(mockAppPath);
      (app.isPackaged as boolean) = false;

      const result = await getAppResourcesPath();

      expect(result).toBe(path.join(mockAppPath, 'assets'));
      expect(app.getAppPath).toHaveBeenCalled();
    });

    it('should return resources path when app is packaged', async () => {
      (app.isPackaged as boolean) = true;
      const mockResourcesPath = '/mock/resources/path';
      (process as any).resourcesPath = mockResourcesPath;

      const result = await getAppResourcesPath();

      expect(result).toBe(mockResourcesPath);
    });
  });
});

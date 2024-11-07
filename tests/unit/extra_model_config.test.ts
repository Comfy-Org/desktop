import { app } from 'electron';
import path from 'path';
import { getModelConfigPath } from '../../src/config/extra_model_config';

// Mock electron
jest.mock('electron', () => ({
  app: {
    getPath: jest.fn(),
  },
}));

describe('getModelConfigPath', () => {
  it('should return the correct path', async () => {
    // Mock the userData path
    const mockUserDataPath = '/fake/user/data';
    (app.getPath as jest.Mock).mockImplementation((key: string) => {
      if (key === 'userData') {
        return mockUserDataPath;
      }
      throw new Error(`Unexpected getPath key: ${key}`);
    });

    const result = await getModelConfigPath();

    // Verify the path is correctly joined
    expect(result).toBe(path.join(mockUserDataPath, 'extra_models_config.yaml'));

    // Verify app.getPath was called with correct argument
    expect(app.getPath).toHaveBeenCalledWith('userData');
  });
});

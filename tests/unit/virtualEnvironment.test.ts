import log from 'electron-log/main';
import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { test as baseTest, describe, expect, vi } from 'vitest';

import { TorchMirrorUrl } from '@/constants';
import type { ITelemetry } from '@/services/telemetry';
import { VirtualEnvironment, getPipInstallArgs } from '@/virtualEnvironment';

vi.mock('@sentry/electron/main', () => ({
  init: vi.fn(),
  captureException: vi.fn(),
  setContext: vi.fn(),
}));

vi.mock('node:child_process');

interface TestFixtures {
  virtualEnv: VirtualEnvironment;
}

const mockTelemetry: ITelemetry = {
  track: vi.fn(),
  hasConsent: false,
  flush: vi.fn(),
  registerHandlers: vi.fn(),
  loadGenerationCount: vi.fn(),
};

const test = baseTest.extend<TestFixtures>({
  virtualEnv: async ({}, use) => {
    const resourcesPath = path.join(__dirname, '../resources');

    // Mock process.resourcesPath since app.isPackaged is true
    vi.stubGlobal('process', {
      ...process,
      resourcesPath,
    });

    const virtualEnv = new VirtualEnvironment('/mock/venv', {
      telemetry: mockTelemetry,
      selectedDevice: 'cpu',
      pythonVersion: '3.12',
    });
    await use(virtualEnv);
  },
});

function mockSpawnOutputOnce(output: string, exitCode = 0, signal: NodeJS.Signals | null = null, stderr?: string) {
  vi.mocked(spawn).mockImplementationOnce(() => {
    const process = {
      on: vi.fn((event: string, callback: (exitCode: number, signal: NodeJS.Signals | null) => void) => {
        if (event === 'error') return;
        if (event === 'close') return callback(exitCode, signal);
        throw new Error('Unknown event');
      }),
      stdout: {
        on: vi.fn((event: string, callback: (data: Buffer) => void) => {
          callback(Buffer.from(output));
        }),
      },
      stderr: {
        on: vi.fn((event: string, callback: (data: Buffer) => void) => {
          callback(Buffer.from(stderr ?? ''));
        }),
      },
    } as unknown as ChildProcess;

    return process;
  });
}

const corePackages = ['av', 'yarl', 'aiohttp'];
const managerPackages = ['uv', 'chardet', 'toml'];

interface PackageCombination {
  core: string[];
  manager: string[];
}

/** Recursively get all combinations of elements in a single array */
function getCombinations(strings: string[]): string[][] {
  if (strings.length === 0) return [[]];

  const [first, ...rest] = strings;
  const combsWithoutFirst = getCombinations(rest);
  const combsWithFirst = combsWithoutFirst.map((combo) => [first, ...combo]);

  return [...combsWithoutFirst, ...combsWithFirst];
}

/** Get all possible combinations of core and manager packages */
function getAllPackageCombinations(core: string[], manager: string[]): PackageCombination[] {
  const coreCombinations = getCombinations(core);
  const managerCombinations = getCombinations(manager);

  const allCombinations: PackageCombination[] = [];
  for (const coreComb of coreCombinations) {
    for (const managerComb of managerCombinations) {
      allCombinations.push({
        core: coreComb,
        manager: managerComb,
      });
    }
  }

  return allCombinations;
}

const allCombinations = getAllPackageCombinations(corePackages, managerPackages);

let versionLength = 0;
let boundedNumber = 0;

function getZeroToSeven() {
  boundedNumber = (boundedNumber + 1) & 7;
  return boundedNumber;
}

function sequentialVersion() {
  versionLength = (versionLength + 1) & 3;
  versionLength ||= 1;

  return Array.from({ length: versionLength })
    .map(() => getZeroToSeven())
    .join('.');
}

function mockSpawnForPackages(strings: string[]) {
  if (strings.length === 0) {
    mockSpawnOutputOnce('Would make no changes\n');
  } else {
    const s = strings.length === 1 ? '' : 's';
    const packageLines = strings.map((str) => ` + ${str}==${sequentialVersion()}`);
    const lines = [
      `Resolved 40 packages in 974ms`,
      `Would download ${strings.length} package${s}`,
      `Would install ${strings.length} package${s}`,
      ...packageLines,
    ];
    mockSpawnOutputOnce(lines.join('\n'));
  }
}

test.for(allCombinations)('hasRequirements', async ({ core, manager }, { virtualEnv }) => {
  mockSpawnForPackages(core);
  mockSpawnForPackages(manager);

  const result = core.length + manager.length === 0 ? 'OK' : 'package-upgrade';
  await expect(virtualEnv.hasRequirements()).resolves.toBe(result);
  expect(log.info).toHaveBeenCalledWith(expect.stringContaining('pip install --dry-run -r'));
});

describe('VirtualEnvironment', () => {
  describe('getPipInstallArgs', () => {
    test('includes unsafe-best-match and extra index URL args', () => {
      const args = getPipInstallArgs({
        requirementsFile: '/tmp/requirements.txt',
        packages: [],
        indexUrl: 'https://mirror.example/simple/',
        extraIndexUrls: ['https://mirror-two.example/simple/', TorchMirrorUrl.Default],
        indexStrategy: 'unsafe-best-match',
      });

      expect(args).toEqual([
        'pip',
        'install',
        '-r',
        '/tmp/requirements.txt',
        '--index-url',
        'https://mirror.example/simple/',
        '--extra-index-url',
        'https://mirror-two.example/simple/',
        '--extra-index-url',
        TorchMirrorUrl.Default,
        '--index-strategy',
        'unsafe-best-match',
      ]);
    });
  });

  describe('hasRequirements', () => {
    test('returns OK when all packages are installed', async ({ virtualEnv }) => {
      mockSpawnOutputOnce('Would make no changes\n');
      mockSpawnOutputOnce('Would make no changes\n');

      await expect(virtualEnv.hasRequirements()).resolves.toBe('OK');
      expect(log.info).toHaveBeenCalledWith(expect.stringContaining('pip install --dry-run -r'));
    });

    test('returns package-upgrade when packages are missing and not a known upgrade case', async ({ virtualEnv }) => {
      mockSpawnOutputOnce(' + unknown_package==1.0.0\n');
      mockSpawnOutputOnce('Would make no changes\n');

      await expect(virtualEnv.hasRequirements()).resolves.toBe('package-upgrade');
      expect(log.info).toHaveBeenCalledWith(
        expect.stringContaining('Requirements are out of date. Treating as package upgrade.'),
        expect.objectContaining({ coreOk: false, managerOk: true, upgradeCore: false, upgradeManager: false })
      );
    });

    test('returns package-upgrade for manager upgrade case', async ({ virtualEnv }) => {
      mockSpawnOutputOnce('Would make no changes\n');
      mockSpawnOutputOnce('Would install 1 package \n + chardet==5.2.0\n');

      await expect(virtualEnv.hasRequirements()).resolves.toBe('package-upgrade');
      expect(log.info).toHaveBeenCalledWith(
        'Package update of known packages required. Core:',
        false,
        'Manager:',
        true
      );
    });

    test('returns package-upgrade for manager upgrade case', async ({ virtualEnv }) => {
      mockSpawnOutputOnce('Would make no changes\n');
      mockSpawnOutputOnce('Would install 2 packages \n + uv==1.0.0 \n + toml==1.0.0\n');

      await expect(virtualEnv.hasRequirements()).resolves.toBe('package-upgrade');
      expect(log.info).toHaveBeenCalledWith(
        'Package update of known packages required. Core:',
        false,
        'Manager:',
        true
      );
    });

    test('returns package-upgrade for core + manager upgrade case', async ({ virtualEnv }) => {
      mockSpawnOutputOnce('Would install 3 packages \n + av==1.0.0 \n + yarl==12.0.8 \n + aiohttp==3.9.0\n');
      mockSpawnOutputOnce('Would install 2 packages \n + uv==1.0.0 \n + toml==1.0.0\n');

      await expect(virtualEnv.hasRequirements()).resolves.toBe('package-upgrade');
      expect(log.info).toHaveBeenCalledWith('Package update of known packages required. Core:', true, 'Manager:', true);
    });

    test('returns package-upgrade for core upgrade case', async ({ virtualEnv }) => {
      mockSpawnOutputOnce('Would install 1 package \n + av==1.0.0\n');
      mockSpawnOutputOnce('Would make no changes\n');

      await expect(virtualEnv.hasRequirements()).resolves.toBe('package-upgrade');
    });

    test('throws error when pip command fails', async ({ virtualEnv }) => {
      mockSpawnOutputOnce('Would make no changes\n', 1, null);

      await expect(virtualEnv.hasRequirements()).rejects.toThrow('Failed to get packages: Exit code 1');
    });

    test('throws error when pip output is empty', async ({ virtualEnv }) => {
      mockSpawnOutputOnce('', 0, null);

      await expect(virtualEnv.hasRequirements()).rejects.toThrow('Failed to get packages: uv output was empty');
    });

    test('handles stderr output', async ({ virtualEnv }) => {
      mockSpawnOutputOnce('', 0, null, 'Would make no changes\n');
      mockSpawnOutputOnce('', 0, null, 'Would make no changes\n');

      await expect(virtualEnv.hasRequirements()).resolves.toBe('OK');
    });

    test('rejects core upgrade with unrecognized package removal', async ({ virtualEnv }) => {
      mockSpawnOutputOnce(' - unknown-package==1.0.0\n + aiohttp==3.9.0\n', 0, null);
      mockSpawnOutputOnce('Would make no changes\n', 0, null);

      await expect(virtualEnv.hasRequirements()).resolves.toBe('package-upgrade');
    });
  });

  describe('uvEnv', () => {
    test('includes VIRTUAL_ENV and UV_PYTHON_INSTALL_MIRROR when pythonMirror is set', () => {
      vi.stubGlobal('process', {
        ...process,
        resourcesPath: '/test/resources',
      });

      const mirror = 'https://python.example.com';
      const envWithMirror = new VirtualEnvironment('/mock/venv', {
        telemetry: mockTelemetry,
        selectedDevice: 'cpu',
        pythonVersion: '3.12',
        pythonMirror: mirror,
      });

      const { uvEnv } = envWithMirror;
      expect(uvEnv.VIRTUAL_ENV).toBe(envWithMirror.venvPath);
      expect('UV_PYTHON_INSTALL_MIRROR' in uvEnv).toBe(true);
      expect(uvEnv.UV_PYTHON_INSTALL_MIRROR).toBe(mirror);
    });

    test('omits UV_PYTHON_INSTALL_MIRROR when pythonMirror is undefined', ({ virtualEnv }) => {
      const { uvEnv } = virtualEnv;
      expect(uvEnv.VIRTUAL_ENV).toBe(virtualEnv.venvPath);
      expect('UV_PYTHON_INSTALL_MIRROR' in uvEnv).toBe(false);
    });

    test('omits UV_PYTHON_INSTALL_MIRROR when pythonMirror is empty string', () => {
      vi.stubGlobal('process', {
        ...process,
        resourcesPath: '/test/resources',
      });

      const envNoMirror = new VirtualEnvironment('/mock/venv', {
        telemetry: mockTelemetry,
        selectedDevice: 'cpu',
        pythonVersion: '3.12',
        pythonMirror: '',
      });

      const { uvEnv } = envNoMirror;
      expect(uvEnv.VIRTUAL_ENV).toBe(envNoMirror.venvPath);
      expect('UV_PYTHON_INSTALL_MIRROR' in uvEnv).toBe(false);
      expect(uvEnv.UV_PYTHON_INSTALL_MIRROR).toBeUndefined();
    });
  });
});

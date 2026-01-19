import log from 'electron-log/main';
import { type ChildProcess, spawn } from 'node:child_process';
import path from 'node:path';
import { test as baseTest, describe, expect, vi } from 'vitest';

import {
  NVIDIA_TORCHVISION_VERSION,
  NVIDIA_TORCH_RECOMMENDED_VERSION,
  NVIDIA_TORCH_VERSION,
  TorchMirrorUrl,
} from '@/constants';
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

  describe('isUsingRecommendedTorchMirror', () => {
    test('returns true when using default mirror for NVIDIA', () => {
      vi.stubGlobal('process', {
        ...process,
        resourcesPath: '/test/resources',
      });

      const env = new VirtualEnvironment('/mock/venv', {
        telemetry: mockTelemetry,
        selectedDevice: 'nvidia',
        pythonVersion: '3.12',
        torchMirror: TorchMirrorUrl.Cuda,
      });

      expect(env.isUsingRecommendedTorchMirror()).toBe(true);
    });

    test('returns false when using a custom mirror', () => {
      vi.stubGlobal('process', {
        ...process,
        resourcesPath: '/test/resources',
      });

      const env = new VirtualEnvironment('/mock/venv', {
        telemetry: mockTelemetry,
        selectedDevice: 'nvidia',
        pythonVersion: '3.12',
        torchMirror: 'https://download.pytorch.org/whl/cu128',
      });

      expect(env.isUsingRecommendedTorchMirror()).toBe(false);
    });
  });

  describe('updateTorchUpdatePolicy', () => {
    test('clears pinned packages when policy is not pinned', () => {
      vi.stubGlobal('process', {
        ...process,
        resourcesPath: '/test/resources',
      });

      const env = new VirtualEnvironment('/mock/venv', {
        telemetry: mockTelemetry,
        selectedDevice: 'nvidia',
        pythonVersion: '3.12',
        torchUpdatePolicy: 'pinned',
        torchPinnedPackages: { torch: '2.8.0+cu130' },
      });

      env.updateTorchUpdatePolicy('auto');

      expect(env.torchUpdatePolicy).toBe('auto');
      expect(env.torchPinnedPackages).toBeUndefined();
    });

    test('stores pinned packages and decision version when provided', () => {
      vi.stubGlobal('process', {
        ...process,
        resourcesPath: '/test/resources',
      });

      const env = new VirtualEnvironment('/mock/venv', {
        telemetry: mockTelemetry,
        selectedDevice: 'nvidia',
        pythonVersion: '3.12',
      });

      env.updateTorchUpdatePolicy('pinned', { torch: NVIDIA_TORCH_VERSION }, 'decision');

      expect(env.torchUpdatePolicy).toBe('pinned');
      expect(env.torchPinnedPackages).toEqual({ torch: NVIDIA_TORCH_VERSION });
      expect(env.torchUpdateDecisionVersion).toBe('decision');
    });
  });

  describe('ensureRecommendedNvidiaTorch', () => {
    test('skips upgrade when updates are pinned for the current recommended version', async () => {
      vi.stubGlobal('process', {
        ...process,
        resourcesPath: '/test/resources',
      });

      const env = new VirtualEnvironment('/mock/venv', {
        telemetry: mockTelemetry,
        selectedDevice: 'nvidia',
        pythonVersion: '3.12',
        torchUpdatePolicy: 'pinned',
        torchUpdateDecisionVersion: NVIDIA_TORCH_RECOMMENDED_VERSION,
      });

      const versionsSpy = vi.spyOn(env, 'getInstalledTorchPackageVersions');

      await env.ensureRecommendedNvidiaTorch();

      expect(versionsSpy).not.toHaveBeenCalled();
    });

    test('does not skip upgrade when pinned decision version differs', async () => {
      vi.stubGlobal('process', {
        ...process,
        resourcesPath: '/test/resources',
      });

      const env = new VirtualEnvironment('/mock/venv', {
        telemetry: mockTelemetry,
        selectedDevice: 'nvidia',
        pythonVersion: '3.12',
        torchUpdatePolicy: 'pinned',
        torchUpdateDecisionVersion: '2.8.0+cu130|0.23.0+cu130',
      });

      const versionsSpy = vi.spyOn(env, 'getInstalledTorchPackageVersions').mockResolvedValue({
        torch: NVIDIA_TORCH_VERSION,
        torchaudio: NVIDIA_TORCH_VERSION,
        torchvision: NVIDIA_TORCHVISION_VERSION,
      });

      await env.ensureRecommendedNvidiaTorch();

      expect(versionsSpy).toHaveBeenCalled();
    });

    test('skips upgrade when updates are deferred for the recommended version', async () => {
      vi.stubGlobal('process', {
        ...process,
        resourcesPath: '/test/resources',
      });

      const env = new VirtualEnvironment('/mock/venv', {
        telemetry: mockTelemetry,
        selectedDevice: 'nvidia',
        pythonVersion: '3.12',
        torchUpdatePolicy: 'defer',
        torchUpdateDecisionVersion: NVIDIA_TORCH_RECOMMENDED_VERSION,
      });

      const versionsSpy = vi.spyOn(env, 'getInstalledTorchPackageVersions');

      await env.ensureRecommendedNvidiaTorch();

      expect(versionsSpy).not.toHaveBeenCalled();
    });
  });

  describe('isNvidiaTorchOutOfDate', () => {
    test('returns false when device is not NVIDIA', async ({ virtualEnv }) => {
      const versionsSpy = vi.spyOn(virtualEnv, 'getInstalledTorchPackageVersions');

      await expect(virtualEnv.isNvidiaTorchOutOfDate()).resolves.toBe(false);
      expect(versionsSpy).not.toHaveBeenCalled();
    });

    test('returns true when installed versions are below recommended', async () => {
      vi.stubGlobal('process', {
        ...process,
        resourcesPath: '/test/resources',
      });

      const env = new VirtualEnvironment('/mock/venv', {
        telemetry: mockTelemetry,
        selectedDevice: 'nvidia',
        pythonVersion: '3.12',
      });

      mockSpawnOutputOnce(
        JSON.stringify([
          { name: 'torch', version: '2.8.0+cu130' },
          { name: 'torchaudio', version: '2.8.0+cu130' },
          { name: 'torchvision', version: '0.23.0+cu130' },
        ])
      );

      await expect(env.isNvidiaTorchOutOfDate()).resolves.toBe(true);
    });

    test('returns false when installed versions meet the recommended minimums', async () => {
      vi.stubGlobal('process', {
        ...process,
        resourcesPath: '/test/resources',
      });

      const env = new VirtualEnvironment('/mock/venv', {
        telemetry: mockTelemetry,
        selectedDevice: 'nvidia',
        pythonVersion: '3.12',
      });

      mockSpawnOutputOnce(
        JSON.stringify([
          { name: 'torch', version: NVIDIA_TORCH_VERSION },
          { name: 'torchaudio', version: NVIDIA_TORCH_VERSION },
          { name: 'torchvision', version: NVIDIA_TORCHVISION_VERSION },
        ])
      );

      await expect(env.isNvidiaTorchOutOfDate()).resolves.toBe(false);
    });
  });

  describe('getInstalledTorchPackageVersions', () => {
    test('returns parsed torch versions from uv json output', async ({ virtualEnv }) => {
      const output = `[{"name":"aiohappyeyeballs","version":"2.6.1"},{"name":"aiohttp","version":"3.13.3"},{"name":"aiosignal","version":"1.4.0"},{"name":"alembic","version":"1.18.1"},{"name":"annotated-types","version":"0.7.0"},{"name":"attrs","version":"25.4.0"},{"name":"av","version":"16.1.0"},{"name":"certifi","version":"2026.1.4"},{"name":"charset-normalizer","version":"3.4.4"},{"name":"comfy-kitchen","version":"0.2.6"},{"name":"comfyui-embedded-docs","version":"0.4.0"},{"name":"comfyui-frontend-package","version":"1.36.14"},{"name":"comfyui-workflow-templates","version":"0.8.4"},{"name":"comfyui-workflow-templates-core","version":"0.3.88"},{"name":"comfyui-workflow-templates-media-api","version":"0.3.39"},{"name":"comfyui-workflow-templates-media-image","version":"0.3.55"},{"name":"comfyui-workflow-templates-media-other","version":"0.3.80"},{"name":"comfyui-workflow-templates-media-video","version":"0.3.38"},{"name":"einops","version":"0.8.1"},{"name":"filelock","version":"3.20.3"},{"name":"frozenlist","version":"1.8.0"},{"name":"fsspec","version":"2026.1.0"},{"name":"greenlet","version":"3.3.0"},{"name":"hf-xet","version":"1.2.0"},{"name":"huggingface-hub","version":"0.36.0"},{"name":"idna","version":"3.11"},{"name":"jinja2","version":"3.1.6"},{"name":"kornia","version":"0.8.2"},{"name":"kornia-rs","version":"0.1.10"},{"name":"mako","version":"1.3.10"},{"name":"markupsafe","version":"3.0.3"},{"name":"mpmath","version":"1.3.0"},{"name":"multidict","version":"6.7.0"},{"name":"networkx","version":"3.6.1"},{"name":"numpy","version":"2.4.1"},{"name":"nvidia-cublas","version":"13.0.0.19"},{"name":"nvidia-cuda-cupti","version":"13.0.48"},{"name":"nvidia-cuda-nvrtc","version":"13.0.48"},{"name":"nvidia-cuda-runtime","version":"13.0.48"},{"name":"nvidia-cudnn-cu13","version":"9.13.0.50"},{"name":"nvidia-cufft","version":"12.0.0.15"},{"name":"nvidia-cufile","version":"1.15.0.42"},{"name":"nvidia-curand","version":"10.4.0.35"},{"name":"nvidia-cusolver","version":"12.0.3.29"},{"name":"nvidia-cusparse","version":"12.6.2.49"},{"name":"nvidia-cusparselt-cu13","version":"0.8.0"},{"name":"nvidia-nccl-cu13","version":"2.27.7"},{"name":"nvidia-nvjitlink","version":"13.0.39"},{"name":"nvidia-nvshmem-cu13","version":"3.3.24"},{"name":"nvidia-nvtx","version":"13.0.39"},{"name":"packaging","version":"25.0"},{"name":"pillow","version":"12.1.0"},{"name":"pip","version":"24.0"},{"name":"propcache","version":"0.4.1"},{"name":"psutil","version":"7.2.1"},{"name":"pydantic","version":"2.12.5"},{"name":"pydantic-core","version":"2.41.5"},{"name":"pydantic-settings","version":"2.12.0"},{"name":"python-dotenv","version":"1.2.1"},{"name":"pyyaml","version":"6.0.3"},{"name":"regex","version":"2026.1.15"},{"name":"requests","version":"2.32.5"},{"name":"safetensors","version":"0.7.0"},{"name":"scipy","version":"1.17.0"},{"name":"sentencepiece","version":"0.2.1"},{"name":"setuptools","version":"80.9.0"},{"name":"spandrel","version":"0.4.1"},{"name":"sqlalchemy","version":"2.0.45"},{"name":"sympy","version":"1.14.0"},{"name":"tokenizers","version":"0.22.2"},{"name":"torch","version":"2.9.1+cu130"},{"name":"torchaudio","version":"2.9.1+cu130"},{"name":"torchsde","version":"0.2.6"},{"name":"torchvision","version":"0.24.1+cu130"},{"name":"tqdm","version":"4.67.1"},{"name":"trampoline","version":"0.1.2"},{"name":"transformers","version":"4.57.5"},{"name":"triton","version":"3.5.1"},{"name":"typing-extensions","version":"4.15.0"},{"name":"typing-inspection","version":"0.4.2"},{"name":"urllib3","version":"2.6.3"},{"name":"yarl","version":"1.22.0"}]`;

      mockSpawnOutputOnce(output);

      await expect(virtualEnv.getInstalledTorchPackageVersions()).resolves.toEqual({
        torch: '2.9.1+cu130',
        torchaudio: '2.9.1+cu130',
        torchvision: '0.24.1+cu130',
      });
    });

    test('returns undefined when uv output contains no torch packages', async ({ virtualEnv }) => {
      const output = JSON.stringify([{ name: 'numpy', version: '2.1.0' }]);
      mockSpawnOutputOnce(output);

      await expect(virtualEnv.getInstalledTorchPackageVersions()).resolves.toBeUndefined();
    });

    test('returns undefined when uv output is not JSON', async ({ virtualEnv }) => {
      mockSpawnOutputOnce('not json');

      await expect(virtualEnv.getInstalledTorchPackageVersions()).resolves.toBeUndefined();
    });

    test('returns undefined when uv output is not an array', async ({ virtualEnv }) => {
      mockSpawnOutputOnce(JSON.stringify({ name: 'torch', version: NVIDIA_TORCH_VERSION }));

      await expect(virtualEnv.getInstalledTorchPackageVersions()).resolves.toBeUndefined();
    });

    test('returns undefined when uv exits with non-zero code', async ({ virtualEnv }) => {
      mockSpawnOutputOnce(JSON.stringify([]), 1);

      await expect(virtualEnv.getInstalledTorchPackageVersions()).resolves.toBeUndefined();
    });
  });
});

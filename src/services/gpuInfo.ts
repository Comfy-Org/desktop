import log from 'electron-log/main';
import { exec } from 'node:child_process';
import si from 'systeminformation';

import { compareVersions } from '../utils';

/** Unified GPU metadata used for telemetry and error reporting. */
export interface GpuInfo {
  model: string;
  vendor: string;
  vram: number | null;
  driverVersion: string | null;
}

const normalizeDriverVersion = (version: string | null | undefined): string | null => version?.trim() || null;

const isNvidiaVendor = (vendor: string): boolean => vendor.toLowerCase().includes('nvidia');

const runExec = (command: string): Promise<{ stdout: string; stderr: string }> =>
  new Promise((resolve, reject) => {
    exec(command, (error, stdout, stderr) => {
      if (error) {
        reject(error);
        return;
      }
      resolve({ stdout, stderr });
    });
  });

/**
 * Extracts the NVIDIA driver version from `nvidia-smi` output.
 * @param output The `nvidia-smi` output to parse.
 * @returns The driver version, if present.
 */
export function parseNvidiaDriverVersionFromSmiOutput(output: string): string | undefined {
  const match = output.match(/driver version\s*:\s*([\d.]+)/i);
  return match?.[1];
}

/**
 * Returns `true` when the NVIDIA driver version is below the minimum.
 * @param driverVersion The detected driver version.
 * @param minimumVersion The minimum required driver version.
 */
export function isNvidiaDriverBelowMinimum(driverVersion: string, minimumVersion: string): boolean {
  return compareVersions(driverVersion, minimumVersion) < 0;
}

/**
 * Reads the NVIDIA driver version from nvidia-smi query output.
 * @returns The first non-empty driver version line, if available.
 */
async function getNvidiaDriverVersionFromSmiQuery(): Promise<string | undefined> {
  try {
    const { stdout } = await runExec('nvidia-smi --query-gpu=driver_version --format=csv,noheader');
    return stdout
      .split(/\r?\n/)
      .map((line) => normalizeDriverVersion(line))
      .find((line) => line !== null);
  } catch (error) {
    log.debug('Failed to read NVIDIA driver version via nvidia-smi query.', error);
    return undefined;
  }
}

/**
 * Reads the NVIDIA driver version from nvidia-smi standard output.
 * @returns The parsed driver version, if available.
 */
async function getNvidiaDriverVersionFromSmiFallback(): Promise<string | undefined> {
  try {
    const { stdout } = await runExec('nvidia-smi');
    return normalizeDriverVersion(parseNvidiaDriverVersionFromSmiOutput(stdout)) ?? undefined;
  } catch (error) {
    log.debug('Failed to read NVIDIA driver version via nvidia-smi output.', error);
    return undefined;
  }
}

/**
 * Reads the NVIDIA driver version using the preferred query and fallback parser.
 * @returns The detected driver version, if available.
 */
export async function getNvidiaDriverVersionFromSmi(): Promise<string | undefined> {
  return (await getNvidiaDriverVersionFromSmiQuery()) ?? (await getNvidiaDriverVersionFromSmiFallback());
}

/**
 * Collects GPU metadata and normalizes driver versions.
 * Missing NVIDIA driver versions are backfilled using `nvidia-smi`.
 * @returns Normalized GPU metadata for all detected controllers.
 */
export async function collectGpuInformation(): Promise<GpuInfo[]> {
  const gpuData = await si.graphics();
  const gpus = gpuData.controllers.map((gpu) => ({
    model: gpu.model,
    vendor: gpu.vendor,
    vram: gpu.vram,
    driverVersion: normalizeDriverVersion(gpu.driverVersion),
  }));

  const hasMissingNvidiaDriver = gpus.some((gpu) => isNvidiaVendor(gpu.vendor) && !gpu.driverVersion);
  if (!hasMissingNvidiaDriver) return gpus;

  const nvidiaDriverVersion = await getNvidiaDriverVersionFromSmi();
  if (!nvidiaDriverVersion) return gpus;

  return gpus.map((gpu) => {
    if (!isNvidiaVendor(gpu.vendor) || gpu.driverVersion) return gpu;
    return {
      ...gpu,
      driverVersion: nvidiaDriverVersion,
    };
  });
}

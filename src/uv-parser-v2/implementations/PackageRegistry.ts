/**
 * UV Parser V2 - Package Registry Implementation
 *
 * Concrete implementation of IPackageRegistry for tracking packages during UV installation.
 * This is a minimal implementation focused on core package tracking functionality.
 */
import { IPackageInfo, IPackageRegistry } from '../architecture';

/**
 * Concrete implementation of package registry for tracking packages during UV installation.
 *
 * Provides core functionality for:
 * - Registering and updating package information
 * - Tracking package status throughout installation lifecycle
 * - Providing statistics for progress tracking
 * - Merging partial package information from multiple sources
 */
export class PackageRegistry implements IPackageRegistry {
  private readonly packages: Map<string, IPackageInfo> = new Map();

  /**
   * Registers a new package or updates existing package info with merging.
   * If package exists, new information is merged with existing data.
   * If package doesn't exist, creates new entry with sensible defaults.
   *
   * @param info Partial package information, must include name
   */
  registerPackage(info: Partial<IPackageInfo> & { name: string }): void {
    const existing = this.packages.get(info.name);

    if (existing) {
      // Merge new info with existing, preserving discoveredAt from original
      const merged: IPackageInfo = {
        ...existing,
        ...info,
        // Always preserve the original discovery time
        discoveredAt: existing.discoveredAt,
      };
      this.packages.set(info.name, merged);
    } else {
      // Create new package with defaults
      const newPackage: IPackageInfo = {
        name: info.name,
        version: info.version || '',
        versionSpec: info.versionSpec,
        url: info.url,
        sizeBytes: info.sizeBytes || 0,
        discoveredAt: info.discoveredAt || Date.now(),
        status: info.status || 'pending',
      };
      this.packages.set(info.name, newPackage);
    }
  }

  /**
   * Gets information about a specific package.
   *
   * @param name Package name
   * @returns Package info or undefined if not found
   */
  getPackage(name: string): IPackageInfo | undefined {
    return this.packages.get(name);
  }

  /**
   * Gets all registered packages.
   *
   * @returns Array of all package information
   */
  getAllPackages(): IPackageInfo[] {
    return [...this.packages.values()];
  }

  /**
   * Gets packages filtered by status.
   *
   * @param status Status to filter by
   * @returns Array of matching packages
   */
  getPackagesByStatus(status: IPackageInfo['status']): IPackageInfo[] {
    return [...this.packages.values()].filter((pkg) => pkg.status === status);
  }

  /**
   * Updates the status of a package.
   * Only updates if the package exists in the registry.
   *
   * @param name Package name
   * @param status New status
   */
  updatePackageStatus(name: string, status: IPackageInfo['status']): void {
    const existing = this.packages.get(name);
    if (existing) {
      this.packages.set(name, {
        ...existing,
        status,
      });
    }
  }

  /**
   * Gets count statistics for packages by status.
   *
   * @returns Object with counts by status
   */
  getStatistics(): {
    total: number;
    pending: number;
    downloading: number;
    downloaded: number;
    installing: number;
    installed: number;
    failed: number;
  } {
    const stats = {
      total: 0,
      pending: 0,
      downloading: 0,
      downloaded: 0,
      installing: 0,
      installed: 0,
      failed: 0,
    };

    for (const pkg of this.packages.values()) {
      stats.total++;
      stats[pkg.status]++;
    }

    return stats;
  }

  /**
   * Resets the registry, removing all packages.
   */
  reset(): void {
    this.packages.clear();
  }
}

/**
 * Minimal StateBuilder Implementation for UV Parser V2
 *
 * This is a production-ready, minimal implementation of the IStateBuilder interface
 * that builds unified installation state from all registered component data sources.
 */
import type { IDownloadManager, IInstallationState, IPackageRegistry, IPhaseManager } from '../architecture';
import type { IStateBuilder } from '../architecture-extended';

/**
 * Builds unified installation state from all component data sources.
 * Queries registered components to construct a complete IInstallationState.
 */
export class StateBuilder implements IStateBuilder {
  /** Registered data sources for state building */
  private phaseManager?: IPhaseManager;
  private packageRegistry?: IPackageRegistry;
  private downloadManager?: IDownloadManager;
  private processInfo: {
    uvVersion?: string;
    pythonVersion?: string;
    requirementsFile?: string;
    startTime?: number;
  } = {};

  /**
   * Builds the current installation state by querying all registered components.
   *
   * @returns Current installation state
   */
  buildState(): IInstallationState {
    const currentPhase = this.phaseManager?.getCurrentPhase() ?? 'idle';
    const phaseHistory = this.phaseManager?.getPhaseHistory() ?? ['idle'];
    const packageStats = this.packageRegistry?.getStatistics() ?? {
      total: 0,
      pending: 0,
      downloading: 0,
      downloaded: 0,
      installing: 0,
      installed: 0,
      failed: 0,
    };

    // Calculate timing information
    const timing = this.calculateTiming();

    // Build current operation information
    const currentOperation = this.buildCurrentOperation();

    // Calculate overall progress
    const overallProgress = this.calculateOverallProgress(currentPhase, packageStats);

    // Determine if installation is complete
    const isComplete = this.isInstallationComplete(currentPhase);

    // Generate human-readable message
    const message = this.generateStatusMessage({
      phase: currentPhase,
      phaseHistory,
      message: '', // Will be overwritten
      packages: {
        total: packageStats.total,
        resolved: packageStats.total - packageStats.pending,
        downloaded: packageStats.downloaded,
        installed: packageStats.installed,
      },
      currentOperation,
      overallProgress,
      isComplete,
      timing,
    } as IInstallationState);

    // Check for error state
    const error = currentPhase === 'error' ? this.buildErrorInfo() : undefined;

    return {
      phase: currentPhase,
      phaseHistory,
      message,
      uvVersion: this.processInfo.uvVersion,
      pythonVersion: this.processInfo.pythonVersion,
      requirementsFile: this.processInfo.requirementsFile,
      packages: {
        total: packageStats.total,
        resolved: packageStats.total - packageStats.pending,
        downloaded: packageStats.downloaded,
        installed: packageStats.installed,
      },
      currentOperation,
      overallProgress,
      isComplete,
      error,
      timing,
    };
  }

  /**
   * Registers a data source component for state building.
   *
   * @param sourceType Type of source component
   * @param source Component instance
   */
  registerDataSource(sourceType: string, source: unknown): void {
    switch (sourceType) {
      case 'phaseManager':
        this.phaseManager = source as IPhaseManager;
        break;
      case 'packageRegistry':
        this.packageRegistry = source as IPackageRegistry;
        break;
      case 'downloadManager':
        this.downloadManager = source as IDownloadManager;
        break;
      case 'processInfo':
        // Handle process info registration
        if (typeof source === 'object' && source !== null) {
          this.processInfo = { ...this.processInfo, ...(source as typeof this.processInfo) };
        }
        break;
      default:
        // Ignore unknown source types in minimal implementation
        break;
    }
  }

  /**
   * Generates a human-readable status message for the current state.
   *
   * @param state Current installation state
   * @returns Human-readable status message
   */
  generateStatusMessage(state: IInstallationState): string {
    switch (state.phase) {
      case 'idle':
        return 'Ready to start installation';

      case 'started':
        return 'Starting UV installation process';

      case 'reading_requirements':
        return state.requirementsFile ? `Reading requirements from ${state.requirementsFile}` : 'Reading requirements';

      case 'resolving':
        return 'Resolving package dependencies';

      case 'resolved':
        return state.packages.total > 0
          ? `Resolved ${state.packages.total} package${state.packages.total === 1 ? '' : 's'}`
          : 'Package resolution completed';

      case 'preparing_download':
        return 'Preparing package downloads';

      case 'downloading': {
        if (state.currentOperation?.packageName) {
          return `Downloading ${state.currentOperation.packageName}`;
        }
        const downloadedCount = state.packages.downloaded;
        const totalCount = state.packages.total;
        return totalCount > 0 ? `Downloaded ${downloadedCount}/${totalCount} packages` : 'Downloading packages';
      }

      case 'prepared':
        return 'Packages prepared for installation';

      case 'installing': {
        if (state.currentOperation?.packageName) {
          return `Installing ${state.currentOperation.packageName}`;
        }
        const installedCount = state.packages.installed;
        const total = state.packages.total;
        return total > 0 ? `Installed ${installedCount}/${total} packages` : 'Installing packages';
      }

      case 'installed':
        return state.packages.total > 0
          ? `Successfully installed ${state.packages.total} package${state.packages.total === 1 ? '' : 's'}`
          : 'Installation completed successfully';

      case 'error':
        return state.error?.message ?? 'Installation failed with an error';

      default:
        return `Installation in progress (${state.phase})`;
    }
  }

  /**
   * Checks if the installation is complete (either success or failure).
   *
   * @param state Current installation state
   * @returns true if installation is complete
   */
  isComplete(state: IInstallationState): boolean {
    return this.isInstallationComplete(state.phase);
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Calculates timing information from registered components.
   */
  private calculateTiming(): IInstallationState['timing'] {
    const phaseDurations: Partial<Record<string, number>> = {};

    // Get phase timestamps from phase manager if available
    if (this.phaseManager) {
      const history = this.phaseManager.getPhaseHistory();
      for (let i = 0; i < history.length - 1; i++) {
        const phase = history[i];
        const phaseStartTime = this.phaseManager.getPhaseTimestamp(phase);
        const nextPhaseTime = this.phaseManager.getPhaseTimestamp(history[i + 1]);

        if (phaseStartTime && nextPhaseTime) {
          phaseDurations[phase] = nextPhaseTime - phaseStartTime;
        }
      }
    }

    return {
      startTime: this.processInfo.startTime,
      endTime: this.isInstallationComplete(this.phaseManager?.getCurrentPhase() ?? 'idle') ? Date.now() : undefined,
      phaseDurations,
    };
  }

  /**
   * Builds current operation information from active downloads.
   */
  private buildCurrentOperation(): IInstallationState['currentOperation'] {
    if (!this.downloadManager) {
      return undefined;
    }

    const activeDownloads = this.downloadManager.getActiveDownloads();
    if (activeDownloads.length === 0) {
      return undefined;
    }

    // For minimal implementation, just report the first active download
    const download = activeDownloads[0];
    const currentPhase = this.phaseManager?.getCurrentPhase() ?? 'idle';

    let operationType: 'resolving' | 'downloading' | 'installing';
    if (currentPhase === 'resolving') {
      operationType = 'resolving';
    } else if (currentPhase === 'installing') {
      operationType = 'installing';
    } else {
      operationType = 'downloading';
    }

    return {
      type: operationType,
      packageName: download.packageName,
      progress: {
        packageName: download.packageName,
        totalBytes: download.totalBytes,
        bytesReceived: download.bytesReceived,
        percentComplete: download.totalBytes > 0 ? Math.round((download.bytesReceived / download.totalBytes) * 100) : 0,
        transferRate: this.calculateTransferRate(download),
        elapsedMs: Date.now() - download.startTime,
      },
    };
  }

  /**
   * Calculates overall progress percentage.
   */
  private calculateOverallProgress(
    currentPhase: string,
    packageStats: { total: number; downloaded: number; installed: number; pending: number }
  ): number {
    // Progress weights for each phase (total = 100%)
    const phaseWeights = {
      idle: 0,
      started: 5,
      reading_requirements: 10,
      resolving: 15,
      resolved: 20,
      preparing_download: 25,
      downloading: 30, // Base weight, adds up to 65% when downloads complete
      prepared: 65,
      installing: 35, // Base weight, adds up to 100% when installation complete
      installed: 100,
      error: 0, // Error stops progress
    };

    const baseProgress = phaseWeights[currentPhase as keyof typeof phaseWeights] ?? 0;

    if (currentPhase === 'downloading' && packageStats.total > 0) {
      // During downloading: 25% base + up to 40% for download progress
      const downloadProgress = (packageStats.downloaded / packageStats.total) * 40;
      return Math.min(baseProgress + downloadProgress, 65);
    }

    if (currentPhase === 'installing' && packageStats.total > 0) {
      // During installation: 65% base + up to 35% for installation progress
      const installProgress = (packageStats.installed / packageStats.total) * 35;
      return Math.min(baseProgress + installProgress, 100);
    }

    return baseProgress;
  }

  /**
   * Checks if the given phase indicates completion.
   */
  private isInstallationComplete(phase: string): boolean {
    return phase === 'installed' || phase === 'error';
  }

  /**
   * Builds error information for error state.
   */
  private buildErrorInfo(): IInstallationState['error'] {
    return {
      message: 'Installation encountered an error',
      phase: this.phaseManager?.getCurrentPhase() ?? 'error',
      timestamp: Date.now(),
    };
  }

  /**
   * Calculates simple transfer rate for a download.
   */
  private calculateTransferRate(download: { bytesReceived: number; startTime: number }): number {
    const elapsedSeconds = (Date.now() - download.startTime) / 1000;
    return elapsedSeconds > 0 ? download.bytesReceived / elapsedSeconds : 0;
  }
}

/**
 * Example StateAggregator Implementation with Strongly-Typed Events
 *
 * This example demonstrates how to use the discriminated union ILogEvent
 * with proper type checking and IntelliSense support.
 */
import type {
  IDownloadManager,
  IInstallationState,
  ILogEvent,
  IPackageRegistry,
  IPhaseManager,
  IProgressCalculator,
  IStateAggregator,
  IStreamTracker,
  InstallationPhase,
} from './architecture';
import { isDownloadEvent, isEventType, isHttp2Event } from './architecture';

/**
 * Example implementation of StateAggregator showing type-safe event handling
 */
export class StateAggregator implements IStateAggregator {
  private readonly phaseManager: IPhaseManager;
  private readonly packageRegistry: IPackageRegistry;
  private readonly downloadManager: IDownloadManager;
  private readonly streamTracker: IStreamTracker;
  private readonly progressCalculator: IProgressCalculator;

  private uvVersion?: string;
  private pythonVersion?: string;
  private requirementsFile?: string;
  private startTime?: number;
  private endTime?: number;
  private error?: { message: string; phase: InstallationPhase; timestamp: number };

  constructor(components: {
    phaseManager: IPhaseManager;
    packageRegistry: IPackageRegistry;
    downloadManager: IDownloadManager;
    streamTracker: IStreamTracker;
    progressCalculator: IProgressCalculator;
  }) {
    this.phaseManager = components.phaseManager;
    this.packageRegistry = components.packageRegistry;
    this.downloadManager = components.downloadManager;
    this.streamTracker = components.streamTracker;
    this.progressCalculator = components.progressCalculator;
  }

  /**
   * Process events with full type safety
   * The discriminated union ensures we can access event-specific data safely
   */
  processEvent(event: ILogEvent): void {
    // Handle each event type with full type safety
    switch (event.type) {
      case 'process_start':
        // TypeScript knows event.data is ProcessStartData here
        this.uvVersion = event.data.version;
        this.startTime = event.timestamp;
        this.phaseManager.transitionTo('started');
        break;

      case 'requirements_file':
        // TypeScript knows event.data is RequirementsFileData here
        this.requirementsFile = event.data.file;
        this.phaseManager.transitionTo('reading_requirements');
        break;

      case 'python_version':
        // TypeScript knows event.data is PythonVersionData here
        this.pythonVersion = event.data.version;
        this.phaseManager.transitionTo('resolving');
        break;

      case 'dependency_added':
        // TypeScript knows event.data is DependencyAddedData here
        this.packageRegistry.registerPackage({
          name: event.data.packageName,
          versionSpec: event.data.versionSpec,
        });
        break;

      case 'resolution_complete':
        // TypeScript knows event.data is ResolutionCompleteData here
        this.phaseManager.transitionTo('resolved');
        console.log(`Resolved ${event.data.packageCount} packages in ${event.data.duration}s`);
        break;

      case 'download_prepare':
        // TypeScript knows event.data is DownloadPrepareData here
        this.packageRegistry.registerPackage({
          name: event.data.packageName,
          version: event.data.version,
          sizeBytes: event.data.size,
          url: event.data.url,
        });

        this.downloadManager.startDownload(event.data.packageName, event.data.size, event.data.url);

        this.phaseManager.transitionTo('preparing_download');
        break;

      case 'http2_headers': {
        // TypeScript knows event.data is Http2HeadersData here
        this.streamTracker.registerStream(event.data.streamId, event.timestamp);

        // Try to associate with an active download
        const activeDownloads = this.downloadManager.getActiveDownloads();
        if (activeDownloads.length > 0) {
          const download = activeDownloads[0];
          this.streamTracker.associateWithPackage(event.data.streamId, download.packageName);
          this.downloadManager.associateStream(download.packageName, event.data.streamId);
        }
        break;
      }

      case 'http2_data': {
        // TypeScript knows event.data is Http2DataData here
        this.streamTracker.recordDataFrame(event.data.streamId, event.timestamp, event.data.isEndStream);

        // Update download progress
        const packageName = this.streamTracker.getPackageForStream(event.data.streamId);
        if (packageName) {
          const download = this.downloadManager.getDownload(packageName);
          const stream = this.streamTracker.getStream(event.data.streamId);

          if (download && stream) {
            const progress = this.progressCalculator.calculateProgress(
              download,
              stream,
              this.streamTracker.getMaxFrameSize()
            );

            this.downloadManager.updateProgress(packageName, progress.bytesReceived);

            if (event.data.isEndStream) {
              this.downloadManager.completeDownload(packageName);
              this.packageRegistry.updatePackageStatus(packageName, 'downloaded');
            }
          }
        }

        this.phaseManager.transitionTo('downloading');
        break;
      }

      case 'http2_settings':
        // TypeScript knows event.data is Http2SettingsData here
        this.streamTracker.updateMaxFrameSize(event.data.maxFrameSize);
        break;

      case 'packages_prepared':
        // TypeScript knows event.data is PackagesPreparedData here
        this.phaseManager.transitionTo('prepared');
        console.log(`Prepared ${event.data.count} packages in ${event.data.duration}ms`);
        break;

      case 'installation_start':
        // TypeScript knows event.data is InstallationStartData here
        this.phaseManager.transitionTo('installing');
        console.log(`Installing ${event.data.wheelCount} wheels`);
        break;

      case 'installation_complete':
        // TypeScript knows event.data is InstallationCompleteData here
        this.phaseManager.transitionTo('installed');
        this.endTime = event.timestamp;
        console.log(`Installed ${event.data.count} packages in ${event.data.duration}ms`);
        break;

      case 'error':
        // TypeScript knows event.data is ErrorData here
        this.phaseManager.transitionTo('error');
        this.error = {
          message: event.data.message,
          phase: this.phaseManager.getCurrentPhase(),
          timestamp: event.timestamp,
        };

        // Mark any active downloads as failed
        for (const download of this.downloadManager.getActiveDownloads()) {
          this.downloadManager.failDownload(download.packageName, event.data.message);
          this.packageRegistry.updatePackageStatus(download.packageName, 'failed');
        }
        break;

      case 'warning':
        // TypeScript knows event.data is WarningData here
        console.warn(`Warning: ${event.data.message}`);
        break;

      case 'unknown':
        // TypeScript knows event.data is UnknownData here
        console.debug('Unknown event:', event.data.line || event.data.match);
        break;

      default: {
        // TypeScript ensures this is exhaustive - all cases are handled
        // Using a type assertion to handle the never case
        const unhandledEvent = event as { type: string };
        console.warn('Unhandled event type:', unhandledEvent.type);
      }
    }
  }

  /**
   * Alternative: Using type guards for conditional handling
   */
  processEventWithTypeGuards(event: ILogEvent): void {
    // Use type guard to check for specific event type
    if (isEventType(event, 'process_start')) {
      // TypeScript knows event.data.version exists
      this.uvVersion = event.data.version;
      this.startTime = event.timestamp;
      this.phaseManager.transitionTo('started');
    }

    // Use category type guard for related events
    if (
      isDownloadEvent(event) && // TypeScript knows this is either download_prepare or download_info
      event.type === 'download_prepare'
    ) {
      // Now TypeScript knows the exact type
      this.downloadManager.startDownload(event.data.packageName, event.data.size, event.data.url);
    }

    // Use HTTP/2 type guard
    if (isHttp2Event(event)) {
      // Handle all HTTP/2 related events
      switch (event.type) {
        case 'http2_headers':
          this.streamTracker.registerStream(event.data.streamId, event.timestamp);
          break;
        case 'http2_data':
          this.streamTracker.recordDataFrame(event.data.streamId, event.timestamp, event.data.isEndStream);
          break;
        case 'http2_settings':
          this.streamTracker.updateMaxFrameSize(event.data.maxFrameSize);
          break;
      }
    }
  }

  getState(): IInstallationState {
    const phase = this.phaseManager.getCurrentPhase();
    const phaseHistory = this.phaseManager.getPhaseHistory();
    const packageStats = this.packageRegistry.getStatistics();

    // Build current operation info
    let currentOperation: IInstallationState['currentOperation'];

    switch (phase) {
      case 'resolving': {
        currentOperation = { type: 'resolving' };

        break;
      }
      case 'downloading':
      case 'preparing_download': {
        const activeDownloads = this.downloadManager.getActiveDownloads();
        if (activeDownloads.length > 0) {
          const download = activeDownloads[0];
          const stream = [...this.streamTracker.getActiveStreams().values()].find(
            (s) => s.packageName === download.packageName
          );

          const progress = this.progressCalculator.calculateProgress(
            download,
            stream,
            this.streamTracker.getMaxFrameSize()
          );

          currentOperation = {
            type: 'downloading',
            packageName: download.packageName,
            progress,
          };
        }

        break;
      }
      case 'installing': {
        currentOperation = { type: 'installing' };

        break;
      }
      // No default
    }

    // Calculate phase durations
    const phaseDurations: Partial<Record<InstallationPhase, number>> = {};
    for (const p of phaseHistory) {
      const timestamp = this.phaseManager.getPhaseTimestamp(p);
      if (timestamp) {
        const nextPhaseIndex = phaseHistory.indexOf(p) + 1;
        const nextPhase = phaseHistory[nextPhaseIndex];
        const nextTimestamp = nextPhase ? this.phaseManager.getPhaseTimestamp(nextPhase) : this.endTime;

        if (nextTimestamp) {
          phaseDurations[p] = nextTimestamp - timestamp;
        }
      }
    }

    return {
      phase,
      phaseHistory,
      message: this.generateStatusMessage(),
      uvVersion: this.uvVersion,
      pythonVersion: this.pythonVersion,
      requirementsFile: this.requirementsFile,
      packages: {
        total: packageStats.total,
        resolved: packageStats.total,
        downloaded: packageStats.downloaded,
        installed: packageStats.installed,
      },
      currentOperation,
      overallProgress: this.calculateOverallProgress(),
      isComplete: this.isComplete(),
      error: this.error,
      timing: {
        startTime: this.startTime,
        endTime: this.endTime,
        phaseDurations,
      },
    };
  }

  calculateOverallProgress(): number {
    const phase = this.phaseManager.getCurrentPhase();
    const stats = this.packageRegistry.getStatistics();

    // Phase weights
    const phaseWeights: Record<InstallationPhase, number> = {
      idle: 0,
      started: 5,
      reading_requirements: 10,
      resolving: 20,
      resolved: 25,
      preparing_download: 30,
      downloading: 70,
      prepared: 80,
      installing: 90,
      installed: 100,
      error: 0,
    };

    let baseProgress = phaseWeights[phase] || 0;

    // Add sub-progress for downloading phase
    if (phase === 'downloading' && stats.total > 0) {
      const downloadProgress = (stats.downloaded / stats.total) * 40; // 40% of total
      baseProgress = 30 + downloadProgress; // 30% base + up to 40% for downloads
    }

    // Add sub-progress for installing phase
    if (phase === 'installing' && stats.total > 0) {
      const installProgress = (stats.installed / stats.total) * 10; // 10% of total
      baseProgress = 80 + installProgress; // 80% base + up to 10% for installs
    }

    return Math.min(100, Math.max(0, baseProgress));
  }

  generateStatusMessage(): string {
    const phase = this.phaseManager.getCurrentPhase();
    const stats = this.packageRegistry.getStatistics();

    switch (phase) {
      case 'idle':
        return 'Waiting to start';
      case 'started':
        return `UV ${this.uvVersion || 'unknown'} started`;
      case 'reading_requirements':
        return `Reading ${this.requirementsFile || 'requirements'}`;
      case 'resolving':
        return 'Resolving dependencies...';
      case 'resolved':
        return `Resolved ${stats.total} packages`;
      case 'preparing_download':
        return 'Preparing downloads...';
      case 'downloading':
        return `Downloading packages (${stats.downloaded}/${stats.total})`;
      case 'prepared':
        return `Prepared ${stats.downloaded} packages`;
      case 'installing':
        return `Installing packages (${stats.installed}/${stats.total})`;
      case 'installed':
        return `Successfully installed ${stats.installed} packages`;
      case 'error':
        return `Error: ${this.error?.message || 'Unknown error'}`;
      default:
        return 'Processing...';
    }
  }

  isComplete(): boolean {
    const phase = this.phaseManager.getCurrentPhase();
    return phase === 'installed' || phase === 'error';
  }

  reset(): void {
    this.phaseManager.reset();
    this.packageRegistry.reset();
    this.downloadManager.reset();
    this.streamTracker.reset();

    this.uvVersion = undefined;
    this.pythonVersion = undefined;
    this.requirementsFile = undefined;
    this.startTime = undefined;
    this.endTime = undefined;
    this.error = undefined;
  }
}

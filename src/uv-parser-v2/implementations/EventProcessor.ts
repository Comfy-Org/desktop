/**
 * Minimal EventProcessor Implementation for UV Parser V2
 *
 * This is a production-ready, minimal implementation of the IEventProcessor interface
 * that processes log events and coordinates updates across all components.
 */
import type { IDownloadManager, ILogEvent, IPackageRegistry, IPhaseManager, InstallationPhase } from '../architecture';
import { isErrorEvent, isEventType } from '../architecture';
import type { IEventProcessor } from '../architecture-extended';

/**
 * Processes log events and updates relevant components.
 * This coordinates updates to phase management, package registry, and download tracking.
 */
export class EventProcessor implements IEventProcessor {
  /** Last processed event for debugging and state reconstruction */
  private lastEvent: ILogEvent | undefined;

  /** Registered components for event processing */
  private phaseManager?: IPhaseManager;
  private packageRegistry?: IPackageRegistry;
  private downloadManager?: IDownloadManager;

  /**
   * Processes a parsed log event.
   * Updates relevant components based on event type and returns whether state changed.
   *
   * @param event Event to process
   * @returns true if event caused state changes
   */
  processEvent(event: ILogEvent): boolean {
    this.lastEvent = event;
    let hasStateChanges = false;

    try {
      // Process event based on type
      switch (event.type) {
        case 'process_start':
          hasStateChanges = this.handleProcessStart(event);
          break;

        case 'requirements_file':
          hasStateChanges = this.handleRequirementsFile(event);
          break;

        case 'resolution_complete':
          hasStateChanges = this.handleResolutionComplete(event);
          break;

        case 'download_prepare':
          hasStateChanges = this.handleDownloadPrepare(event);
          break;

        case 'packages_prepared':
          hasStateChanges = this.handlePackagesPrepared(event);
          break;

        case 'installation_complete':
          hasStateChanges = this.handleInstallationComplete(event);
          break;

        case 'error':
          hasStateChanges = this.handleError(event);
          break;

        case 'python_version':
        case 'dependency_added':
        case 'download_info':
        case 'http2_headers':
        case 'http2_data':
        case 'http2_settings':
        case 'packages_uninstalled':
        case 'installation_start':
        case 'warning':
        case 'unknown':
          // These events don't trigger major state changes in minimal implementation
          hasStateChanges = false;
          break;

        default:
          // Type safety: this should never happen with proper discriminated union
          hasStateChanges = false;
      }
    } catch (error) {
      // Log processing error but don't throw - this keeps the parser resilient
      console.error('EventProcessor: Error processing event', { event, error });
      hasStateChanges = false;
    }

    return hasStateChanges;
  }

  /**
   * Registers a component to be updated during event processing.
   *
   * @param componentType Type of component
   * @param component Component instance
   */
  registerComponent(componentType: string, component: unknown): void {
    switch (componentType) {
      case 'phaseManager':
        this.phaseManager = component as IPhaseManager;
        break;
      case 'packageRegistry':
        this.packageRegistry = component as IPackageRegistry;
        break;
      case 'downloadManager':
        this.downloadManager = component as IDownloadManager;
        break;
      default:
        // Ignore unknown component types in minimal implementation
        break;
    }
  }

  /**
   * Gets the last processed event.
   *
   * @returns Last event or undefined
   */
  getLastEvent(): ILogEvent | undefined {
    return this.lastEvent;
  }

  /**
   * Resets the processor to initial state.
   */
  reset(): void {
    this.lastEvent = undefined;
    // Components maintain their own state - they should be reset separately
  }

  // ============================================================================
  // Private Event Handlers
  // ============================================================================

  /**
   * Handles process_start events - UV process initialization
   */
  private handleProcessStart(event: ILogEvent): boolean {
    if (!isEventType(event, 'process_start')) return false;

    return this.transitionPhase('started');
  }

  /**
   * Handles requirements_file events - Requirements file detection
   */
  private handleRequirementsFile(event: ILogEvent): boolean {
    if (!isEventType(event, 'requirements_file')) return false;

    return this.transitionPhase('reading_requirements');
  }

  /**
   * Handles resolution_complete events - Dependency resolution completion
   */
  private handleResolutionComplete(event: ILogEvent): boolean {
    if (!isEventType(event, 'resolution_complete')) return false;

    const data = event.data;
    let hasChanges = false;

    // Transition to resolved phase
    if (this.transitionPhase('resolved')) {
      hasChanges = true;
    }

    // Update package count in registry if available
    if (this.packageRegistry && data.packageCount > 0) {
      // In minimal implementation, we create placeholder packages for counting
      for (let i = 0; i < data.packageCount; i++) {
        this.packageRegistry.registerPackage({
          name: `package-${i}`,
          version: '0.0.0',
          sizeBytes: 0,
          discoveredAt: event.timestamp,
          status: 'pending',
        });
      }
      hasChanges = true;
    }

    return hasChanges;
  }

  /**
   * Handles download_prepare events - Package download preparation
   */
  private handleDownloadPrepare(event: ILogEvent): boolean {
    if (!isEventType(event, 'download_prepare')) return false;

    const data = event.data;
    let hasChanges = false;

    // Transition to downloading phase (may be preparing_download first)
    const currentPhase = this.phaseManager?.getCurrentPhase();
    if (currentPhase === 'resolved') {
      // First download prepare - transition to preparing_download
      hasChanges = this.transitionPhase('preparing_download') || hasChanges;
    } else if (currentPhase === 'preparing_download') {
      // Multiple packages being prepared - transition to downloading
      hasChanges = this.transitionPhase('downloading') || hasChanges;
    }

    // Register package in registry
    if (this.packageRegistry) {
      this.packageRegistry.registerPackage({
        name: data.packageName,
        version: data.version,
        sizeBytes: data.size,
        url: data.url,
        discoveredAt: event.timestamp,
        status: 'downloading',
      });
      hasChanges = true;
    }

    // Track download in download manager
    if (this.downloadManager && data.size > 0) {
      this.downloadManager.trackDownload(data.packageName, data.size, data.url);
      hasChanges = true;
    }

    return hasChanges;
  }

  /**
   * Handles packages_prepared events - Package preparation completion
   */
  private handlePackagesPrepared(event: ILogEvent): boolean {
    if (!isEventType(event, 'packages_prepared')) return false;

    return this.transitionPhase('prepared');
  }

  /**
   * Handles installation_complete events - Installation completion
   */
  private handleInstallationComplete(event: ILogEvent): boolean {
    if (!isEventType(event, 'installation_complete')) return false;

    const data = event.data;
    let hasChanges = false;

    // Transition to installed phase
    if (this.transitionPhase('installed')) {
      hasChanges = true;
    }

    // Mark packages as installed in registry
    if (this.packageRegistry && data.count > 0) {
      const packages = this.packageRegistry.getAllPackages();
      // Mark the first N packages as installed (simple heuristic for minimal implementation)
      for (let i = 0; i < Math.min(data.count, packages.length); i++) {
        this.packageRegistry.updatePackageStatus(packages[i].name, 'installed');
      }
      hasChanges = true;
    }

    return hasChanges;
  }

  /**
   * Handles error events - Error occurrence
   */
  private handleError(event: ILogEvent): boolean {
    if (!isErrorEvent(event)) return false;

    return this.transitionPhase('error');
  }

  // ============================================================================
  // Private Helper Methods
  // ============================================================================

  /**
   * Attempts to transition to a new phase using the phase manager.
   *
   * @param newPhase Phase to transition to
   * @returns true if transition was successful
   */
  private transitionPhase(newPhase: InstallationPhase): boolean {
    if (!this.phaseManager) {
      return false;
    }

    return this.phaseManager.transitionTo(newPhase);
  }
}

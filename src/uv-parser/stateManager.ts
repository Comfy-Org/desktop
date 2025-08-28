/**
 * UV State Manager
 *
 * Manages state tracking for UV installations using the stateless parser.
 * While the parser is stateless, this manager tracks overall progress.
 */
import type { IUvParser } from './interfaces';
import { createUvParser } from './parser';
import type { PackageInfo, UvError, UvParsedOutput, UvWarning } from './types';

/**
 * UV installation stages derived from output patterns
 */
export type UvStage =
  /** Default state before any output has been processed. */
  | 'initializing'
  /** UV startup and environment discovery phase. */
  | 'startup'
  /** Dependency resolution setup with PubGrub solver. */
  | 'resolution_setup'
  /** Cache checking and metadata retrieval (from cache or network). */
  | 'cache_checking'
  /** Dependency resolution using PubGrub algorithm. */
  | 'dependency_resolution'
  /** Resolution complete summary. */
  | 'resolution_summary'
  /** Planning what needs to be installed/removed. */
  | 'installation_planning'
  /** Downloading packages from network (skipped if all cached). */
  | 'package_downloads'
  /** Package preparation complete (only after downloads). */
  | 'package_preparation'
  /** Installing packages to environment. */
  | 'installation'
  /** Final summary with list of installed packages. */
  | 'final_summary'
  /** Process complete. */
  | 'complete';

/**
 * State manager for tracking UV installation progress
 */
export class UvStateManager {
  private readonly parser: IUvParser;
  private currentStage: UvStage = 'initializing';
  private readonly packages: Map<string, PackageInfo> = new Map();
  private outputs: UvParsedOutput[] = [];
  private statistics = {
    packagesResolved: 0,
    packagesDownloaded: 0,
    packagesInstalled: 0,
    cacheHits: 0,
    cacheMisses: 0,
    linesProcessed: 0,
    linesParsed: 0,
  };

  constructor(parser?: IUvParser) {
    this.parser = parser || createUvParser();
  }

  /**
   * Process a single line and update state
   */
  processLine(line: string): UvParsedOutput | undefined {
    this.statistics.linesProcessed++;

    const output = this.parser.parseLine(line);

    if (output) {
      this.statistics.linesParsed++;
      this.outputs.push(output);
      this.updateStateFromOutput(output);
    }

    return output;
  }

  /**
   * Process multiple lines
   */
  processLines(lines: string[]): UvParsedOutput[] {
    const results: UvParsedOutput[] = [];
    for (const line of lines) {
      const output = this.processLine(line);
      if (output) {
        results.push(output);
      }
    }
    return results;
  }

  /**
   * Process complete output
   */
  processOutput(output: string): UvParsedOutput[] {
    const lines = output.split('\n');
    return this.processLines(lines);
  }

  /**
   * Update internal state based on parsed output
   */
  private updateStateFromOutput(output: UvParsedOutput): void {
    switch (output.type) {
      case 'log_message':
        // Check for stage transitions based on log content
        if (output.message.includes('uv 0.')) {
          this.currentStage = 'startup';
        } else if (output.message.includes('Solving with installed Python version')) {
          this.currentStage = 'resolution_setup';
        } else if (
          output.message.includes('No cache entry for') ||
          output.message.includes('Found fresh response for')
        ) {
          if (this.currentStage === 'resolution_setup') {
            this.currentStage = 'cache_checking';
          }
        } else if (output.message.includes('add_decision: Id::<PubGrubPackage>')) {
          if (this.currentStage === 'cache_checking') {
            this.currentStage = 'dependency_resolution';
          }
        } else if (output.module === 'uv_installer' && output.message.includes('plan')) {
          this.currentStage = 'installation_planning';
        } else if (output.message.includes('preparer::prepare')) {
          this.currentStage = 'package_downloads';
        } else if (output.message.includes('installer::install_blocking')) {
          this.currentStage = 'installation';
        }
        break;

      case 'resolution_summary':
        this.currentStage = 'resolution_summary';
        this.statistics.packagesResolved = output.packageCount;
        break;

      case 'preparation_summary':
        this.currentStage = 'package_preparation';
        this.statistics.packagesDownloaded = output.packageCount;
        break;

      case 'installation_summary':
        this.currentStage = 'installation';
        this.statistics.packagesInstalled = output.packageCount;
        break;

      case 'download_progress':
        if (this.currentStage !== 'package_downloads' && this.currentStage !== 'package_preparation') {
          this.currentStage = 'package_downloads';
        }
        if (output.package.name) {
          this.packages.set(output.package.name, output.package);
        }
        break;

      case 'changed_package':
        this.currentStage = 'final_summary';
        if (output.package.name) {
          this.packages.set(output.package.name, output.package);
        }
        break;

      case 'install_plan':
        if (output.package.name) {
          this.packages.set(output.package.name, output.package);
        }
        break;

      case 'cache_event':
        if (output.status === 'hit') {
          this.statistics.cacheHits++;
        } else if (output.status === 'miss') {
          this.statistics.cacheMisses++;
        }
        break;

      case 'resolution':
        if (output.package.name) {
          this.packages.set(output.package.name, output.package);
        }
        break;
    }

    // Check for completion
    if (
      this.currentStage === 'final_summary' &&
      output.type === 'changed_package' &&
      this.packages.size >= this.statistics.packagesInstalled
    ) {
      // If we've seen all the packages in the final summary
      this.currentStage = 'complete';
    }
  }

  /**
   * Get current stage
   */
  getCurrentStage(): UvStage {
    return this.currentStage;
  }

  /**
   * Get all packages encountered
   */
  getPackages(): PackageInfo[] {
    return [...this.packages.values()];
  }

  /**
   * Get statistics
   */
  getStatistics() {
    return { ...this.statistics };
  }

  /**
   * Get all parsed outputs
   */
  getOutputs(): UvParsedOutput[] {
    return [...this.outputs];
  }

  /**
   * Get outputs of a specific type with proper type narrowing
   */
  getOutputsByType<T extends UvParsedOutput['type']>(type: T): Extract<UvParsedOutput, { type: T }>[] {
    return this.outputs.filter((output): output is Extract<UvParsedOutput, { type: T }> => output.type === type);
  }

  /**
   * Check if installation is complete
   */
  isComplete(): boolean {
    return this.currentStage === 'complete';
  }

  /**
   * Check if there were any errors
   */
  hasErrors(): boolean {
    return this.outputs.some((o) => o.type === 'error');
  }

  /**
   * Get all errors
   */
  getErrors(): UvError[] {
    return this.getOutputsByType('error');
  }

  /**
   * Get all warnings
   */
  getWarnings(): UvWarning[] {
    return this.getOutputsByType('warning');
  }

  /**
   * Get a summary of the installation
   */
  getSummary() {
    const resolutionSummary = this.getOutputsByType('resolution_summary')[0];
    const preparationSummary = this.getOutputsByType('preparation_summary')[0];
    const installationSummary = this.getOutputsByType('installation_summary')[0];
    const changedPackages = this.getOutputsByType('changed_package');

    return {
      stage: this.currentStage,
      complete: this.isComplete(),
      hasErrors: this.hasErrors(),
      statistics: this.getStatistics(),
      packages: this.getPackages(),
      resolution: resolutionSummary,
      preparation: preparationSummary,
      installation: installationSummary,
      installedPackages: changedPackages.filter((p) => p.operation === '+').map((p) => p.package),
      removedPackages: changedPackages.filter((p) => p.operation === '-').map((p) => p.package),
    };
  }

  /**
   * Reset the state manager
   */
  reset(): void {
    this.currentStage = 'initializing';
    this.packages.clear();
    this.outputs = [];
    this.statistics = {
      packagesResolved: 0,
      packagesDownloaded: 0,
      packagesInstalled: 0,
      cacheHits: 0,
      cacheMisses: 0,
      linesProcessed: 0,
      linesParsed: 0,
    };
  }
}

/**
 * UV Parser Interface Definitions
 *
 * Main interfaces for implementing a UV pip install output parser
 */
import type {
  InstallationSummary,
  PackageInfo,
  PreparationSummary,
  ResolutionSummary,
  UVParsedOutput,
  UVStage,
  UVState,
  WarningOrError,
} from './types';

/**
 * Statistics and summary after parsing completion
 */
export interface ParseSummary {
  /** Total lines processed */
  linesProcessed: number;

  /** Lines that produced parsed output */
  linesParsed: number;

  /** Lines that were skipped/unparseable */
  linesSkipped: number;

  /** Number of stage transitions */
  stageTransitions: number;

  /** All stages encountered in order */
  stagesEncountered: UVStage[];

  /** Resolution phase summary if available */
  resolution?: ResolutionSummary;

  /** Installation summary if available */
  installation?: InstallationSummary;

  /** Preparation summary if available */
  preparation?: PreparationSummary;

  /** Packages that were resolved */
  packagesResolved: PackageInfo[];

  /** Packages that were downloaded */
  packagesDownloaded: PackageInfo[];

  /** Packages that were installed */
  packagesInstalled: PackageInfo[];

  /** Total duration if determinable */
  totalDuration?: string;

  /** Errors encountered during the process */
  errors: WarningOrError[];

  /** Warnings encountered during the process */
  warnings: WarningOrError[];

  /** Cache statistics */
  cacheStatistics: {
    hits: number;
    misses: number;
    writes: number;
  };
}

/**
 * Stateless UV output parser interface.
 * Each line is parsed independently without requiring context or state.
 */
export interface IUVParser {
  /**
   * Parse a single line of UV output without any state context.
   * Returns undefined if the line cannot be parsed or is not relevant.
   *
   * @param line - The line to parse
   * @param lineNumber - Optional line number (1-indexed) for debugging
   * @returns Parsed output object or undefined
   */
  parseLine(line: string, lineNumber?: number): UVParsedOutput | undefined;

  /**
   * Parse multiple lines of UV output.
   * Each line is parsed independently.
   *
   * @param lines - Array of lines to parse
   * @returns Array of parsed outputs (undefined entries filtered out)
   */
  parseLines(lines: string[]): UVParsedOutput[];

  /**
   * Parse a complete UV output string.
   * Splits by newlines and parses each line independently.
   *
   * @param output - Complete output string
   * @returns Array of parsed outputs
   */
  parseOutput(output: string): UVParsedOutput[];

  /**
   * Check if a line can be parsed by this parser.
   * Useful for filtering or validation.
   *
   * @param line - The line to check
   * @returns True if the line matches any known pattern
   */
  canParse(line: string): boolean;

  /**
   * Get the type of output a line would produce without fully parsing it.
   * Useful for routing or filtering.
   *
   * @param line - The line to check
   * @returns The output type or undefined if not parseable
   */
  getLineType(line: string): UVParsedOutput['type'] | undefined;
}

/**
 * State manager for UV installation process.
 * Maintains state based on parsed outputs from the stateless parser.
 */
export interface IUVStateManager {
  /**
   * Process a parsed output and update internal state.
   *
   * @param output - Parsed output from the parser
   */
  processOutput(output: UVParsedOutput): void;

  /**
   * Process multiple outputs.
   *
   * @param outputs - Array of parsed outputs
   */
  processOutputs(outputs: UVParsedOutput[]): void;

  /**
   * Get the current installation stage.
   *
   * @returns Current UV installation stage
   */
  getCurrentStage(): UVStage;

  /**
   * Get the current state.
   *
   * @returns Current state including stage, packages, and statistics
   */
  getState(): Readonly<UVState>;

  /**
   * Get summary of the installation process.
   *
   * @returns Summary with statistics and key information
   */
  getSummary(): ParseSummary;

  /**
   * Reset the state manager to initial state.
   */
  reset(): void;

  /**
   * Check if the installation process is complete.
   *
   * @returns True if installation is complete
   */
  isComplete(): boolean;

  /**
   * Check if errors were encountered.
   *
   * @returns True if any errors occurred
   */
  hasErrors(): boolean;

  /**
   * Get all errors encountered.
   *
   * @returns Array of error objects
   */
  getErrors(): WarningOrError[];

  /**
   * Get all warnings encountered.
   *
   * @returns Array of warning objects
   */
  getWarnings(): WarningOrError[];
}

/**
 * Stream processor for real-time UV output processing.
 * Handles buffering and uses stateless parser with state manager.
 */
export interface IUVStreamProcessor {
  /**
   * Process a chunk of output data.
   * Handles partial lines and buffering.
   *
   * @param chunk - Chunk of output data
   */
  write(chunk: string | Buffer): void;

  /**
   * Flush any remaining buffered data.
   * Call this when the stream ends.
   */
  end(): void;

  /**
   * Event handler for parsed output.
   * Called whenever a line produces parsed output.
   */
  onOutput: (output: UVParsedOutput) => void;

  /**
   * Event handler for stage transitions.
   * Called whenever the installation stage changes.
   */
  onStageChange?: (newStage: UVStage, oldStage: UVStage) => void;

  /**
   * Event handler for errors.
   * Called when an error is encountered in the UV output.
   */
  onError?: (error: WarningOrError) => void;

  /**
   * Event handler for completion.
   * Called when the installation process completes.
   */
  onComplete?: (summary: ParseSummary) => void;

  /**
   * Get the underlying parser instance.
   *
   * @returns The stateless parser being used
   */
  getParser(): IUVParser;

  /**
   * Get the state manager instance.
   *
   * @returns The state manager tracking installation progress
   */
  getStateManager(): IUVStateManager;
}

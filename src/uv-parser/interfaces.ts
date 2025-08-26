/**
 * UV Parser Interface Definitions
 *
 * Main interfaces for implementing a UV pip install output parser
 */
import type {
  InstallationSummary,
  PackageInfo,
  ParserState,
  PreparationSummary,
  ResolutionSummary,
  StageTransition,
  UVParsedOutput,
  UVStage,
  WarningOrError,
} from './types';

/**
 * Configuration options for the UV parser
 */
export interface UVParserOptions {
  /**
   * Whether to parse detailed HTTP/2 frame information.
   * Disabled by default as it generates many events.
   */
  parseHttp2Frames?: boolean;

  /**
   * Whether to track all log messages or only significant ones.
   * When false, only INFO level and above are tracked.
   */
  trackAllLogs?: boolean;

  /**
   * Whether to parse and track cache events.
   */
  trackCacheEvents?: boolean;

  /**
   * Custom patterns to match for specific events.
   * Allows extending the parser without modifying core logic.
   */
  customPatterns?: CustomPattern[];

  /**
   * Callback for handling parse errors gracefully.
   * If not provided, errors are silently ignored.
   */
  onParseError?: (error: Error, line: string, lineNumber: number) => void;

  /**
   * Initial stage to start with.
   * Defaults to UVStage.Initializing
   */
  initialStage?: UVStage;
}

/**
 * Custom pattern for extending parser functionality
 */
export interface CustomPattern {
  /** Unique identifier for this pattern */
  id: string;

  /** Regular expression to match against lines */
  pattern: RegExp;

  /** Function to create parsed output from regex match */
  handler: (match: RegExpMatchArray, line: string, lineNumber: number) => UVParsedOutput | undefined;

  /** Optional stage(s) this pattern is relevant for */
  stages?: UVStage[];
}

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
  getState(): Readonly<ParserState>;

  /**
   * Get history of stage transitions.
   *
   * @returns Array of stage transitions in chronological order
   */
  getStageHistory(): ReadonlyArray<StageTransition>;

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
 * Factory for creating UV parser instances
 */
export interface IUVParserFactory {
  /**
   * Create a new UV parser instance with the given options.
   *
   * @param options - Configuration options for the parser
   * @returns New parser instance
   */
  createParser(options?: UVParserOptions): IUVParser;

  /**
   * Get the default parser options.
   *
   * @returns Default configuration options
   */
  getDefaultOptions(): UVParserOptions;
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

/**
 * Pattern matcher for identifying UV output patterns
 */
export interface IPatternMatcher {
  /**
   * Register a pattern for a specific stage transition.
   *
   * @param fromStage - Stage to transition from (or '*' for any)
   * @param toStage - Stage to transition to
   * @param pattern - Regular expression or string to match
   */
  registerStagePattern(fromStage: UVStage | '*', toStage: UVStage, pattern: RegExp | string): void;

  /**
   * Register a pattern for extracting structured data.
   *
   * @param id - Unique identifier for this pattern
   * @param pattern - Regular expression with capture groups
   * @param extractor - Function to extract data from matches
   */
  registerDataPattern<T extends UVParsedOutput>(
    id: string,
    pattern: RegExp,
    extractor: (match: RegExpMatchArray) => T | undefined
  ): void;

  /**
   * Check if a line matches any registered patterns.
   *
   * @param line - Line to check
   * @param currentStage - Current parser stage
   * @returns Matched patterns and extracted data
   */
  matchLine(
    line: string,
    currentStage: UVStage
  ): {
    stageTransition?: UVStage;
    data?: UVParsedOutput[];
  };

  /**
   * Get all registered patterns.
   *
   * @returns Map of pattern IDs to patterns
   */
  getPatterns(): ReadonlyMap<string, RegExp>;
}

/**
 * Validator for ensuring parsed output consistency
 */
export interface IOutputValidator {
  /**
   * Validate a parsed output object.
   *
   * @param output - Output to validate
   * @returns True if valid, false otherwise
   */
  validate(output: UVParsedOutput): boolean;

  /**
   * Validate a stage transition.
   *
   * @param fromStage - Current stage
   * @param toStage - Proposed new stage
   * @returns True if transition is valid
   */
  validateTransition(fromStage: UVStage, toStage: UVStage): boolean;

  /**
   * Get validation errors for an output object.
   *
   * @param output - Output to check
   * @returns Array of validation error messages
   */
  getValidationErrors(output: UVParsedOutput): string[];
}

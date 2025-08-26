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
 * Result of parsing a single line
 */
export interface ParseLineResult {
  /**
   * Parsed output object(s) from the line.
   * Can be undefined if line is not relevant.
   * Can be multiple outputs if line triggers multiple events.
   */
  outputs?: UVParsedOutput | UVParsedOutput[];

  /**
   * Whether this line caused a stage transition
   */
  stageChanged: boolean;

  /**
   * New stage if transition occurred
   */
  newStage?: UVStage;

  /**
   * Any error that occurred during parsing
   */
  error?: Error;
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
 * Main UV output parser interface
 */
export interface IUVParser {
  /**
   * Parse a single line of UV output.
   *
   * @param line - The line to parse
   * @param lineNumber - Optional line number (1-indexed)
   * @returns Parse result with output object(s) and state changes
   */
  parseLine(line: string, lineNumber?: number): ParseLineResult;

  /**
   * Parse multiple lines of UV output.
   *
   * @param lines - Array of lines to parse
   * @returns Array of parse results
   */
  parseLines(lines: string[]): ParseLineResult[];

  /**
   * Parse a complete UV output string.
   *
   * @param output - Complete output string (will be split by newlines)
   * @returns Array of parse results
   */
  parseOutput(output: string): ParseLineResult[];

  /**
   * Get the current parser state.
   *
   * @returns Current state including stage, packages, and statistics
   */
  getState(): Readonly<ParserState>;

  /**
   * Get the current installation stage.
   *
   * @returns Current UV installation stage
   */
  getCurrentStage(): UVStage;

  /**
   * Get history of stage transitions.
   *
   * @returns Array of stage transitions in chronological order
   */
  getStageHistory(): ReadonlyArray<StageTransition>;

  /**
   * Get all parsed outputs collected so far.
   *
   * @param type - Optional filter by output type
   * @returns Array of parsed outputs
   */
  getOutputs<T extends UVParsedOutput = UVParsedOutput>(type?: T['type']): T[];

  /**
   * Get summary of the entire parsing session.
   *
   * @returns Summary with statistics and key information
   */
  getSummary(): ParseSummary;

  /**
   * Reset the parser to initial state.
   * Clears all collected data and resets to initial stage.
   */
  reset(): void;

  /**
   * Check if the installation process is complete.
   *
   * @returns True if stage is Complete or FinalSummary with packages listed
   */
  isComplete(): boolean;

  /**
   * Check if the installation process encountered errors.
   *
   * @returns True if any errors were encountered
   */
  hasErrors(): boolean;

  /**
   * Get all errors encountered during parsing.
   *
   * @returns Array of error objects
   */
  getErrors(): WarningOrError[];

  /**
   * Get all warnings encountered during parsing.
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
 * Stream parser for processing UV output in real-time
 */
export interface IUVStreamParser {
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
   * @returns The parser being used by the stream
   */
  getParser(): IUVParser;
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

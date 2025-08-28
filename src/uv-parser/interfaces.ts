/**
 * UV Parser Interface Definitions
 *
 * Stateless interfaces for implementing a UV pip install output parser.
 * The parser processes each line independently without maintaining state.
 */
import type { UvParsedOutput } from './types';

/**
 * Stateless UV output parser interface.
 * Each line is parsed independently without requiring context or state.
 */
export interface IUvParser {
  /**
   * Parse a single line of UV output without any state context.
   * Returns undefined if the line cannot be parsed or is not relevant.
   *
   * @param line - The line to parse
   * @returns Parsed output object or undefined
   */
  parseLine(line: string): UvParsedOutput | undefined;

  /**
   * Parse multiple lines of UV output.
   * Each line is parsed independently.
   *
   * @param lines - Array of lines to parse
   * @returns Array of parsed outputs (undefined entries filtered out)
   */
  parseLines(lines: string[]): UvParsedOutput[];

  /**
   * Parse a complete UV output string.
   * Splits by newlines and parses each line independently.
   *
   * @param output - Complete output string
   * @returns Array of parsed outputs
   */
  parseOutput(output: string): UvParsedOutput[];

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
  getLineType(line: string): UvParsedOutput['type'] | undefined;
}

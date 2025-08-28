/**
 * Parse UV output file line by line and output JSON
 *
 * Usage:
 *   npx tsx src/uv-parser/parse-file.ts <file-path>
 *   or
 *   node --loader tsx src/uv-parser/parse-file.ts <file-path>
 */
import { readFileSync } from 'node:fs';

import { createUvParser } from './parser';

// Main function to allow proper error handling
function main(): void {
  // Get file path from command line arguments
  const filePath = process.argv[2];

  if (!filePath) {
    console.error('Usage: npx tsx parse-file.ts <file-path>');
    throw new Error('No file path provided');
  }

  // Read file content
  const content = readFileSync(filePath, 'utf8');
  const lines = content.split('\n');

  // Create parser instance
  const parser = createUvParser();

  // Parse each line and output JSON
  for (const line of lines) {
    const parsed = parser.parseLine(line);
    if (parsed) {
      console.log(JSON.stringify(parsed));
    }
  }
}

// Run main function and handle errors
try {
  main();
} catch (error) {
  console.error(`Error: ${error instanceof Error ? error.message : String(error)}`);
  // eslint-disable-next-line unicorn/no-process-exit
  process.exit(1);
}

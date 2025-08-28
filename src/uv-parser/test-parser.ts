#!/usr/bin/env node
/**
 * Test script for UV parser
 *
 * Tests the stateless parser with real UV output samples
 */
import { readFileSync } from 'node:fs';

import { createUVParser } from './parser';
import { UVStateManager } from './state-manager';
import type { UVParsedOutput } from './types';

// ANSI color codes for terminal output
const colors = {
  reset: '\u001B[0m',
  bright: '\u001B[1m',
  green: '\u001B[32m',
  red: '\u001B[31m',
  yellow: '\u001B[33m',
  blue: '\u001B[34m',
  cyan: '\u001B[36m',
};

/**
 * Test a specific UV output file
 */
function testFile(filePath: string, description: string) {
  console.log(`\n${colors.bright}${colors.blue}Testing: ${description}${colors.reset}`);
  console.log(`File: ${filePath}`);
  console.log('─'.repeat(60));

  try {
    const content = readFileSync(filePath, 'utf8');
    const lines = content.split('\n');

    // Test stateless parser
    const parser = createUVParser();
    const parsedOutputs: UVParsedOutput[] = [];
    let unparsedLines = 0;

    for (const line of lines) {
      if (!line.trim()) continue; // Skip empty lines

      const output = parser.parseLine(line);
      if (output) {
        parsedOutputs.push(output);
      } else {
        unparsedLines++;
      }
    }

    // Count output types
    const typeCounts = new Map<string, number>();
    for (const output of parsedOutputs) {
      typeCounts.set(output.type, (typeCounts.get(output.type) || 0) + 1);
    }

    // Test state manager
    const stateManager = new UVStateManager();
    stateManager.processOutput(content);
    const summary = stateManager.getSummary();

    // Display results
    console.log(`${colors.green}✓${colors.reset} Lines processed: ${lines.length}`);
    console.log(`${colors.green}✓${colors.reset} Lines parsed: ${parsedOutputs.length}`);
    console.log(`${colors.yellow}⚠${colors.reset} Unparsed lines: ${unparsedLines}`);
    console.log();

    console.log(`${colors.cyan}Output Types:${colors.reset}`);
    const sortedTypes = [...typeCounts.entries()].sort((a, b) => b[1] - a[1]);
    for (const [type, count] of sortedTypes) {
      console.log(`  ${type}: ${count}`);
    }
    console.log();

    console.log(`${colors.cyan}State Manager Results:${colors.reset}`);
    console.log(`  Final Stage: ${summary.stage}`);
    console.log(`  Complete: ${summary.complete ? '✓' : '✗'}`);
    console.log(`  Has Errors: ${summary.hasErrors ? '⚠' : '✓'}`);
    console.log(`  Packages Resolved: ${summary.statistics.packagesResolved}`);
    console.log(`  Packages Downloaded: ${summary.statistics.packagesDownloaded}`);
    console.log(`  Packages Installed: ${summary.statistics.packagesInstalled}`);
    console.log(`  Cache Hits: ${summary.statistics.cacheHits}`);
    console.log(`  Cache Misses: ${summary.statistics.cacheMisses}`);

    if (summary.installedPackages.length > 0) {
      console.log(`\n${colors.cyan}Installed Packages:${colors.reset}`);
      for (const pkg of summary.installedPackages) {
        console.log(`  + ${pkg.specification || pkg.name}`);
      }
    }

    if (summary.removedPackages.length > 0) {
      console.log(`\n${colors.cyan}Removed Packages:${colors.reset}`);
      for (const pkg of summary.removedPackages) {
        console.log(`  - ${pkg.specification || pkg.name}`);
      }
    }

    // Show sample parsed outputs
    console.log(`\n${colors.cyan}Sample Parsed Outputs:${colors.reset}`);
    const samples = [
      parsedOutputs.find((o) => o.type === 'resolution_summary'),
      parsedOutputs.find((o) => o.type === 'preparation_summary'),
      parsedOutputs.find((o) => o.type === 'installation_summary'),
      parsedOutputs.find((o) => o.type === 'changed_package'),
    ].filter(Boolean);

    for (const sample of samples) {
      if (sample) {
        const lines = JSON.stringify(sample, null, 2).split('\n');
        const preview = lines.slice(1, 4).join('\n  ');
        console.log(`  ${sample.type}: ${preview}`);
      }
    }

    return { success: true, parsedOutputs, summary };
  } catch (error) {
    console.error(`${colors.red}✗ Error: ${error}${colors.reset}`);
    return { success: false, error };
  }
}

/**
 * Run comprehensive tests
 */
function runTests() {
  console.log(`${colors.bright}${colors.cyan}═════════════════════════════════════════════════════════════`);
  console.log(`UV Parser Test Suite`);
  console.log(`═════════════════════════════════════════════════════════════${colors.reset}`);

  const testCases = [
    {
      file: '/tmp/uv_debug_output.log',
      description: 'Full installation with downloads',
    },
    {
      file: '/tmp/uv_debug_output_cached.log',
      description: 'Installation with cached packages',
    },
    {
      file: '/tmp/uv_debug_output_installed.log',
      description: 'Already installed packages',
    },
    {
      file: '/tmp/uv_debug_output_cached-2.log',
      description: 'Large installation with complex dependencies',
    },
  ];

  const results: Array<{ description: string; success: boolean }> = [];

  for (const testCase of testCases) {
    const result = testFile(testCase.file, testCase.description);
    results.push({ description: testCase.description, success: result.success });
  }

  // Summary
  console.log(`\n${colors.bright}${colors.cyan}═════════════════════════════════════════════════════════════`);
  console.log(`Test Summary`);
  console.log(`═════════════════════════════════════════════════════════════${colors.reset}`);

  const passed = results.filter((r) => r.success).length;
  const failed = results.filter((r) => !r.success).length;

  console.log(`${colors.green}✓ Passed: ${passed}${colors.reset}`);
  if (failed > 0) {
    console.log(`${colors.red}✗ Failed: ${failed}${colors.reset}`);
  }

  for (const result of results) {
    const icon = result.success ? `${colors.green}✓` : `${colors.red}✗`;
    console.log(`${icon} ${result.description}${colors.reset}`);
  }

  process.exit(failed > 0 ? 1 : 0);
}

// Run tests if executed directly
// Note: This is a simplified check - in production use import.meta.url properly
if (process.argv[1]?.endsWith('test-parser.ts') || process.argv[1]?.endsWith('test-parser.js')) {
  runTests();
}

export { testFile, runTests };

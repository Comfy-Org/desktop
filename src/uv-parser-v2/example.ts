/**
 * UV Parser V2 - Minimal Working Example
 *
 * This example demonstrates the minimal implementation of UV Parser V2.
 * It shows how to:
 * 1. Import and create a parser using ParserFactory
 * 2. Register event listeners for status changes, errors, and completion
 * 3. Process sample UV log lines through different installation phases
 * 4. Handle both success and error scenarios
 *
 * Run this example to see the parser in action with realistic UV output.
 */
import type { IInstallationState } from './architecture';
import { ParserFactory } from './implementations/ParserFactory';

/**
 * Sample UV log lines that demonstrate a typical installation process.
 * These are real patterns from UV output, showing the progression through
 * different phases of package installation.
 */
const SAMPLE_UV_LOGS = {
  // Process initialization
  processStart: [
    '    0.000690s DEBUG uv uv 0.8.13',
    'Using Python 3.12.9 environment at: /opt/python/3.12.9/bin/python',
  ],

  // Requirements reading phase
  readingRequirements: ['Reading requirements from requirements.txt', 'Found 5 requirements in requirements.txt'],

  // Resolution phase
  resolution: [
    'Resolving dependencies...',
    '+ torch==2.5.1',
    '+ numpy>=1.24.0',
    '+ pillow>=8.0.0',
    '+ requests>=2.28.0',
    '+ transformers>=4.30.0',
    'Resolved 60 packages in 2.34s',
  ],

  // Download preparation phase
  downloadPreparation: [
    'Preparing to download 60 packages',
    'preparer::get_wheel name=torch==2.5.1, size=Some(66492975), url="https://files.pythonhosted.org/packages/94/a4/d6b1a82ce6b57d9c784ae25b9b6ab9d81c97e1b8e2b2e5b6f4b8f9b0e0e0e/torch-2.5.1-cp312-cp312-linux_x86_64.whl"',
    'preparer::get_wheel name=numpy==1.26.4, size=Some(15808814), url="https://files.pythonhosted.org/packages/15/34/b2a1dbf8a5b4a2a5e7f1f4b0b5b1b2b3b4b5b6b7b8b9b0b1b2b3b4b5b6b7/numpy-1.26.4-cp312-cp312-linux_x86_64.whl"',
    'Downloading torch v2.5.1 (63.4MiB)',
    'Downloading numpy v1.26.4 (15.1MiB)',
  ],

  // HTTP/2 download streams (simulating parallel downloads)
  http2Streams: [
    'tracing::http2::recv_frame{stream_id="00000001"}: recv HEADERS flags=END_HEADERS',
    'tracing::http2::recv_frame{stream_id="00000002"}: recv HEADERS flags=END_HEADERS',
    'tracing::http2::recv_frame{stream_id="00000001"}: recv DATA flags="" len=16384',
    'tracing::http2::recv_frame{stream_id="00000002"}: recv DATA flags="" len=16384',
    'tracing::http2::recv_frame{stream_id="00000001"}: recv DATA flags="" len=16384',
    'tracing::http2::recv_frame{stream_id="00000001"}: recv DATA flags=END_STREAM len=8192',
    'tracing::http2::recv_frame{stream_id="00000002"}: recv DATA flags=END_STREAM len=4096',
  ],

  // Package preparation completion
  packagesPreparation: ['Prepared 60 packages in 8.45s'],

  // Installation phase
  installation: ['Installing 60 wheels', 'Installed 60 packages in 4.23s'],

  // Success completion
  success: ['Installation completed successfully', 'Total time: 15.02s'],

  // Error scenario (alternative ending)
  error: [
    'ERROR: Failed to install package torch==2.5.1',
    'ERROR: HTTP 404: Not Found for URL https://files.pythonhosted.org/packages/invalid-url',
    'Installation failed',
  ],
};

/**
 * Demonstrates the basic usage of UV Parser V2 with success scenario
 */
export function demonstrateBasicUsage() {
  console.log('\n🚀 UV Parser V2 - Basic Usage Example\n');

  // Step 1: Create parser instance using the factory
  const factory = new ParserFactory();
  const parser = factory.createParser({
    progressThrottleMs: 50, // Emit progress updates every 50ms
    progressThresholdPercent: 1, // Emit when progress changes by 1%
    emitDebugEvents: true, // Include debug information
  });

  // Step 2: Register event listeners
  const unsubscribeStatus = parser.onStatusChange((state: IInstallationState) => {
    console.log(`📊 Status: ${state.phase} | Progress: ${state.overallProgress.toFixed(1)}%`);
    console.log(`   Message: ${state.message}`);
    console.log(`   Packages: ${state.packages.installed}/${state.packages.total} installed\n`);
  });

  const unsubscribeError = parser.onError((error: Error) => {
    console.log(`❌ Error: ${error.message}\n`);
  });

  const unsubscribeComplete = parser.onComplete((success: boolean) => {
    console.log(`🏁 Installation ${success ? 'completed successfully' : 'failed'}!\n`);
  });

  // Step 3: Process sample UV log lines through different phases
  console.log('Processing UV log lines...\n');

  // Process start
  for (const line of SAMPLE_UV_LOGS.processStart) {
    console.log(`Input: ${line}`);
    parser.processLine(line);
  }

  // Reading requirements
  for (const line of SAMPLE_UV_LOGS.readingRequirements) {
    console.log(`Input: ${line}`);
    parser.processLine(line);
  }

  // Resolution phase
  for (const line of SAMPLE_UV_LOGS.resolution) {
    console.log(`Input: ${line}`);
    parser.processLine(line);
  }

  // Download preparation
  for (const line of SAMPLE_UV_LOGS.downloadPreparation) {
    console.log(`Input: ${line}`);
    parser.processLine(line);
  }

  // HTTP/2 streams (simulating download progress)
  for (const line of SAMPLE_UV_LOGS.http2Streams) {
    console.log(`Input: ${line}`);
    parser.processLine(line);
  }

  // Package preparation completion
  for (const line of SAMPLE_UV_LOGS.packagesPreparation) {
    console.log(`Input: ${line}`);
    parser.processLine(line);
  }

  // Installation
  for (const line of SAMPLE_UV_LOGS.installation) {
    console.log(`Input: ${line}`);
    parser.processLine(line);
  }

  // Success completion
  for (const line of SAMPLE_UV_LOGS.success) {
    console.log(`Input: ${line}`);
    parser.processLine(line);
  }

  // Step 4: Get final state
  const finalState = parser.getState();
  console.log('📋 Final State Summary:');
  console.log(`   Phase: ${finalState.phase}`);
  console.log(`   UV Version: ${finalState.uvVersion || 'unknown'}`);
  console.log(`   Python Version: ${finalState.pythonVersion || 'unknown'}`);
  console.log(`   Total Packages: ${finalState.packages.total}`);
  console.log(`   Installed: ${finalState.packages.installed}`);
  console.log(`   Overall Progress: ${finalState.overallProgress}%`);
  console.log(`   Is Complete: ${finalState.isComplete}`);

  // Step 5: Cleanup - unsubscribe from events
  unsubscribeStatus();
  unsubscribeError();
  unsubscribeComplete();

  return finalState;
}

/**
 * Demonstrates error handling scenario
 */
export function demonstrateErrorHandling() {
  console.log('\n💥 UV Parser V2 - Error Handling Example\n');

  const factory = new ParserFactory();
  const parser = factory.createParser();

  // Register error listener
  const unsubscribeError = parser.onError((error: Error) => {
    console.log(`❌ Caught error: ${error.message}`);
  });

  const unsubscribeStatus = parser.onStatusChange((state: IInstallationState) => {
    console.log(`📊 Status: ${state.phase} | ${state.message}`);
    if (state.error) {
      console.log(`   Error details: ${state.error.message}`);
    }
  });

  // Process initial success lines
  for (const line of SAMPLE_UV_LOGS.processStart) parser.processLine(line);
  for (const line of SAMPLE_UV_LOGS.resolution) parser.processLine(line);

  // Now introduce errors
  console.log('Introducing error conditions...\n');
  for (const line of SAMPLE_UV_LOGS.error) {
    console.log(`Input: ${line}`);
    parser.processLine(line);
  }

  const errorState = parser.getState();
  console.log('\n📋 Error State Summary:');
  console.log(`   Phase: ${errorState.phase}`);
  console.log(`   Has Error: ${!!errorState.error}`);
  console.log(`   Error Message: ${errorState.error?.message || 'none'}`);

  // Cleanup
  unsubscribeError();
  unsubscribeStatus();

  return errorState;
}

/**
 * Demonstrates advanced usage with multiple parsers and state inspection
 */
export function demonstrateAdvancedUsage() {
  console.log('\n🔬 UV Parser V2 - Advanced Usage Example\n');

  const factory = new ParserFactory();

  // Create two parsers with different configurations
  const fastParser = factory.createParser({
    progressThrottleMs: 10,
    progressThresholdPercent: 0.5,
    emitDebugEvents: true,
  });

  const slowParser = factory.createParser({
    progressThrottleMs: 500,
    progressThresholdPercent: 10,
    emitDebugEvents: false,
  });

  let fastUpdateCount = 0;
  let slowUpdateCount = 0;

  // Track update frequency
  fastParser.onStatusChange(() => fastUpdateCount++);
  slowParser.onStatusChange(() => slowUpdateCount++);

  // Process the same log lines through both parsers
  const allLines = [
    ...SAMPLE_UV_LOGS.processStart,
    ...SAMPLE_UV_LOGS.resolution,
    ...SAMPLE_UV_LOGS.downloadPreparation,
    ...SAMPLE_UV_LOGS.http2Streams,
    ...SAMPLE_UV_LOGS.installation,
    ...SAMPLE_UV_LOGS.success,
  ];

  for (const line of allLines) {
    fastParser.processLine(line);
    slowParser.processLine(line);
  }

  console.log(`📈 Update frequency comparison:`);
  console.log(`   Fast parser (10ms throttle): ${fastUpdateCount} updates`);
  console.log(`   Slow parser (500ms throttle): ${slowUpdateCount} updates`);

  // Compare final states
  const fastState = fastParser.getState();
  const slowState = slowParser.getState();

  console.log(`\n📊 State comparison:`);
  console.log(`   Both reached same phase: ${fastState.phase === slowState.phase}`);
  console.log(`   Both have same package count: ${fastState.packages.total === slowState.packages.total}`);
  console.log(`   Both completed: ${fastState.isComplete === slowState.isComplete}`);

  return { fastState, slowState, fastUpdateCount, slowUpdateCount };
}

/**
 * Main demonstration function that runs all examples
 */
export function runAllExamples() {
  console.log('🎯 UV Parser V2 - Complete Example Suite');
  console.log('=====================================');

  try {
    // Run basic usage example
    const basicResult = demonstrateBasicUsage();

    // Run error handling example
    const errorResult = demonstrateErrorHandling();

    // Run advanced usage example
    const advancedResult = demonstrateAdvancedUsage();

    console.log('\n✅ All examples completed successfully!');
    console.log('\nExample Results Summary:');
    console.log(`- Basic usage final phase: ${basicResult.phase}`);
    console.log(`- Error handling final phase: ${errorResult.phase}`);
    console.log(`- Advanced usage fast updates: ${advancedResult.fastUpdateCount}`);
    console.log(`- Advanced usage slow updates: ${advancedResult.slowUpdateCount}`);

    return {
      basicResult,
      errorResult,
      advancedResult,
    };
  } catch (error) {
    console.error('❌ Example failed:', error);
    throw error;
  }
}

/**
 * Simple usage example for quick testing
 */
export function quickExample() {
  console.log('\n⚡ Quick Example - UV Parser V2\n');

  const factory = new ParserFactory();
  const parser = factory.createParser();

  // Simple event logging
  parser.onStatusChange((state) => {
    console.log(`${state.phase}: ${state.message} (${state.overallProgress.toFixed(1)}%)`);
  });

  // Process a few key lines
  const keyLines = [
    '    0.000690s DEBUG uv uv 0.8.13',
    'Resolved 5 packages in 1.23s',
    'Downloading torch v2.5.1 (63.4MiB)',
    'Installed 5 packages in 2.45s',
  ];

  for (const line of keyLines) {
    parser.processLine(line);
  }

  const state = parser.getState();
  console.log(`\nFinal: ${state.phase} with ${state.packages.total} packages`);

  return state;
}

// Export for easy importing


export {ParserFactory} from './implementations/ParserFactory';
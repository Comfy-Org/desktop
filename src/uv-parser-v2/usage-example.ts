/**
 * Usage Example: Strongly-Typed UV Parser
 *
 * This example demonstrates the benefits of using strongly-typed events
 * with the UV Parser V2 architecture.
 */
import type { ILogEvent } from './architecture';
import { createLogEvent, isDownloadEvent, isEventType, isHttp2Event } from './architecture';

/**
 * Example 1: Type-Safe Event Creation
 */
export function demonstrateEventCreation() {
  // Type-safe: TypeScript ensures correct data structure
  const startEvent = createLogEvent(
    'process_start',
    {
      version: '0.8.13',
    },
    'DEBUG uv uv 0.8.13'
  );

  // Type-safe: All required fields must be provided
  const downloadEvent = createLogEvent(
    'download_prepare',
    {
      packageName: 'torch',
      version: '2.5.1',
      size: 66_492_975,
      url: 'https://files.pythonhosted.org/packages/torch-2.5.1.whl',
    },
    'preparer::get_wheel name=torch==2.5.1...'
  );

  return { startEvent, downloadEvent };
}

/**
 * Example 2: Type-Safe Event Handling with Switch Statement
 */
export function handleEventWithSwitch(event: ILogEvent) {
  switch (event.type) {
    case 'process_start':
      console.log(`UV version: ${event.data.version}`);
      break;

    case 'download_prepare': {
      console.log(`Downloading ${event.data.packageName} v${event.data.version}`);
      console.log(`Size: ${event.data.size} bytes from ${event.data.url}`);
      break;
    }

    case 'http2_data':
      if (event.data.isEndStream) {
        console.log(`Stream ${event.data.streamId} completed`);
      }
      break;

    case 'resolution_complete':
      console.log(`Resolved ${event.data.packageCount} packages in ${event.data.duration}s`);
      break;

    case 'error':
      console.error(`Error: ${event.data.message}`);
      if (event.data.code) {
        console.error(`Error code: ${event.data.code}`);
      }
      break;

    case 'requirements_file':
    case 'python_version':
    case 'dependency_added':
    case 'download_info':
    case 'http2_headers':
    case 'http2_settings':
    case 'packages_prepared':
    case 'packages_uninstalled':
    case 'installation_start':
    case 'installation_complete':
    case 'warning':
    case 'unknown':
      // Handle remaining cases
      break;

    default: {
      // TypeScript ensures this is exhaustive
      const unhandled = event as { type: string };
      throw new Error(`Unhandled event type: ${unhandled.type}`);
    }
  }
}

/**
 * Example 3: Type Guards for Conditional Logic
 */
export function demonstrateTypeGuards(event: ILogEvent) {
  // Check for specific event type
  if (isEventType(event, 'download_prepare')) {
    const sizeInMB = event.data.size / (1024 * 1024);
    console.log(`Package: ${event.data.packageName} (${sizeInMB.toFixed(2)} MB)`);
  }

  // Check for category of events
  if (isDownloadEvent(event)) {
    if (event.type === 'download_prepare') {
      console.log(`URL: ${event.data.url}`);
    } else {
      console.log(`Info: ${event.data.packageSpec}`);
    }
  }

  // Multiple type checks
  if (isHttp2Event(event)) {
    switch (event.type) {
      case 'http2_headers':
        console.log(`Headers for stream ${event.data.streamId}`);
        break;
      case 'http2_data':
        if (event.data.isEndStream) {
          console.log(`Stream ${event.data.streamId} finished`);
        }
        break;
      case 'http2_settings':
        console.log(`Max frame size: ${event.data.maxFrameSize}`);
        break;
    }
  }
}

/**
 * Example 4: Building Type-Safe Event Processors
 */
export class DownloadTracker {
  private readonly downloads = new Map<
    string,
    {
      startTime: number;
      size: number;
      url: string;
    }
  >();

  processEvent(event: ILogEvent) {
    if (isEventType(event, 'download_prepare')) {
      this.downloads.set(event.data.packageName, {
        startTime: event.timestamp,
        size: event.data.size,
        url: event.data.url,
      });

      console.log(`Started tracking download: ${event.data.packageName}`);
    }

    if (isEventType(event, 'packages_prepared')) {
      const duration = event.data.duration / 1000;
      console.log(`${event.data.count} packages prepared in ${duration}s`);

      let totalSize = 0;
      for (const download of this.downloads.values()) {
        totalSize += download.size;
      }

      if (duration > 0) {
        const mbps = totalSize / (1024 * 1024) / duration;
        console.log(`Average speed: ${mbps.toFixed(2)} MB/s`);
      }
    }
  }

  getDownloadCount(): number {
    return this.downloads.size;
  }
}

/**
 * Example 5: Type-Safe Parser Usage
 */
export interface IParserCallbacks {
  onStatusChange: (state: { phase: string; overallProgress: number; message: string }) => void;
  onError: (error: Error) => void;
  onComplete: (success: boolean) => void;
}

export function demonstrateParserUsage() {
  // Example callbacks with proper typing
  const callbacks: IParserCallbacks = {
    onStatusChange: (state) => {
      console.log(`Phase: ${state.phase}, Progress: ${state.overallProgress}%`);
    },
    onError: (error) => {
      console.error(`Error: ${error.message}`);
    },
    onComplete: (success) => {
      console.log(success ? '✅ Success!' : '❌ Failed!');
    },
  };

  // Process sample UV output
  const uvOutput = [
    '    0.000690s DEBUG uv uv 0.8.13',
    'Resolved 60 packages in 2.00s',
    'preparer::get_wheel name=torch==2.5.1, size=Some(66492975), url="..."',
    'Installed 60 packages in 10.5s',
  ];

  for (const line of uvOutput) {
    console.log('Processing:', line);
  }

  // Demonstrate usage
  callbacks.onStatusChange({
    phase: 'downloading',
    overallProgress: 50,
    message: 'Downloading packages...',
  });

  callbacks.onComplete(true);
}

/**
 * Example 6: Benefits Summary
 *
 * The strongly-typed event system provides:
 *
 * 1. Compile-time type safety
 *    - No accessing non-existent properties
 *    - Required fields are enforced
 *    - Type mismatches caught before runtime
 *
 * 2. Excellent IDE support
 *    - Full IntelliSense/autocomplete
 *    - Inline documentation
 *    - Easy refactoring
 *
 * 3. Self-documenting code
 *    - Clear event data structures
 *    - Type system as documentation
 *    - Reduced need for comments
 *
 * 4. Fewer runtime errors
 *    - No typos in property names
 *    - No missing required data
 *    - No type confusion
 */

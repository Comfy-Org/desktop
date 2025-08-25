# UV Parser V2 - Component Interaction Documentation

## Overview

The UV Parser V2 architecture follows a clean, modular design where each component has a single responsibility. Components communicate through well-defined interfaces and events, maintaining loose coupling and high cohesion.

## Component Interaction Flow

```
UV Log Line → LineParser → LogEvent → StateAggregator → InstallationState → EventDispatcher → UI
                                            ↓
                                     [PhaseManager]
                                     [PackageRegistry]
                                     [DownloadManager]
                                     [StreamTracker]
                                     [ProgressCalculator]
```

## Detailed Component Interactions

### 1. LineParser → StateAggregator

The `LineParser` is a stateless component that parses raw log lines into structured `ILogEvent` objects. These events are then processed by the `StateAggregator`.

```typescript
// Example interaction:
const event = lineParser.parseLine(logLine);
if (event) {
  stateAggregator.processEvent(event);
}
```

**Event Types and Their Handlers:**

- `process_start` → Updates UV version, marks installation as started
- `requirements_file` → Records requirements file path
- `python_version` → Records Python version
- `dependency_added` → Registers package in PackageRegistry
- `resolution_complete` → Updates package counts, transitions phase
- `download_prepare` → Registers download in DownloadManager
- `http2_headers` → Creates stream in StreamTracker
- `http2_data` → Updates stream frame count, calculates progress
- `packages_prepared` → Updates package statuses
- `installation_complete` → Marks installation as complete
- `error` → Records error state, marks affected downloads as failed

### 2. StateAggregator → Component Managers

The `StateAggregator` orchestrates all component managers based on incoming events:

```typescript
class StateAggregator {
  processEvent(event: ILogEvent) {
    switch (event.type) {
      case 'download_prepare':
        // 1. Register package if new
        this.packageRegistry.registerPackage({
          name: event.data.packageName,
          version: event.data.version,
          sizeBytes: event.data.size,
          url: event.data.url
        });
        
        // 2. Start tracking download
        this.downloadManager.startDownload(
          event.data.packageName,
          event.data.size,
          event.data.url
        );
        
        // 3. Transition phase if needed
        this.phaseManager.transitionTo('preparing_download');
        break;
        
      case 'http2_data':
        // 1. Update stream tracker
        this.streamTracker.recordDataFrame(
          event.data.streamId,
          event.timestamp,
          event.data.isEndStream
        );
        
        // 2. Find associated package
        const packageName = this.streamTracker.getPackageForStream(event.data.streamId);
        
        // 3. Calculate and update progress
        if (packageName) {
          const download = this.downloadManager.getDownload(packageName);
          const stream = this.streamTracker.getStream(event.data.streamId);
          const progress = this.progressCalculator.calculateProgress(
            download,
            stream,
            this.streamTracker.getMaxFrameSize()
          );
          
          this.downloadManager.updateEstimatedProgress(
            packageName,
            progress.estimatedBytes
          );
        }
        break;
    }
  }
}
```

### 3. Stream-to-Package Association

One of the most complex interactions is associating HTTP/2 streams with package downloads:

```typescript
// When a new stream starts (http2_headers event):
1. StreamTracker.registerStream(streamId)
2. DownloadManager.getActiveDownloads() - Get downloads needing streams
3. StreamTracker.associateWithPackage(streamId, packageName)
4. DownloadManager.associateStream(packageName, streamId)

// Association strategy:
- Prefer downloads without any streams yet
- Match by timing (streams usually start shortly after download_prepare)
- Consider package size (larger packages typically start first)
- Validate associations using frame count vs expected size
```

### 4. Progress Calculation

The `ProgressCalculator` combines data from multiple sources:

```typescript
interface ProgressCalculationInputs {
  download: IDownload;        // From DownloadManager
  stream?: IHttpStream;       // From StreamTracker
  maxFrameSize?: number;      // From StreamTracker (HTTP/2 settings)
}

// Calculation process:
1. If stream exists: estimatedBytes = frameCount * maxFrameSize
2. Calculate transfer rate from recent samples
3. Estimate time remaining: (totalBytes - estimatedBytes) / transferRate
4. Calculate percentage: (estimatedBytes / totalBytes) * 100
```

### 5. State Aggregation → Event Dispatcher

The `StateAggregator` builds a complete state snapshot and passes it to the `EventDispatcher`:

```typescript
// After processing an event:
const newState = this.buildState();

// Check if state changed meaningfully
if (this.hasSignificantChange(previousState, newState)) {
  this.eventDispatcher.processStateChange(newState);
}

// Significant changes include:
- Phase transitions
- Package completion
- Error occurrence
- Progress > threshold (e.g., 5%)
- Time since last update > cooldown
```

### 6. Event Dispatcher → UI

The `EventDispatcher` implements intelligent throttling to prevent UI spam:

```typescript
class EventDispatcher {
  private lastEmitTime = 0;
  private lastProgress = 0;
  
  processStateChange(newState: IInstallationState) {
    const now = Date.now();
    const timeSinceLastEmit = now - this.lastEmitTime;
    const progressDelta = Math.abs(newState.overallProgress - this.lastProgress);
    
    // Emit if:
    // 1. Phase changed
    // 2. Error occurred
    // 3. Installation complete
    // 4. Progress changed significantly AND cooldown elapsed
    if (shouldEmit) {
      this.emit('statusChange', newState);
      this.lastEmitTime = now;
      this.lastProgress = newState.overallProgress;
    }
  }
}
```

## Memory Management Interactions

Components coordinate to prevent memory leaks:

```typescript
// Periodic cleanup triggered by main parser:
cleanup() {
  // 1. Remove old completed downloads
  this.downloadManager.cleanupOldDownloads(300000); // 5 minutes
  
  // 2. Remove completed streams
  this.streamTracker.cleanupCompletedStreams();
  
  // 3. Limit total tracked items
  if (this.downloadManager.getActiveDownloads().length > 100) {
    // Keep only most recent
  }
}
```

## Error Handling Flow

Errors cascade through the system:

```typescript
// When an error event is received:
1. PhaseManager.transitionTo('error')
2. DownloadManager.failDownload(packageName, error)
3. PackageRegistry.updatePackageStatus(packageName, 'failed')
4. StateAggregator records error in state
5. EventDispatcher.emit('error', errorDetails)
6. EventDispatcher.emit('complete', false)
```

## Phase Transition Rules

The `PhaseManager` enforces valid phase transitions:

```typescript
const PHASE_TRANSITIONS = {
  idle: ['started'],
  started: ['reading_requirements'],
  reading_requirements: ['resolving'],
  resolving: ['resolved', 'error'],
  resolved: ['preparing_download', 'error'],
  preparing_download: ['downloading', 'prepared', 'error'],
  downloading: ['preparing_download', 'prepared', 'error'],
  prepared: ['installing', 'error'],
  installing: ['installed', 'error'],
  installed: [],
  error: []
};

// Special rules:
- 'downloading' ↔ 'preparing_download' can cycle (multiple packages)
- 'error' can be entered from any phase
- Cannot regress past 'prepared' phase
```

## Testing Interactions

Each component can be tested in isolation:

```typescript
// Unit test example:
const mockRegistry = createMockPackageRegistry();
const mockDownloadManager = createMockDownloadManager();
const aggregator = new StateAggregator({
  packageRegistry: mockRegistry,
  downloadManager: mockDownloadManager,
  // ... other mocks
});

// Test specific interaction:
aggregator.processEvent(downloadPrepareEvent);
expect(mockRegistry.registerPackage).toHaveBeenCalledWith(/* ... */);
expect(mockDownloadManager.startDownload).toHaveBeenCalledWith(/* ... */);
```

## Performance Considerations

1. **Event Batching**: Multiple log lines can be processed before emitting state changes
2. **Lazy Calculation**: Progress is only calculated when requested
3. **Throttling**: Event dispatcher limits update frequency
4. **Memory Bounds**: Old data is automatically cleaned up
5. **Stateless Parsing**: LineParser has no state, enabling parallel processing

## Integration Example

```typescript
// Creating and using the complete system:
const factory = new UvParserFactory();
const parser = factory.createParser({
  eventConfig: {
    progressThrottleMs: 100,
    progressThresholdPercent: 5
  },
  maxDownloads: 100,
  downloadMaxAge: 300000
});

// Subscribe to events
parser.onStatusChange((state) => {
  console.log(`Phase: ${state.phase}, Progress: ${state.overallProgress}%`);
});

parser.onError((error) => {
  console.error('Installation failed:', error);
});

parser.onComplete((success) => {
  console.log(`Installation ${success ? 'succeeded' : 'failed'}`);
});

// Process UV output
uvProcess.stdout.on('data', (chunk) => {
  const lines = chunk.toString().split('\n');
  lines.forEach(line => parser.processLine(line));
});
```
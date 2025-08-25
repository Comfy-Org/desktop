# UV Parser V2 - Architecture Design

## Overview

This is a complete architectural design for a modular UV (ultraviolet) process output parser. The design addresses the issues with the current monolithic implementation by providing clean separation of concerns, well-defined interfaces, and maintainable components.

## Design Principles

1. **Single Responsibility**: Each component has one clear purpose
2. **Loose Coupling**: Components communicate through interfaces, not implementations
3. **High Cohesion**: Related functionality is grouped together
4. **Testability**: Each component can be tested in isolation
5. **Maintainability**: Clear boundaries make changes easier
6. **Performance**: Efficient memory management and throttling

## Architecture Components

### Core Components

1. **LineParser** (`ILineParser`)
   - Stateless parsing of log lines into structured events
   - No state management or side effects
   - Pure transformation function

2. **PhaseManager** (`IPhaseManager`)
   - Manages installation phase state machine
   - Enforces valid phase transitions
   - Tracks phase history and timing

3. **PackageRegistry** (`IPackageRegistry`)
   - Central registry for all packages
   - Single source of truth for package metadata
   - Tracks package status throughout lifecycle

4. **DownloadManager** (`IDownloadManager`)
   - Manages individual package downloads
   - Tracks progress and transfer statistics
   - Handles download lifecycle (start → complete/fail)

5. **StreamTracker** (`IStreamTracker`)
   - Tracks HTTP/2 streams
   - Associates streams with package downloads
   - Manages stream-to-package matching logic

6. **ProgressCalculator** (`IProgressCalculator`)
   - Calculates download progress and ETAs
   - Computes transfer rates
   - Formats bytes and durations

7. **StateAggregator** (`IStateAggregator`)
   - Orchestrates all components
   - Builds unified installation state
   - Processes events and updates components

8. **EventDispatcher** (`IEventDispatcher`)
   - Manages event listeners
   - Implements intelligent throttling
   - Prevents UI update spam

## Key Improvements Over Current Implementation

### Current Issues Addressed

1. **Monolithic Class (1261 lines)** → **8 Focused Components**
   - Each component is typically 100-200 lines
   - Clear, single responsibilities

2. **Mixed Responsibilities** → **Separation of Concerns**
   - Parsing separated from state management
   - Progress calculation independent of download tracking
   - Event dispatching decoupled from state aggregation

3. **Complex Stream Association** → **Dedicated StreamTracker**
   - Isolated complex logic in one component
   - Clear association strategies
   - Testable matching algorithms

4. **Direct State Mutation** → **Immutable State Updates**
   - State aggregator builds new state snapshots
   - Components don't directly modify shared state
   - Predictable state transitions

5. **Memory Leaks** → **Automatic Cleanup**
   - Built-in cleanup methods
   - Configurable retention policies
   - Memory-bounded collections

## Files Created

1. **`architecture.ts`** - Complete interface definitions with JSDoc documentation
2. **`interaction-documentation.md`** - Detailed component interaction patterns
3. **`example-implementations.ts`** - Example implementations showing usage
4. **`README.md`** - This overview document

## Usage Example

```typescript
// Create parser with factory
const factory = new UvParserFactory();
const parser = factory.createParser({
  eventConfig: {
    progressThrottleMs: 100,
    progressThresholdPercent: 5
  },
  maxDownloads: 100,
  downloadMaxAge: 300000 // 5 minutes
});

// Subscribe to events
parser.onStatusChange((state) => {
  console.log(`Phase: ${state.phase}`);
  console.log(`Progress: ${state.overallProgress}%`);
  if (state.currentOperation?.type === 'downloading') {
    const progress = state.currentOperation.progress;
    console.log(`Downloading ${progress.packageName}: ${progress.percentComplete}%`);
  }
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

## Testing Strategy

Each component can be tested independently:

```typescript
// Unit test example
describe('PhaseManager', () => {
  it('should enforce valid transitions', () => {
    const manager = new PhaseManager();
    
    expect(manager.transitionTo('started')).toBe(true);
    expect(manager.transitionTo('installed')).toBe(false); // Invalid
    expect(manager.transitionTo('reading_requirements')).toBe(true);
  });
});

describe('DownloadManager', () => {
  it('should track download progress', () => {
    const manager = new DownloadManager();
    
    manager.startDownload('torch', 66492975, 'https://...');
    manager.updateEstimatedProgress('torch', 1000000);
    
    const download = manager.getDownload('torch');
    expect(download?.estimatedBytes).toBe(1000000);
    expect(download?.status).toBe('downloading');
  });
});
```

## Performance Considerations

1. **Event Batching**: Multiple lines processed before state emission
2. **Throttling**: Configurable update frequency limits
3. **Lazy Calculation**: Progress calculated only when needed
4. **Memory Bounds**: Automatic cleanup of old data
5. **Stateless Parsing**: Enables parallel processing if needed

## Migration Path

To migrate from the current implementation:

1. **Phase 1**: Implement new components alongside existing code
2. **Phase 2**: Create adapter to use new parser with existing interfaces
3. **Phase 3**: Update consumers to use new event-based API
4. **Phase 4**: Remove old implementation

## Benefits

- **Maintainability**: Easier to understand and modify
- **Testability**: Each component tested in isolation
- **Reliability**: Clear state transitions and error handling
- **Performance**: Better memory management and throttling
- **Extensibility**: Easy to add new features or modify behavior
- **Type Safety**: Full TypeScript interfaces with documentation

## Next Steps

1. Implement the interfaces with production code
2. Write comprehensive unit tests for each component
3. Create integration tests for component interactions
4. Build migration adapter for existing code
5. Performance test with real UV output
6. Deploy incrementally with feature flags

This architecture provides a solid foundation for a maintainable, efficient, and reliable UV parser that can evolve with changing requirements.
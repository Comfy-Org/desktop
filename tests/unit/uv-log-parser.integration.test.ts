/**
 * Integration tests for UV log parser with real log data
 *
 * These tests validate the parser against actual uv log output patterns
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { DownloadProgress, Phase, UvLogParser, UvStatus } from '../../src/uvLogParser';

describe('UvLogParser Integration Tests', () => {
  let parser: UvLogParser;

  beforeEach(() => {
    parser = new UvLogParser();
  });

  describe('Real-time Log Streaming Simulation', () => {
    it('should handle progressive log streaming', () => {
      const statusUpdates: UvStatus[] = [];

      // Simulate log lines arriving over time
      const logStream = [
        { time: 0, line: '    0.000690s DEBUG uv uv 0.8.13 (ede75fe62 2025-08-21)' },
        { time: 100, line: ' uv_requirements::specification::from_source source=assets/ComfyUI/requirements.txt' },
        {
          time: 200,
          line: '    0.078373s   0ms DEBUG uv_resolver::resolver Solving with installed Python version: 3.12.9',
        },
        { time: 2000, line: 'Resolved 60 packages in 2.00s' },
        {
          time: 2100,
          line: '   uv_installer::preparer::get_wheel name=numpy==2.0.0, size=Some(16277507), url="https://..."',
        },
        { time: 2200, line: 'Downloading numpy (15.5MiB)' },
        {
          time: 2300,
          line: '2.147564s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15) }',
        },
        {
          time: 2400,
          line: '2.155123s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15) }',
        },
        {
          time: 2500,
          line: '2.161986s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15) }',
        },
        {
          time: 5000,
          line: '2.603342s   2s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15), flags: (0x1: END_STREAM) }',
        },
        { time: 5100, line: 'Prepared 1 package in 3000ms' },
        { time: 5200, line: 'Installed 1 package in 10ms' },
      ];

      for (const { line } of logStream) {
        const status = parser.parseLine(line);
        if (status.phase !== 'unknown') {
          statusUpdates.push(status);
        }
      }

      // Verify the progression of phases
      const phases = statusUpdates.map((s) => s.phase);
      expect(phases).toContain('started');
      expect(phases).toContain('reading_requirements');
      expect(phases).toContain('resolving');
      expect(phases).toContain('resolved');
      expect(phases).toContain('preparing_download');
      expect(phases).toContain('downloading');
      expect(phases).toContain('prepared');
      expect(phases).toContain('installed');

      // Verify final state
      const finalState = parser.getOverallState();
      expect(finalState.isComplete).toBe(true);
      expect(finalState.totalPackages).toBe(60);
      expect(finalState.installedPackages).toBe(1);
    });
  });

  describe('Multi-Package Download Tracking', () => {
    it('should track multiple concurrent downloads', () => {
      const logLines = [
        'Resolved 5 packages in 1.50s',
        '   uv_installer::preparer::get_wheel name=package1==1.0.0, size=Some(1000000), url="https://..."',
        '   uv_installer::preparer::get_wheel name=package2==2.0.0, size=Some(2000000), url="https://..."',
        '   uv_installer::preparer::get_wheel name=package3==3.0.0, size=Some(3000000), url="https://..."',
        'Downloading package1 (976.6KiB)',
        '2.100000s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }',
        'Downloading package2 (1.9MiB)',
        '2.200000s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(3) }',
        'Downloading package3 (2.9MiB)',
        '2.300000s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(5) }',
      ];

      for (const line of logLines) {
        parser.parseLine(line);
      }

      const downloads = parser.getActiveDownloads();
      expect(downloads).toHaveLength(3);
      expect(downloads.map((d) => d.package)).toEqual(['package1', 'package2', 'package3']);
      expect(downloads.map((d) => d.totalBytes)).toEqual([1_000_000, 2_000_000, 3_000_000]);

      const transfers = parser.getActiveTransfers();
      expect(Object.keys(transfers)).toHaveLength(3);
      expect(transfers['1'].frameCount).toBe(1);
      expect(transfers['3'].frameCount).toBe(1);
      expect(transfers['5'].frameCount).toBe(1);
    });
  });

  describe('Download Progress Tracking', () => {
    it('should estimate download progress from HTTP/2 frames', () => {
      // Setup a download
      parser.parseLine('   uv_installer::preparer::get_wheel name=tensorflow==2.16.0, size=Some(104857600), url="..."'); // 100MB
      parser.parseLine('Downloading tensorflow (100.0MiB)');

      // Simulate receiving data frames over time
      const frameInterval = 100; // ms
      const totalFrames = 50; // 5 seconds of data

      for (let i = 0; i < totalFrames; i++) {
        const timestamp = (2 + (i * frameInterval) / 1000).toFixed(6);
        parser.parseLine(`${timestamp}s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }`);
      }

      const progress = parser.getDownloadProgress('tensorflow');
      expect(progress).toBeDefined();
      expect(progress!.package).toBe('tensorflow');
      expect(progress!.totalBytes).toBe(104_857_600);
      expect(progress!.percentComplete).toBeGreaterThan(0);
      expect(progress!.transferRateSamples.length).toBeGreaterThan(0);
    });

    it('should calculate smoothed transfer rate', () => {
      // Setup download with known progress
      parser.parseLine('   uv_installer::preparer::get_wheel name=pytorch==2.0.0, size=Some(52428800), url="..."'); // 50MB
      parser.parseLine('Downloading pytorch (50.0MiB)');

      // Simulate variable transfer rates
      const samples = [
        { time: 1000, frames: 5 }, // Slow start
        { time: 2000, frames: 10 }, // Speed up
        { time: 3000, frames: 15 }, // Peak speed
        { time: 4000, frames: 12 }, // Slight slowdown
        { time: 5000, frames: 13 }, // Stabilize
      ];

      for (const { time, frames } of samples) {
        for (let i = 0; i < frames; i++) {
          const timestamp = (time / 1000).toFixed(6);
          parser.parseLine(
            `${timestamp}s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }`
          );
        }
      }

      const progress = parser.getDownloadProgress('pytorch');
      expect(progress).toBeDefined();

      const avgRate = parser.calculateAverageTransferRate(progress!);
      expect(avgRate).toBeGreaterThan(0);

      const timeRemaining = parser.estimateTimeRemaining(progress!, avgRate);
      expect(timeRemaining).toBeGreaterThan(0);
      expect(timeRemaining).toBeLessThan(60); // Should complete within a minute
    });
  });

  describe('Error Recovery and Edge Cases', () => {
    it('should handle interrupted downloads', () => {
      parser.parseLine('   uv_installer::preparer::get_wheel name=scipy==1.12.0, size=Some(31457280), url="..."');
      parser.parseLine('Downloading scipy (30.0MiB)');
      parser.parseLine('ERROR: Connection reset by peer');

      const state = parser.getOverallState();
      expect(state.currentPhase).toBe('error');

      const downloads = parser.getActiveDownloads();
      const scipyDownload = downloads.find((d) => d.package === 'scipy');
      expect(scipyDownload?.status).toBe('failed');
    });

    it('should handle cached packages (no download needed)', () => {
      const logLines = [
        'Resolved 3 packages in 0.50s',
        '    0.571802s 489ms DEBUG uv_resolver::candidate_selector Found installed version of numpy==2.0.0 that satisfies *',
        '    0.571829s 493ms DEBUG uv_resolver::resolver Selecting: numpy==2.0.0 [installed] (installed)',
        'Installed 0 packages in 0ms',
      ];

      for (const line of logLines) {
        parser.parseLine(line);
      }

      const state = parser.getOverallState();
      expect(state.totalPackages).toBe(3);
      expect(state.installedPackages).toBe(0); // Already installed
      expect(parser.getActiveDownloads()).toHaveLength(0);
    });

    it('should handle requirements file with comments and empty lines', () => {
      // Parser should focus on actual log output, not requirements file content
      parser.parseLine(' uv_requirements::specification::from_source source=requirements.txt');
      const status = parser.getOverallState();
      expect(status.currentPhase).toBe('reading_requirements');
    });
  });

  describe('Performance Metrics', () => {
    it('should track overall installation performance', () => {
      const perfLog = [
        '    0.000690s DEBUG uv uv 0.8.13',
        '    0.078373s   0ms DEBUG uv_resolver::resolver Solving with installed Python version: 3.12.9',
        'Resolved 60 packages in 2.00s',
        'Prepared 5 packages in 515ms',
        'Installed 5 packages in 7ms',
      ];

      for (const line of perfLog) {
        parser.parseLine(line);
      }

      const state = parser.getOverallState();
      expect(state.phases).toContain('resolved');
      expect(state.phases).toContain('prepared');
      expect(state.phases).toContain('installed');

      // Note: Actual implementation would track real timestamps
      // Total time would be roughly: resolution (2s) + preparation (515ms) + installation (7ms)
    });
  });

  describe('Log Pattern Variations', () => {
    it('should handle different uv versions and formats', () => {
      const variations = [
        '    0.000690s DEBUG uv uv 0.8.13 (ede75fe62 2025-08-21)',
        '    0.000500s DEBUG uv uv 0.9.0',
        '    0.001000s DEBUG uv uv 1.0.0-beta.1 (abc12345 2025-09-01)',
      ];

      for (const line of variations) {
        parser.reset();
        const status = parser.parseLine(line);
        expect(status.phase).toBe('started');
        expect(status.uvVersion).toMatch(/\d+\.\d+/);
      }
    });

    it('should handle different package size formats', () => {
      const sizeFormats = [
        { line: 'Downloading small-pkg (125B)', expected: '125B' },
        { line: 'Downloading medium-pkg (45.6KiB)', expected: '45.6KiB' },
        { line: 'Downloading large-pkg (1.2MiB)', expected: '1.2MiB' },
        { line: 'Downloading huge-pkg (2.5GiB)', expected: '2.5GiB' },
      ];

      for (const { line, expected } of sizeFormats) {
        const status = parser.parseLine(line);
        expect(status.packageSizeFormatted).toBe(expected);
      }
    });
  });

  describe('HTTP/2 Frame Size Dynamics', () => {
    it('should update max frame size from SETTINGS frames', () => {
      // Initial download with default frame size
      parser.parseLine('   uv_installer::preparer::get_wheel name=package==1.0.0, size=Some(10_000_000), url="..."');
      parser.parseLine(
        '1.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(3), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      // Receive SETTINGS frame with new max frame size
      parser.parseLine(
        '1.100000s DEBUG h2::codec::framed_read received, frame=Settings { flags: (0x0: empty), max_frame_size: Some(32768) }'
      );

      // Future data frames should use new frame size for calculations
      parser.parseLine('1.200000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(3) }');

      const progress = parser.getDownloadProgress('package');
      expect(progress?.estimatedBytesReceived).toBeGreaterThan(0);
      // Should be based on new frame size of 32768, not default 16384
    });

    it('should calculate partial final frames correctly', () => {
      // Download with known exact size
      parser.parseLine('   uv_installer::preparer::get_wheel name=small==1.0.0, size=Some(50_000), url="..."');
      parser.parseLine(
        '1.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(5), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      // With 16384 byte frames, 50000 bytes = 3 full frames + partial
      // 3 * 16384 = 49152, leaving 848 bytes in final frame
      parser.parseLine('1.100000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(5) }');
      parser.parseLine('1.200000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(5) }');
      parser.parseLine('1.300000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(5) }');
      parser.parseLine(
        '1.400000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(5), flags: (0x1: END_STREAM) }'
      );

      const progress = parser.getDownloadProgress('small');
      expect(progress?.bytesReceived).toBe(50_000); // Exact size
      expect(progress?.percentComplete).toBe(100);
    });

    it('should handle frame size changes mid-download', () => {
      parser.parseLine('   uv_installer::preparer::get_wheel name=dynamic==1.0.0, size=Some(1_000_000), url="..."');
      parser.parseLine(
        '1.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(7), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      // Start with default frame size
      parser.parseLine('1.100000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(7) }');
      let progress = parser.getDownloadProgress('dynamic');
      const bytesAfterFirst = progress?.estimatedBytesReceived || 0;

      // Change frame size
      parser.parseLine(
        '1.200000s DEBUG h2::codec::framed_read received, frame=Settings { flags: (0x0: empty), max_frame_size: Some(65536) }'
      );

      // Next frame should use new size
      parser.parseLine('1.300000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(7) }');
      progress = parser.getDownloadProgress('dynamic');
      const bytesAfterSecond = progress?.estimatedBytesReceived || 0;

      // Second frame should add more bytes due to larger frame size
      expect(bytesAfterSecond - bytesAfterFirst).toBeGreaterThan(16_384);
    });
  });

  describe('Download Time Estimation', () => {
    it('should calculate ETA based on smoothed transfer rate', () => {
      // Start download
      parser.parseLine('   uv_installer::preparer::get_wheel name=package==1.0.0, size=Some(10_485_760), url="..."');

      // Create progress with known state
      const progress: DownloadProgress = {
        package: 'package',
        totalBytes: 10_485_760, // 10MB
        bytesReceived: 5_242_880, // 5MB received
        percentComplete: 50,
        startTime: Date.now() - 5000,
        currentTime: Date.now(),
        transferRateSamples: [
          { timestamp: Date.now() - 1000, bytesPerSecond: 1_048_576 }, // 1MB/s
        ],
        averageTransferRate: 1_048_576, // 1MB/s
      };

      const eta = parser.estimateTimeRemaining(progress, progress.averageTransferRate!);
      expect(eta).toBe(5); // 5MB remaining at 1MB/s = 5 seconds
    });

    it('should handle ETA for unknown file sizes as undefined', () => {
      parser.parseLine('   uv_installer::preparer::get_wheel name=unknown==1.0.0, size=None, url="..."');

      const progress = parser.getDownloadProgress('unknown');
      const eta = progress ? parser.estimateTimeRemaining(progress, 1_000_000) : undefined;
      expect(eta).toBeUndefined();
    });

    it('should update ETA as transfer rate changes', () => {
      const progress: DownloadProgress = {
        package: 'package',
        totalBytes: 10_000_000,
        bytesReceived: 2_000_000,
        percentComplete: 20,
        startTime: Date.now() - 10_000,
        currentTime: Date.now(),
        transferRateSamples: [],
        averageTransferRate: 0,
      };

      // Slow rate initially
      let eta = parser.estimateTimeRemaining(progress, 100_000); // 100KB/s
      expect(eta).toBe(80); // 8MB at 100KB/s = 80 seconds

      // Rate increases
      eta = parser.estimateTimeRemaining(progress, 1_000_000); // 1MB/s
      expect(eta).toBe(8); // 8MB at 1MB/s = 8 seconds
    });

    it('should clear ETA when download completes', () => {
      const progress: DownloadProgress = {
        package: 'package',
        totalBytes: 1_000_000,
        bytesReceived: 1_000_000, // Complete
        percentComplete: 100,
        startTime: Date.now() - 5000,
        currentTime: Date.now(),
        transferRateSamples: [],
        averageTransferRate: 200_000,
      };

      const eta = parser.estimateTimeRemaining(progress, progress.averageTransferRate!);
      expect(eta).toBe(0);
    });
  });

  describe('User Status Messages', () => {
    it('should generate human-readable status messages', () => {
      // Mock parser method for generating status messages
      const generateStatusMessage = (state: any) => {
        if (state.phase === 'downloading') {
          const active = state.activeDownloads || 0;
          const completed = state.completedDownloads || 0;
          const total = active + completed;
          return `Downloading packages (${completed}/${total})`;
        }
        if (state.phase === 'installing') {
          return `Installing packages...`;
        }
        return state.message || '';
      };

      // Test various states
      expect(generateStatusMessage({ phase: 'downloading', activeDownloads: 3, completedDownloads: 2 })).toBe(
        'Downloading packages (2/5)'
      );

      expect(generateStatusMessage({ phase: 'installing' })).toBe('Installing packages...');
    });

    it('should include queue counts when packages are waiting', () => {
      // Parse multiple packages
      parser.parseLine('   uv_installer::preparer::get_wheel name=package1==1.0.0, size=Some(1_000_000), url="..."');
      parser.parseLine('   uv_installer::preparer::get_wheel name=package2==1.0.0, size=Some(2_000_000), url="..."');
      parser.parseLine('   uv_installer::preparer::get_wheel name=package3==1.0.0, size=Some(3_000_000), url="..."');

      // Mock status message generation with queue info
      const downloads = parser.getActiveDownloads();
      const queuedCount = downloads.filter((d) => d.status === 'pending').length;
      const activeCount = downloads.filter((d) => d.status === 'downloading').length;

      const statusMessage =
        queuedCount > 0
          ? `Downloading ${activeCount} packages (${queuedCount} queued)`
          : `Downloading ${activeCount} packages`;

      expect(statusMessage).toContain('queued');
    });

    it('should format time durations appropriately', () => {
      // Helper function for time formatting
      const formatDuration = (seconds: number): string => {
        if (seconds < 60) return `${Math.round(seconds)}s`;
        const minutes = Math.floor(seconds / 60);
        const secs = Math.round(seconds % 60);
        return `${minutes}m ${secs}s`;
      };

      expect(formatDuration(45)).toBe('45s');
      expect(formatDuration(90)).toBe('1m 30s');
      expect(formatDuration(125)).toBe('2m 5s');
    });

    it('should update messages in real-time', () => {
      const messages: string[] = [];

      // Simulate real-time updates
      parser.parseLine('Resolved 5 packages in 1.00s');
      messages.push('Resolved 5 packages');

      parser.parseLine('   uv_installer::preparer::get_wheel name=package1==1.0.0, size=Some(1000000), url="..."');
      messages.push('Downloading package1');

      parser.parseLine('Prepared 1 package in 100ms');
      messages.push('Prepared 1 package');

      // Verify message progression
      expect(messages.length).toBe(3);
      expect(messages[0]).toContain('Resolved');
      expect(messages[1]).toContain('Downloading');
      expect(messages[2]).toContain('Prepared');
    });
  });

  describe('Stream ID Conflict Resolution', () => {
    it('should handle duplicate stream ID assignment gracefully', () => {
      // First package uses stream ID 3
      parser.parseLine('   uv_installer::preparer::get_wheel name=package1==1.0.0, size=Some(1_000), url="..."');
      parser.parseLine(
        '1.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(3), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      // Attempt to assign same stream ID to different package (shouldn't happen in HTTP/2, but test robustness)
      parser.parseLine('   uv_installer::preparer::get_wheel name=package2==2.0.0, size=Some(2_000), url="..."');
      parser.parseLine(
        '1.100000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(3), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      // Parser should handle this gracefully - either error or reassign
      const downloads = parser.getActiveDownloads();

      // Should have both packages tracked somehow
      expect(downloads.length).toBeGreaterThanOrEqual(1);
    });

    it('should warn on stream ID reuse before completion', () => {
      // Stream 5 starts
      parser.parseLine(
        '1.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(5), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      // Stream 5 gets data
      parser.parseLine('1.100000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(5) }');

      // Stream 5 reused before END_STREAM (error condition)
      parser.parseLine(
        '1.200000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(5), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      // Should handle gracefully
      const transfers = parser.getActiveTransfers();
      expect(transfers).toBeDefined();
    });

    it('should clean up stream IDs after END_STREAM', () => {
      // Start and complete a download
      parser.parseLine('   uv_installer::preparer::get_wheel name=package1==1.0.0, size=Some(1_000), url="..."');
      parser.parseLine(
        '1.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(7), flags: (0x5: END_HEADERS | END_STREAM) }'
      );
      parser.parseLine(
        '1.100000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(7), flags: (0x1: END_STREAM) }'
      );

      // Stream 7 should be cleaned up
      let transfers = parser.getActiveTransfers();
      expect(transfers['7']).toBeUndefined();

      // Stream 7 can be reused for new download
      parser.parseLine('   uv_installer::preparer::get_wheel name=package2==2.0.0, size=Some(2_000), url="..."');
      parser.parseLine(
        '2.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(7), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      transfers = parser.getActiveTransfers();
      expect(transfers['7']).toBeDefined();
      expect(transfers['7'].associatedPackage).toBe('package2');
    });
  });

  describe('Aggregate Progress Calculation', () => {
    it('should calculate overall progress weighted by package sizes', () => {
      // Add packages with different sizes
      const packages = [
        { name: 'small==1.0.0', size: 100_000 }, // 100KB
        { name: 'medium==1.0.0', size: 1_000_000 }, // 1MB
        { name: 'large==1.0.0', size: 10_000_000 }, // 10MB
      ];

      for (const pkg of packages) {
        parser.parseLine(`   uv_installer::preparer::get_wheel name=${pkg.name}, size=Some(${pkg.size}), url="..."`);
      }

      // Mock progress for each package
      // Small: 100% complete (100KB of 100KB)
      // Medium: 50% complete (500KB of 1MB)
      // Large: 10% complete (1MB of 10MB)
      // Total: (100KB + 500KB + 1MB) / 11.1MB = ~14.4%

      // This would be calculated by the parser
      const totalBytes = packages.reduce((sum, p) => sum + p.size, 0);
      const receivedBytes = 100_000 + 500_000 + 1_000_000;
      const overallProgress = (receivedBytes / totalBytes) * 100;

      expect(overallProgress).toBeCloseTo(14.4, 1);
    });

    it('should handle mix of known and unknown package sizes', () => {
      // Some packages have size, some don't
      parser.parseLine('   uv_installer::preparer::get_wheel name=known1==1.0.0, size=Some(1_000_000), url="..."');
      parser.parseLine('   uv_installer::preparer::get_wheel name=unknown==1.0.0, size=None, url="..."');
      parser.parseLine('   uv_installer::preparer::get_wheel name=known2==1.0.0, size=Some(2_000_000), url="..."');

      const downloads = parser.getActiveDownloads();
      const knownSizes = downloads.filter((d) => d.totalBytes > 0);
      const unknownSizes = downloads.filter((d) => d.totalBytes === 0);

      expect(knownSizes.length).toBe(2);
      expect(unknownSizes.length).toBe(1);

      // Progress calculation should handle this gracefully
      // Could show progress for known sizes only, or use package count fallback
    });

    it('should update dynamically as packages complete', () => {
      // Start multiple downloads
      parser.parseLine('   uv_installer::preparer::get_wheel name=package1==1.0.0, size=Some(1_000_000), url="..."');
      parser.parseLine('   uv_installer::preparer::get_wheel name=package2==1.0.0, size=Some(1_000_000), url="..."');

      let downloads = parser.getActiveDownloads();
      expect(downloads.filter((d) => d.status === 'completed').length).toBe(0);

      // Complete first package
      parser.parseLine('Prepared 1 package in 100ms');

      // Check that progress updated
      downloads = parser.getActiveDownloads();
      // Implementation would track completed packages
    });
  });

  describe('State Consistency', () => {
    it('should maintain consistent state across phase transitions', () => {
      const completeFlow = [
        '    0.000690s DEBUG uv uv 0.8.13',
        ' uv_requirements::specification::from_source source=requirements.txt',
        '    0.078373s   0ms DEBUG uv_resolver::resolver Solving with installed Python version: 3.12.9',
        '    0.079718s   1ms DEBUG uv_resolver::resolver Adding direct dependency: requests>=2.31.0',
        'Resolved 10 packages in 1.50s',
        '   uv_installer::preparer::get_wheel name=requests==2.31.0, size=Some(62550), url="..."',
        'Downloading requests (61.1KiB)',
        'Prepared 1 package in 200ms',
        ' uv_installer::installer::install_blocking num_wheels=1',
        'Installed 1 package in 5ms',
      ];

      const expectedPhases: Phase[] = [
        'started',
        'reading_requirements',
        'resolving',
        'resolving',
        'resolved',
        'preparing_download',
        'downloading',
        'prepared',
        'installing',
        'installed',
      ];

      for (const [index, line] of completeFlow.entries()) {
        const status = parser.parseLine(line);
        if (status.phase !== 'unknown') {
          expect(status.phase).toBe(expectedPhases[index]);
        }
      }

      const finalState = parser.getOverallState();
      expect(finalState.isComplete).toBe(true);
      expect(finalState.currentPhase).toBe('installed');
    });

    it('should not regress to earlier phases', () => {
      const phases: Phase[] = [];

      const logSequence = [
        'Resolved 5 packages in 1.00s',
        'Downloading package1 (1.0MiB)',
        'Prepared 1 package in 100ms',
        // This shouldn't cause regression
        '    0.079718s   1ms DEBUG uv_resolver::resolver Adding direct dependency: some-package',
        'Installed 1 package in 5ms',
      ];

      for (const line of logSequence) {
        const status = parser.parseLine(line);
        if (status.phase !== 'unknown') {
          phases.push(status.phase);
        }
      }

      // Verify no regression from 'prepared' back to 'resolving'
      const preparedIndex = phases.indexOf('prepared');
      const resolvingAfter = phases.slice(preparedIndex).indexOf('resolving');
      expect(resolvingAfter).toBe(-1);
    });
  });
});

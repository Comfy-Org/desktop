/**
 * Performance and stress tests for UV log parser
 *
 * These tests validate the parser's ability to handle large volumes of log data
 * and maintain performance under stress conditions
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { UvLogParser } from '../../src/uvLogParser';

describe('UvLogParser Performance Tests', () => {
  let parser: UvLogParser;

  beforeEach(() => {
    parser = new UvLogParser();
  });

  describe('Large Log Volume Handling', () => {
    it('should efficiently parse thousands of log lines', () => {
      const startTime = Date.now();
      const lineCount = 10_000;

      // Generate a large volume of mixed log lines
      for (let i = 0; i < lineCount; i++) {
        const lineType = i % 10;
        let line: string;

        switch (lineType) {
          case 0:
            line = `${i}.000000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(${i % 50}) }`;
            break;
          case 1:
            line = `${i}.000000s DEBUG uv_resolver::resolver Adding direct dependency: package${i}>=1.0.0`;
            break;
          case 2:
            line = `${i}.000000s DEBUG uv_client::cached_client No cache entry for: https://pypi.org/simple/package${i}/`;
            break;
          default:
            line = `${i}.000000s DEBUG some::module Random debug line ${i}`;
        }

        parser.parseLine(line);
      }

      const processingTime = Date.now() - startTime;

      // Should process 10,000 lines in under 1 second
      expect(processingTime).toBeLessThan(1000);

      // Should maintain accurate state
      const transfers = parser.getActiveTransfers();
      expect(Object.keys(transfers).length).toBeGreaterThan(0);
    });

    it('should handle rapid HTTP/2 frame updates', () => {
      // Simulate a high-speed download with many frames
      parser.parseLine(
        '   uv_installer::preparer::get_wheel name=large-package==1.0.0, size=Some(1073741824), url="..."'
      ); // 1GB
      parser.parseLine('Downloading large-package (1.0GiB)');

      const frameCount = 1000;
      const startTime = Date.now();

      // Simulate receiving 1000 frames rapidly
      for (let i = 0; i < frameCount; i++) {
        const timestamp = 2000 + i * 10; // 10ms intervals
        parser.parseLine(`${timestamp}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }`);
      }

      const processingTime = Date.now() - startTime;

      // Should handle 1000 frames in under 100ms
      expect(processingTime).toBeLessThan(100);

      const transfers = parser.getActiveTransfers();
      expect(transfers['1'].frameCount).toBe(frameCount);
    });
  });

  describe('Memory Efficiency', () => {
    it('should not accumulate unlimited state data', () => {
      // Parse many packages to test memory management
      const packageCount = 1000;

      for (let i = 0; i < packageCount; i++) {
        parser.parseLine(
          `   uv_installer::preparer::get_wheel name=package${i}==1.0.0, size=Some(${1000 * i}), url="..."`
        );
        parser.parseLine(`Downloading package${i} (${i}KiB)`);
        parser.parseLine(
          `${i * 100}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(${i}), flags: (0x1: END_STREAM) }`
        );
      }

      const downloads = parser.getActiveDownloads();

      // Should have a reasonable limit on tracked downloads
      // (implementation should clean up completed downloads)
      expect(downloads.length).toBeLessThanOrEqual(100);
    });

    it('should cleanup completed transfers', () => {
      // Start multiple transfers
      for (let i = 1; i <= 10; i++) {
        parser.parseLine(`   uv_installer::preparer::get_wheel name=pkg${i}==1.0.0, size=Some(1000), url="..."`);
        parser.parseLine(`Downloading pkg${i} (1.0KiB)`);
        parser.parseLine(
          `${i * 100}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(${i}) }`
        );
      }

      // Complete half of them
      for (let i = 1; i <= 5; i++) {
        parser.parseLine(
          `${i * 200}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(${i}), flags: (0x1: END_STREAM) }`
        );
      }

      const transfers = parser.getActiveTransfers();
      const activeStreamIds = Object.keys(transfers).map((id) => Number.parseInt(id));

      // Should only have uncompleted transfers
      expect(activeStreamIds).not.toContain(1);
      expect(activeStreamIds).not.toContain(2);
      expect(activeStreamIds).not.toContain(3);
      expect(activeStreamIds).not.toContain(4);
      expect(activeStreamIds).not.toContain(5);
      expect(activeStreamIds).toContain(6);
      expect(activeStreamIds).toContain(7);
      expect(activeStreamIds).toContain(8);
      expect(activeStreamIds).toContain(9);
      expect(activeStreamIds).toContain(10);
    });
  });

  describe('Transfer Rate Calculation Performance', () => {
    it('should efficiently calculate smoothed transfer rates', () => {
      // Setup a download with many rate samples
      parser.parseLine('   uv_installer::preparer::get_wheel name=test-pkg==1.0.0, size=Some(104857600), url="..."'); // 100MB
      parser.parseLine('Downloading test-pkg (100.0MiB)');

      // Generate 500 rate samples
      const sampleCount = 500;
      for (let i = 0; i < sampleCount; i++) {
        parser.parseLine(`${i * 100}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }`);
      }

      const startCalc = Date.now();
      const progress = parser.getDownloadProgress('test-pkg');

      if (progress) {
        // Calculate rate 100 times to test performance
        for (let i = 0; i < 100; i++) {
          parser.calculateAverageTransferRate(progress);
        }
      }

      const calcTime = Date.now() - startCalc;

      // Should calculate 100 rates in under 50ms
      expect(calcTime).toBeLessThan(50);
    });

    it('should limit transfer rate sample history', () => {
      parser.parseLine('   uv_installer::preparer::get_wheel name=stream-pkg==1.0.0, size=Some(10485760), url="..."');
      parser.parseLine('Downloading stream-pkg (10.0MiB)');

      // Generate many samples over "time"
      for (let i = 0; i < 1000; i++) {
        parser.parseLine(`${i * 100}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }`);
      }

      const progress = parser.getDownloadProgress('stream-pkg');

      // Should only keep recent samples (e.g., last 10-20 for smoothing)
      expect(progress?.transferRateSamples.length).toBeLessThanOrEqual(20);
      expect(progress?.transferRateSamples.length).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Concurrent Operations', () => {
    it('should handle multiple packages downloading simultaneously', () => {
      const concurrentDownloads = 20;

      // Start all downloads
      for (let i = 1; i <= concurrentDownloads; i++) {
        parser.parseLine(
          `   uv_installer::preparer::get_wheel name=concurrent${i}==1.0.0, size=Some(${1_048_576 * i}), url="..."`
        );
        parser.parseLine(`Downloading concurrent${i} (${i}.0MiB)`);
      }

      // Simulate interleaved frame receipts
      for (let frame = 0; frame < 100; frame++) {
        for (let pkg = 1; pkg <= concurrentDownloads; pkg++) {
          parser.parseLine(
            `${frame * 10 + pkg}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(${pkg}) }`
          );
        }
      }

      const downloads = parser.getActiveDownloads();
      expect(downloads).toHaveLength(concurrentDownloads);

      // Check that all downloads have progress
      for (const download of downloads) {
        const progress = parser.getDownloadProgress(download.package);
        expect(progress).toBeDefined();
        expect(progress!.percentComplete).toBeGreaterThan(0);
      }
    });

    it('should accurately track overlapping phase transitions', () => {
      // Simulate a scenario where resolution continues while downloads start
      const complexSequence = [
        'Resolved 100 packages in 3.00s',
        '   uv_installer::preparer::get_wheel name=first==1.0.0, size=Some(1000000), url="..."',
        'Downloading first (976.6KiB)',
        '    0.079718s   1ms DEBUG uv_resolver::resolver Adding transitive dependency: extra>=1.0.0',
        '   uv_installer::preparer::get_wheel name=second==2.0.0, size=Some(2000000), url="..."',
        'Downloading second (1.9MiB)',
        '    0.079718s   1ms DEBUG uv_resolver::resolver Adding transitive dependency: another>=2.0.0',
        'Prepared 2 packages in 500ms',
        'Installed 2 packages in 10ms',
      ];

      for (const line of complexSequence) {
        parser.parseLine(line);
      }

      const state = parser.getOverallState();
      expect(state.totalPackages).toBe(100);
      expect(state.installedPackages).toBe(2);
      expect(state.isComplete).toBe(true);
    });
  });

  describe('Edge Cases and Boundary Conditions', () => {
    it('should handle zero-size packages', () => {
      parser.parseLine('   uv_installer::preparer::get_wheel name=empty==1.0.0, size=Some(0), url="..."');
      parser.parseLine('Downloading empty (0B)');

      const downloads = parser.getActiveDownloads();
      expect(downloads[0].totalBytes).toBe(0);

      const progress = parser.getDownloadProgress('empty');
      expect(progress?.percentComplete).toBe(100); // Zero-size is instantly complete
    });

    it('should handle extremely large package sizes', () => {
      const hugeSize = 10_737_418_240; // 10GB
      parser.parseLine(`   uv_installer::preparer::get_wheel name=huge==1.0.0, size=Some(${hugeSize}), url="..."`);
      parser.parseLine('Downloading huge (10.0GiB)');

      const downloads = parser.getActiveDownloads();
      expect(downloads[0].totalBytes).toBe(hugeSize);
    });

    it('should handle malformed timestamps gracefully', () => {
      const malformedLines = [
        'abc.def DEBUG some::module Test',
        '   DEBUG some::module Test',
        '999999999999999s DEBUG some::module Test',
        '-100s DEBUG some::module Test',
      ];

      for (const line of malformedLines) {
        expect(() => parser.parseLine(line)).not.toThrow();
      }
    });

    it('should handle incomplete log lines', () => {
      const incompleteLines = [
        'Resolved',
        'Downloading',
        'Prepared packages',
        'uv_installer::preparer::get_wheel name=',
        'DEBUG h2::codec::framed_read received, frame=Data',
      ];

      for (const line of incompleteLines) {
        const status = parser.parseLine(line);
        // Incomplete lines should now return undefined
        expect(status).toBeUndefined();
      }
    });
  });

  describe('Reset and Reinitialization', () => {
    it('should completely clear state on reset', () => {
      // Fill the parser with data
      parser.parseLine('Resolved 50 packages in 2.00s');
      for (let i = 1; i <= 10; i++) {
        parser.parseLine(`   uv_installer::preparer::get_wheel name=pkg${i}==1.0.0, size=Some(1000000), url="..."`);
        parser.parseLine(`Downloading pkg${i} (976.6KiB)`);
      }

      // Reset
      parser.reset();

      // Verify clean state
      const state = parser.getOverallState();
      expect(state.currentPhase).toBe('idle');
      expect(state.totalPackages).toBe(0);
      expect(state.phases).toEqual([]);
      expect(parser.getActiveDownloads()).toHaveLength(0);
      expect(Object.keys(parser.getActiveTransfers())).toHaveLength(0);
    });

    it('should handle multiple installation sessions', () => {
      // First session
      parser.parseLine('Resolved 10 packages in 1.00s');
      parser.parseLine('Installed 10 packages in 100ms');

      let state = parser.getOverallState();
      expect(state.installedPackages).toBe(10);

      // Reset and second session
      parser.reset();
      parser.parseLine('Resolved 5 packages in 0.50s');
      parser.parseLine('Installed 5 packages in 50ms');

      state = parser.getOverallState();
      expect(state.installedPackages).toBe(5); // Should not accumulate
      expect(state.totalPackages).toBe(5);
    });
  });
});

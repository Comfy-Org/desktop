/**
 * Test suite for UV log parser concurrent download handling
 *
 * This test verifies the parser correctly handles multiple concurrent
 * package downloads without progress jumping or state corruption
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { UvLogParser } from '../../src/uvLogParser';

describe('UvLogParser - Concurrent Downloads', () => {
  let parser: UvLogParser;

  beforeEach(() => {
    parser = new UvLogParser();
  });

  describe('Multi-Package Download Progress', () => {
    it('should not jump to 100% on END_STREAM if not enough data received', () => {
      // Setup torch download
      parser.parseLine('   uv_installer::preparer::get_wheel name=torch==2.8.0, size=Some(73190604), url="..."');
      parser.parseLine('Downloading torch (69.8MiB)');

      // Start receiving HTTP/2 frames
      parser.parseLine('1000ms DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(7) }');

      // Simulate receiving ~10MB of data (about 14% of 73MB)
      const framesFor10MB = Math.ceil((10 * 1024 * 1024) / 16_384); // ~640 frames
      for (let i = 0; i < framesFor10MB; i++) {
        parser.parseLine(`${1100 + i}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(7) }`);
      }

      let progress = parser.getDownloadProgress('torch');
      expect(progress?.percentComplete).toBeGreaterThan(10);
      expect(progress?.percentComplete).toBeLessThan(20);

      // Now simulate END_STREAM flag
      parser.parseLine(
        '2000ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(7), flags: (0x1: END_STREAM) }'
      );

      // Progress should NOT jump to 100%
      progress = parser.getDownloadProgress('torch');
      expect(progress?.percentComplete).toBeLessThan(20); // Should stay around 14%, not jump to 100%
      expect(progress?.percentComplete).not.toBe(100);
    });

    it('should properly track concurrent downloads of torch and numpy', () => {
      // Setup both downloads
      parser.parseLine('   uv_installer::preparer::get_wheel name=torch==2.8.0, size=Some(73190604), url="..."');
      parser.parseLine('   uv_installer::preparer::get_wheel name=numpy==2.0.0, size=Some(5138022), url="..."');
      parser.parseLine('Downloading torch (69.8MiB)');
      parser.parseLine('Downloading numpy (4.9MiB)');

      // Start HTTP/2 streams for both
      parser.parseLine('1000ms DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(7) }');
      parser.parseLine('1001ms DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(9) }');

      // Simulate interleaved data frames
      for (let i = 0; i < 100; i++) {
        // Torch frames
        parser.parseLine(
          `${1100 + i * 10}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(7) }`
        );
        // Numpy frames
        parser.parseLine(
          `${1105 + i * 10}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(9) }`
        );
      }

      const torchProgress = parser.getDownloadProgress('torch');
      const numpyProgress = parser.getDownloadProgress('numpy');

      // Both should have progress
      expect(torchProgress?.percentComplete).toBeGreaterThan(0);
      expect(numpyProgress?.percentComplete).toBeGreaterThan(0);

      // Numpy should have higher percentage (smaller file)
      expect(numpyProgress?.percentComplete).toBeGreaterThan(torchProgress?.percentComplete || 0);

      // Both should have correct total bytes
      expect(torchProgress?.totalBytes).toBe(73_190_604);
      expect(numpyProgress?.totalBytes).toBe(5_138_022);
    });

    it('should only mark complete when sufficient data received', () => {
      parser.parseLine('   uv_installer::preparer::get_wheel name=scipy==1.12.0, size=Some(31457280), url="..."'); // 30MB
      parser.parseLine('Downloading scipy (30.0MiB)');
      parser.parseLine('1000ms DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(5) }');

      // Simulate receiving 95% of data
      const framesFor28MB = Math.ceil((28.5 * 1024 * 1024) / 16_384); // ~1824 frames
      for (let i = 0; i < framesFor28MB; i++) {
        parser.parseLine(`${1100 + i}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(5) }`);
      }

      let progress = parser.getDownloadProgress('scipy');
      expect(progress?.percentComplete).toBeGreaterThan(90);
      expect(progress?.percentComplete).toBeLessThan(100);

      // END_STREAM with 95%+ data should mark as complete
      parser.parseLine(
        '3000ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(5), flags: (0x1: END_STREAM) }'
      );

      progress = parser.getDownloadProgress('scipy');
      expect(progress?.percentComplete).toBe(100);
      expect(progress?.bytesReceived).toBe(31_457_280);
    });

    it('should handle packages without immediate stream association', () => {
      // Setup multiple downloads
      parser.parseLine('   uv_installer::preparer::get_wheel name=package1==1.0.0, size=Some(1000000), url="..."');
      parser.parseLine('   uv_installer::preparer::get_wheel name=package2==2.0.0, size=Some(2000000), url="..."');
      parser.parseLine('   uv_installer::preparer::get_wheel name=package3==3.0.0, size=Some(3000000), url="..."');

      parser.parseLine('Downloading package1 (976.6KiB)');
      parser.parseLine('Downloading package2 (1.9MiB)');
      parser.parseLine('Downloading package3 (2.9MiB)');

      // Start streams
      parser.parseLine('1000ms DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(1) }');
      parser.parseLine('1001ms DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(3) }');
      parser.parseLine('1002ms DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(5) }');

      // Send frames
      for (let i = 0; i < 50; i++) {
        parser.parseLine(`${1100 + i}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }`);
        parser.parseLine(`${1150 + i}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(3) }`);
        parser.parseLine(`${1200 + i}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(5) }`);
      }

      // All packages should have progress
      const progress1 = parser.getDownloadProgress('package1');
      const progress2 = parser.getDownloadProgress('package2');
      const progress3 = parser.getDownloadProgress('package3');

      expect(progress1?.percentComplete).toBeGreaterThan(0);
      expect(progress2?.percentComplete).toBeGreaterThan(0);
      expect(progress3?.percentComplete).toBeGreaterThan(0);

      // Each should have the correct total bytes
      expect(progress1?.totalBytes).toBe(1_000_000);
      expect(progress2?.totalBytes).toBe(2_000_000);
      expect(progress3?.totalBytes).toBe(3_000_000);
    });
  });
});

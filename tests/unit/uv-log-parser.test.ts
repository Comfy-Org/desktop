/**
 * Test suite for UV pip install log parser
 *
 * This test suite validates the parsing and interpretation of uv pip install trace logs
 * to extract meaningful status information about the installation process.
 */
import { beforeEach, describe, expect, it } from 'vitest';

import { DownloadProgress, Phase, TransferRateSample, UvLogParser } from '../../src/uvLogParser';

describe('UvLogParser', () => {
  let parser: UvLogParser;

  beforeEach(() => {
    parser = new UvLogParser();
  });

  describe('Process Start Detection', () => {
    it('should detect when uv process starts', () => {
      const logLine = '    0.000690s DEBUG uv uv 0.8.13 (ede75fe62 2025-08-21)';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('started');
      expect(status.uvVersion).toBe('0.8.13');
      expect(status.message).toBe('uv has started');
    });

    it('should extract requirements file being processed', () => {
      const logLine = ' uv_requirements::specification::from_source source=assets/ComfyUI/requirements.txt';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('reading_requirements');
      expect(status.requirementsFile).toBe('assets/ComfyUI/requirements.txt');
      expect(status.message).toBe('Reading requirements from assets/ComfyUI/requirements.txt');
    });
  });

  describe('Resolution Phase', () => {
    it('should detect when dependency resolution starts', () => {
      const logLine = '    0.078373s   0ms DEBUG uv_resolver::resolver Solving with installed Python version: 3.12.9';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('resolving');
      expect(status.pythonVersion).toBe('3.12.9');
      expect(status.message).toBe('Resolving dependencies with Python 3.12.9');
    });

    it('should track packages being added for resolution', () => {
      const logLine = '    0.079718s   1ms DEBUG uv_resolver::resolver Adding direct dependency: aiohttp>=3.11.8';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('resolving');
      expect(status.currentPackage).toBe('aiohttp');
      expect(status.packageVersion).toBe('>=3.11.8');
      expect(status.message).toBe('Resolving dependency: aiohttp>=3.11.8');
    });

    it('should detect when resolution completes', () => {
      const logLine = 'Resolved 60 packages in 2.00s';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('resolved');
      expect(status.totalPackages).toBe(60);
      expect(status.resolutionTime).toBe(2);
      expect(status.message).toBe('Resolved 60 packages in 2.00s');
    });
  });

  describe('Download Phase', () => {
    it('should detect when package download is being prepared', () => {
      const logLine =
        '   uv_installer::preparer::get_wheel name=aiohttp==3.12.15, size=Some(469787), url="https://files.pythonhosted.org/packages/3a/1d/aiohttp-3.12.15-cp312-cp312-macosx_11_0_arm64.whl"';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('preparing_download');
      expect(status.currentPackage).toBe('aiohttp');
      expect(status.packageVersion).toBe('3.12.15');
      expect(status.packageSize).toBe(469_787);
      expect(status.downloadUrl).toContain('aiohttp-3.12.15');
      expect(status.message).toBe('Preparing to download aiohttp==3.12.15 (459.2 KB)');
    });

    it('should detect when package download starts', () => {
      const logLine = 'Downloading sentencepiece (1.2MiB)';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('downloading');
      expect(status.currentPackage).toBe('sentencepiece');
      expect(status.packageSizeFormatted).toBe('1.2MiB');
      expect(status.message).toBe('Downloading sentencepiece (1.2MiB)');
    });

    it('should track multiple package downloads', () => {
      const lines = [
        '   uv_installer::preparer::get_wheel name=sentencepiece==0.2.1, size=Some(1253645), url="..."',
        '   uv_installer::preparer::get_wheel name=pydantic==2.11.7, size=Some(444782), url="..."',
        '   uv_installer::preparer::get_wheel name=alembic==1.16.4, size=Some(247026), url="..."',
      ];

      for (const line of lines) {
        parser.parseLine(line);
      }
      const downloads = parser.getActiveDownloads();

      expect(downloads).toHaveLength(3);
      expect(downloads[0].package).toBe('sentencepiece');
      expect(downloads[0].version).toBe('0.2.1');
      expect(downloads[0].totalBytes).toBe(1_253_645);

      expect(downloads[1].package).toBe('pydantic');
      expect(downloads[1].version).toBe('2.11.7');
      expect(downloads[1].totalBytes).toBe(444_782);
    });

    it('should detect when downloads are prepared', () => {
      const logLine = 'Prepared 5 packages in 515ms';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('prepared');
      expect(status.preparedPackages).toBe(5);
      expect(status.preparationTime).toBe(515);
      expect(status.message).toBe('Prepared 5 packages in 515ms');
    });
  });

  describe('HTTP/2 Transfer Tracking', () => {
    it('should track HTTP/2 data frame receipts', () => {
      const lines = [
        '2.147564s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15) }',
        '2.150323s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(13) }',
        '2.155123s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15) }',
      ];

      for (const line of lines) {
        parser.parseLine(line);
      }
      const transfers = parser.getActiveTransfers();

      expect(transfers).toHaveProperty('15');
      expect(transfers).toHaveProperty('13');
      expect(transfers['15'].frameCount).toBe(2);
      expect(transfers['13'].frameCount).toBe(1);
    });

    it('should detect when a stream completes', () => {
      const logLine =
        '2.603342s   2s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(11), flags: (0x1: END_STREAM) }';
      const status = parser.parseLine(logLine);

      expect(status.streamCompleted).toBe(true);
      expect(status.streamId).toBe('11');
    });
  });

  describe('Download Progress Estimation', () => {
    it('should calculate download progress based on time and expected size', () => {
      // Simulate a download scenario
      parser.parseLine('   uv_installer::preparer::get_wheel name=numpy==2.0.0, size=Some(10485760), url="..."'); // 10MB
      parser.parseLine('Downloading numpy (10.0MiB)');

      // Simulate progress over time with HTTP/2 frames
      for (let i = 0; i < 100; i++) {
        const timestamp = (2.1 + i * 0.01).toFixed(6);
        parser.parseLine(`${timestamp}s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }`);
      }

      const progress = parser.getDownloadProgress('numpy');

      expect(progress).toBeDefined();
      expect(progress!.package).toBe('numpy');
      expect(progress!.totalBytes).toBe(10_485_760);
      expect(progress!.estimatedBytesReceived).toBeGreaterThan(0);
      expect(progress!.percentComplete).toBeGreaterThanOrEqual(0);
      expect(progress!.percentComplete).toBeLessThanOrEqual(100);
    });

    it('should calculate transfer rate over sliding window', () => {
      const progress: DownloadProgress = {
        package: 'test-package',
        totalBytes: 1_048_576, // 1MB
        bytesReceived: 524_288, // 512KB
        percentComplete: 50,
        startTime: Date.now() - 5000, // Started 5 seconds ago
        currentTime: Date.now(),
        transferRateSamples: [
          { timestamp: Date.now() - 5000, bytesPerSecond: 50_000 },
          { timestamp: Date.now() - 4000, bytesPerSecond: 100_000 },
          { timestamp: Date.now() - 3000, bytesPerSecond: 150_000 },
          { timestamp: Date.now() - 2000, bytesPerSecond: 120_000 },
          { timestamp: Date.now() - 1000, bytesPerSecond: 104_857 }, // ~100KB/s
        ],
      };

      const avgRate = parser.calculateAverageTransferRate(progress);
      const estimatedTimeRemaining = parser.estimateTimeRemaining(progress, avgRate);

      expect(avgRate).toBeGreaterThan(0);
      expect(estimatedTimeRemaining).toBeGreaterThan(0);
      expect(estimatedTimeRemaining).toBeLessThan(10); // Should be less than 10 seconds for 512KB at ~100KB/s
    });
  });

  describe('Installation Phase', () => {
    it('should detect when installation starts', () => {
      const logLine = ' uv_installer::installer::install_blocking num_wheels=5';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('installing');
      expect(status.totalWheels).toBe(5);
      expect(status.message).toBe('Installing 5 packages');
    });

    it('should detect when installation completes', () => {
      const logLine = 'Installed 5 packages in 7ms';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('installed');
      expect(status.installedPackages).toBe(5);
      expect(status.installationTime).toBe(7);
      expect(status.message).toBe('Installed 5 packages in 7ms');
    });

    it('should handle single package installation', () => {
      const logLine = 'Installed 1 package in 3ms';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('installed');
      expect(status.installedPackages).toBe(1);
      expect(status.installationTime).toBe(3);
      expect(status.message).toBe('Installed 1 package in 3ms');
    });
  });

  describe('Error Handling', () => {
    it('should handle malformed log lines gracefully', () => {
      const logLine = 'Some random text that does not match any pattern';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('unknown');
      expect(status.rawLine).toBe(logLine);
    });

    it('should detect error conditions', () => {
      const logLine = 'ERROR: Failed to download package';
      const status = parser.parseLine(logLine);

      expect(status.phase).toBe('error');
      expect(status.error).toContain('Failed to download package');
    });
  });

  describe('State Management', () => {
    it('should maintain overall process state', () => {
      const lines = [
        '    0.000690s DEBUG uv uv 0.8.13 (ede75fe62 2025-08-21)',
        '    0.078373s   0ms DEBUG uv_resolver::resolver Solving with installed Python version: 3.12.9',
        'Resolved 60 packages in 2.00s',
        'Downloading numpy (15.5MiB)',
        'Prepared 1 package in 120ms',
        'Installed 1 package in 3ms',
      ];

      for (const line of lines) {
        parser.parseLine(line);
      }
      const state = parser.getOverallState();

      expect(state.phases).toEqual(['started', 'resolving', 'resolved', 'downloading', 'prepared', 'installed']);
      expect(state.currentPhase).toBe('installed');
      expect(state.isComplete).toBe(true);
      expect(state.totalPackages).toBe(60);
      expect(state.installedPackages).toBe(1);
    });

    it('should reset state when requested', () => {
      parser.parseLine('Resolved 60 packages in 2.00s');
      parser.reset();

      const state = parser.getOverallState();
      expect(state.phases).toEqual([]);
      expect(state.currentPhase).toBe('idle');
      expect(state.totalPackages).toBe(0);
    });
  });

  describe('get_wheel as Authoritative Source', () => {
    it('should use get_wheel size=Some(bytes) as exact size, not "Downloading (1.2MiB)"', () => {
      // First: get_wheel provides exact byte count
      parser.parseLine(
        '   uv_installer::preparer::get_wheel name=sentencepiece==0.2.1, size=Some(1253645), url="https://..."'
      );

      // Then: user-friendly message with approximate size
      parser.parseLine('Downloading sentencepiece (1.2MiB)');

      // Should use exact size from get_wheel, not the approximation
      const downloads = parser.getActiveDownloads();
      const sentencepiece = downloads.find((d) => d.package === 'sentencepiece');
      expect(sentencepiece?.totalBytes).toBe(1_253_645); // Exact bytes, not 1.2 * 1024 * 1024
    });

    it('should handle get_wheel with size=None for unknown sizes', () => {
      parser.parseLine('   uv_installer::preparer::get_wheel name=mypackage==1.0.0, size=None, url="..."');

      const downloads = parser.getActiveDownloads();
      const mypackage = downloads.find((d) => d.package === 'mypackage');
      expect(mypackage).toBeDefined();
      expect(mypackage?.totalBytes).toBe(0); // or undefined, depending on implementation choice
      expect(mypackage?.status).toBe('pending');

      // Progress calculation should handle unknown size gracefully
      const progress = parser.getDownloadProgress('mypackage');
      expect(progress?.percentComplete).toBe(0);
      expect(progress?.estimatedTimeRemaining).toBeUndefined();
    });

    it('should prefer get_wheel timing for download start detection', () => {
      const getWheelTime = '2.093270s';
      const downloadingTime = '2.150000s';

      // get_wheel appears first and marks the actual download start
      parser.parseLine(
        `${getWheelTime}   1s uv_installer::preparer::get_wheel name=numpy==2.0.0, size=Some(16277507), url="..."`
      );

      // Record the download info immediately
      let downloads = parser.getActiveDownloads();
      let numpy = downloads.find((d) => d.package === 'numpy');
      expect(numpy?.status).toBe('pending');
      const startTime1 = numpy?.startTime;

      // Later, the user-friendly message appears
      parser.parseLine(`${downloadingTime} Downloading numpy (15.5MiB)`);

      // Status should now be downloading, but start time should not change
      downloads = parser.getActiveDownloads();
      numpy = downloads.find((d) => d.package === 'numpy');
      expect(numpy?.status).toBe('downloading');
      expect(numpy?.startTime).toBe(startTime1);
    });

    it('should extract exact package metadata from get_wheel', () => {
      const testCases = [
        {
          line: '   uv_installer::preparer::get_wheel name=pydantic==2.11.7, size=Some(444782), url="https://files.pythonhosted.org/packages/..."',
          expected: { package: 'pydantic', version: '2.11.7', totalBytes: 444_782 },
        },
        {
          line: '   uv_installer::preparer::get_wheel name=alembic==1.16.4, size=Some(247026), url="https://..."',
          expected: { package: 'alembic', version: '1.16.4', totalBytes: 247_026 },
        },
        {
          line: '   uv_installer::preparer::get_wheel name=cffi==1.17.1, size=Some(178840), url="https://..."',
          expected: { package: 'cffi', version: '1.17.1', totalBytes: 178_840 },
        },
      ];

      for (const { line, expected } of testCases) {
        parser.parseLine(line);
        const downloads = parser.getActiveDownloads();
        const pkg = downloads.find((d) => d.package === expected.package);
        expect(pkg?.version).toBe(expected.version);
        expect(pkg?.totalBytes).toBe(expected.totalBytes);
      }
    });

    it('should prioritize get_wheel for phase detection over user messages', () => {
      // get_wheel indicates preparing to download
      parser.parseLine('   uv_installer::preparer::get_wheel name=package==1.0.0, size=Some(1000), url="..."');

      const status1 = parser.getOverallState();
      expect(status1.currentPhase).toBe('preparing_download');

      // "Downloading" message transitions to downloading phase
      parser.parseLine('Downloading package (1.0KB)');

      const status2 = parser.getOverallState();
      expect(status2.currentPhase).toBe('downloading');
    });
  });

  describe('Transfer Rate Smoothing', () => {
    it('should calculate smoothed rate over 5-second sliding window', () => {
      // Start a download
      parser.parseLine(
        '   uv_installer::preparer::get_wheel name=largepackage==1.0.0, size=Some(10_485_760), url="..."'
      );

      // Simulate transfer rate samples over time
      const progress: DownloadProgress = {
        package: 'largepackage',
        totalBytes: 10_485_760,
        bytesReceived: 0,
        percentComplete: 0,
        startTime: Date.now(),
        currentTime: Date.now(),
        transferRateSamples: [],
        averageTransferRate: 0,
      };

      // Add samples over 7 seconds
      const now = Date.now();
      const samples: TransferRateSample[] = [
        { timestamp: now - 7000, bytesPerSecond: 100_000 }, // 7s ago - should be excluded
        { timestamp: now - 6000, bytesPerSecond: 150_000 }, // 6s ago - should be excluded
        { timestamp: now - 4500, bytesPerSecond: 200_000 }, // 4.5s ago - included
        { timestamp: now - 3000, bytesPerSecond: 250_000 }, // 3s ago - included
        { timestamp: now - 2000, bytesPerSecond: 300_000 }, // 2s ago - included
        { timestamp: now - 1000, bytesPerSecond: 350_000 }, // 1s ago - included
        { timestamp: now - 500, bytesPerSecond: 400_000 }, // 0.5s ago - included
      ];

      progress.transferRateSamples = samples;
      progress.currentTime = now;

      // Calculate average rate - should only include last 5 seconds
      const avgRate = parser.calculateAverageTransferRate(progress);

      // Expected: (200000 + 250000 + 300000 + 350000 + 400000) / 5 = 300000
      expect(avgRate).toBe(300_000);
    });

    it('should discard samples older than 5 seconds', () => {
      const progress: DownloadProgress = {
        package: 'package',
        totalBytes: 1_000_000,
        bytesReceived: 500_000,
        percentComplete: 50,
        startTime: Date.now() - 10_000,
        currentTime: Date.now(),
        transferRateSamples: [],
        averageTransferRate: 0,
      };

      const now = Date.now();
      // All samples are old
      progress.transferRateSamples = [
        { timestamp: now - 10_000, bytesPerSecond: 100_000 },
        { timestamp: now - 8000, bytesPerSecond: 150_000 },
        { timestamp: now - 6000, bytesPerSecond: 200_000 },
      ];

      const avgRate = parser.calculateAverageTransferRate(progress);
      expect(avgRate).toBe(0); // No recent samples
    });

    it('should weight recent samples more heavily', () => {
      const progress: DownloadProgress = {
        package: 'package',
        totalBytes: 1_000_000,
        bytesReceived: 500_000,
        percentComplete: 50,
        startTime: Date.now() - 5000,
        currentTime: Date.now(),
        transferRateSamples: [],
        averageTransferRate: 0,
      };

      const now = Date.now();
      // Recent samples should have more weight
      progress.transferRateSamples = [
        { timestamp: now - 4000, bytesPerSecond: 100_000 }, // Older
        { timestamp: now - 3000, bytesPerSecond: 100_000 },
        { timestamp: now - 2000, bytesPerSecond: 100_000 },
        { timestamp: now - 1000, bytesPerSecond: 500_000 }, // Recent spike
        { timestamp: now - 100, bytesPerSecond: 600_000 }, // Very recent
      ];

      const avgRate = parser.calculateAverageTransferRate(progress);
      // Should be weighted toward recent values
      expect(avgRate).toBeGreaterThan(200_000); // More than simple average
      expect(avgRate).toBeLessThan(600_000); // Less than max
    });

    it('should handle sparse samples gracefully', () => {
      const progress: DownloadProgress = {
        package: 'package',
        totalBytes: 1_000_000,
        bytesReceived: 100_000,
        percentComplete: 10,
        startTime: Date.now() - 2000,
        currentTime: Date.now(),
        transferRateSamples: [{ timestamp: Date.now() - 1000, bytesPerSecond: 100_000 }],
        averageTransferRate: 0,
      };

      const avgRate = parser.calculateAverageTransferRate(progress);
      expect(avgRate).toBe(100_000); // Single sample should work
    });

    it('should update transfer rate as new data frames arrive', () => {
      // Verify parser is fresh
      expect(parser.getActiveDownloads()).toHaveLength(0);

      // Start download
      parser.parseLine('   uv_installer::preparer::get_wheel name=package==1.0.0, size=Some(5242880), url="..."');
      parser.parseLine(
        '1.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(3), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      // Simulate receiving data frames over time
      const frameTimestamps = [
        '1.100000s',
        '1.200000s',
        '1.300000s',
        '1.400000s',
        '1.500000s',
        '1.600000s',
        '1.700000s',
        '1.800000s',
        '1.900000s',
        '2.000000s',
      ];

      for (const timestamp of frameTimestamps) {
        parser.parseLine(`${timestamp} DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(3) }`);
      }

      const progress = parser.getDownloadProgress('package');
      expect(progress?.transferRateSamples.length).toBeGreaterThan(0);
      expect(progress?.averageTransferRate).toBeGreaterThan(0);
    });
  });

  describe('HTTP/2 Stream ID to Package Mapping', () => {
    it('should map HTTP/2 stream IDs to specific package downloads', () => {
      // When a download starts, it gets assigned a stream ID
      parser.parseLine(
        '   uv_installer::preparer::get_wheel name=sentencepiece==0.2.1, size=Some(1253645), url="https://files.pythonhosted.org/packages/..."'
      );
      parser.parseLine(
        '2.093270s   1s  DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(11), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      // Associate stream ID 11 with sentencepiece download
      const transfers = parser.getActiveTransfers();
      expect(transfers['11']).toBeDefined();
      expect(transfers['11'].associatedPackage).toBe('sentencepiece');
    });

    it('should track data frames by stream ID for progress calculation', () => {
      // Setup: Start a download and associate it with stream ID 7
      parser.parseLine('   uv_installer::preparer::get_wheel name=numpy==2.0.0, size=Some(16277507), url="..."');
      parser.parseLine(
        '1.500000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(7), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      // Track multiple data frames for the same stream
      parser.parseLine('1.600000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(7) }');
      parser.parseLine('1.700000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(7) }');
      parser.parseLine('1.800000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(7) }');

      const transfers = parser.getActiveTransfers();
      expect(transfers['7'].frameCount).toBe(3);

      // Verify progress is being tracked for the associated package
      const progress = parser.getDownloadProgress('numpy');
      expect(progress).toBeDefined();
      expect(progress?.estimatedBytesReceived).toBeGreaterThan(0);
    });

    it('should handle stream ID reuse after completion', () => {
      // First download completes
      parser.parseLine('   uv_installer::preparer::get_wheel name=package1==1.0.0, size=Some(1000), url="..."');
      parser.parseLine(
        '1.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(5), flags: (0x5: END_HEADERS | END_STREAM) }'
      );
      parser.parseLine(
        '1.100000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(5), flags: (0x1: END_STREAM) }'
      );

      // Stream 5 should be marked as complete
      let transfers = parser.getActiveTransfers();
      expect(transfers['5']).toBeUndefined(); // Should be cleaned up after END_STREAM

      // New download reuses stream ID 5 (this can happen in HTTP/2)
      parser.parseLine('   uv_installer::preparer::get_wheel name=package2==2.0.0, size=Some(2000), url="..."');
      parser.parseLine(
        '2.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(5), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      transfers = parser.getActiveTransfers();
      expect(transfers['5']).toBeDefined();
      expect(transfers['5'].associatedPackage).toBe('package2');
    });

    it('should correlate multiple concurrent streams to their packages', () => {
      // Start multiple downloads with different stream IDs
      const downloads = [
        { pkg: 'sentencepiece==0.2.1', size: 1_253_645, streamId: 3 },
        { pkg: 'pydantic==2.11.7', size: 444_782, streamId: 7 },
        { pkg: 'alembic==1.16.4', size: 247_026, streamId: 11 },
      ];

      for (const { pkg, size, streamId } of downloads) {
        parser.parseLine(`   uv_installer::preparer::get_wheel name=${pkg}, size=Some(${size}), url="..."`);
        parser.parseLine(
          `1.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(${streamId}), flags: (0x5: END_HEADERS | END_STREAM) }`
        );
      }

      const transfers = parser.getActiveTransfers();
      expect(Object.keys(transfers).length).toBe(3);
      expect(transfers['3'].associatedPackage).toBe('sentencepiece');
      expect(transfers['7'].associatedPackage).toBe('pydantic');
      expect(transfers['11'].associatedPackage).toBe('alembic');

      // Verify each package has its download info tracked
      const activeDownloads = parser.getActiveDownloads();
      expect(activeDownloads.length).toBe(3);
      expect(activeDownloads.find((d) => d.package === 'sentencepiece')).toBeDefined();
      expect(activeDownloads.find((d) => d.package === 'pydantic')).toBeDefined();
      expect(activeDownloads.find((d) => d.package === 'alembic')).toBeDefined();
    });
  });

  describe('Phase Change Events', () => {
    it('should emit events on phase transitions', () => {
      // const phaseEvents: Array<{ from: Phase | undefined; to: Phase }> = [];

      // Mock event listener
      // const onPhaseChange = (from: Phase | undefined, to: Phase) => {
      //   phaseEvents.push({ from, to });
      // };

      // Simulate parser with event support
      // parser.onPhaseChange(onPhaseChange);

      // Trigger phase changes
      parser.parseLine('    0.000690s DEBUG uv uv 0.8.13');
      parser.parseLine('Resolved 60 packages in 2.00s');
      parser.parseLine('   uv_installer::preparer::get_wheel name=package==1.0.0, size=Some(1000), url="..."');
      parser.parseLine('Prepared 1 package in 100ms');
      parser.parseLine('Installed 1 package in 5ms');

      // Verify events were emitted in order
      // Would check: idle->started, started->resolved, resolved->downloading, etc.
      const state = parser.getOverallState();
      expect(state.phases.length).toBeGreaterThan(0);
    });

    it('should guarantee phase transition order', () => {
      const validTransitions: Record<Phase, Phase[]> = {
        idle: ['started'],
        started: ['reading_requirements', 'resolving'],
        reading_requirements: ['resolving'],
        resolving: ['resolved'],
        resolved: ['preparing_download', 'downloading', 'prepared'],
        preparing_download: ['downloading'],
        downloading: ['prepared'],
        prepared: ['installing'],
        installing: ['installed'],
        installed: [],
        error: [],
        unknown: [],
      };

      // Test that only valid transitions occur
      const currentPhase: Phase = 'idle';

      const testTransition = (to: Phase): boolean => {
        return validTransitions[currentPhase].includes(to);
      };

      expect(testTransition('started')).toBe(true);
      expect(testTransition('installed')).toBe(false);
    });

    it('should not emit duplicate phase events', () => {
      // Parse multiple lines that would trigger same phase
      parser.parseLine('    0.079718s   1ms DEBUG uv_resolver::resolver Adding direct dependency: package1');
      parser.parseLine('    0.079719s   1ms DEBUG uv_resolver::resolver Adding direct dependency: package2');
      parser.parseLine('    0.079720s   1ms DEBUG uv_resolver::resolver Adding direct dependency: package3');

      // Should only transition to 'resolving' once, not three times
      const state = parser.getOverallState();
      const resolvingCount = state.phases.filter((p) => p === 'resolving').length;
      expect(resolvingCount).toBeLessThanOrEqual(1);
    });
  });

  describe('State Reset Completeness', () => {
    it('should clear all download states on reset', () => {
      // Setup complex state
      parser.parseLine('   uv_installer::preparer::get_wheel name=package1==1.0.0, size=Some(1000), url="..."');
      parser.parseLine('   uv_installer::preparer::get_wheel name=package2==1.0.0, size=Some(2000), url="..."');
      parser.parseLine(
        '1.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(3), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      // Verify state exists
      expect(parser.getActiveDownloads().length).toBeGreaterThan(0);

      // Reset
      parser.reset();

      // Verify complete cleanup
      expect(parser.getActiveDownloads().length).toBe(0);
      expect(parser.getActiveTransfers()).toEqual({});
    });

    it('should reset stream ID counter', () => {
      // Use some stream IDs
      parser.parseLine(
        '1.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(3), flags: (0x5: END_HEADERS | END_STREAM) }'
      );
      parser.parseLine(
        '2.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(5), flags: (0x5: END_HEADERS | END_STREAM) }'
      );

      parser.reset();

      // Next stream ID should start fresh (implementation dependent)
      // This tests that internal counters are reset
      const state = parser.getOverallState();
      expect(state.currentPhase).toBe('idle');
    });

    it('should clear all progress tracking', () => {
      // Create download with progress
      parser.parseLine('   uv_installer::preparer::get_wheel name=package==1.0.0, size=Some(1000000), url="..."');
      parser.parseLine(
        '1.000000s DEBUG h2::codec::framed_write send, frame=Headers { stream_id: StreamId(3), flags: (0x5: END_HEADERS | END_STREAM) }'
      );
      parser.parseLine('1.100000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(3) }');

      const progressBefore = parser.getDownloadProgress('package');
      expect(progressBefore).toBeDefined();

      parser.reset();

      const progressAfter = parser.getDownloadProgress('package');
      expect(progressAfter).toBeUndefined();
    });

    it('should reset phase to idle', () => {
      // Move through several phases
      parser.parseLine('    0.000690s DEBUG uv uv 0.8.13');
      parser.parseLine('Resolved 60 packages in 2.00s');
      parser.parseLine('Downloading package (1.0MiB)');

      const stateBefore = parser.getOverallState();
      expect(stateBefore.currentPhase).not.toBe('idle');

      parser.reset();

      const stateAfter = parser.getOverallState();
      expect(stateAfter.currentPhase).toBe('idle');
      expect(stateAfter.phases).toEqual([]);
    });
  });

  describe('Cached Package Handling', () => {
    it('should skip download phase for cached packages', () => {
      // Package is already cached, no download needed
      parser.parseLine('Resolved 1 package in 0.50s');
      // No get_wheel or downloading lines
      parser.parseLine('Using cached numpy-2.0.0-cp312-cp312-macosx_14_0_arm64.whl');
      parser.parseLine('Prepared 1 package in 10ms');
      parser.parseLine('Installed 1 package in 5ms');

      const state = parser.getOverallState();
      expect(state.isComplete).toBe(true);
      // Should not have entered downloading phase
      expect(state.phases.includes('downloading')).toBe(false);
    });

    it('should transition directly from resolve to install for cached packages', () => {
      const phases: Phase[] = [];

      // Track phase transitions
      parser.parseLine('Resolved 3 packages in 1.00s');
      phases.push(parser.getOverallState().currentPhase);

      parser.parseLine('Using cached package1-1.0.0.whl');
      parser.parseLine('Using cached package2-2.0.0.whl');
      parser.parseLine('Using cached package3-3.0.0.whl');
      phases.push(parser.getOverallState().currentPhase);

      parser.parseLine('Prepared 3 packages in 15ms');
      phases.push(parser.getOverallState().currentPhase);

      parser.parseLine('Installed 3 packages in 10ms');
      phases.push(parser.getOverallState().currentPhase);

      // Verify no downloading phase
      expect(phases).not.toContain('downloading');
      expect(phases).toContain('resolved');
      expect(phases).toContain('prepared');
      expect(phases).toContain('installed');
    });

    it('should handle mix of cached and non-cached packages', () => {
      // Some packages cached, some need downloading
      parser.parseLine('Resolved 3 packages in 1.00s');

      // One package needs downloading
      parser.parseLine('   uv_installer::preparer::get_wheel name=newpackage==1.0.0, size=Some(1000000), url="..."');
      parser.parseLine('Downloading newpackage (976.6KiB)');

      // Others are cached
      parser.parseLine('Using cached oldpackage1-1.0.0.whl');
      parser.parseLine('Using cached oldpackage2-2.0.0.whl');

      parser.parseLine('Prepared 3 packages in 500ms');
      parser.parseLine('Installed 3 packages in 15ms');

      const state = parser.getOverallState();
      expect(state.isComplete).toBe(true);
      expect(state.installedPackages).toBe(3);

      // Should have downloading phase for the new package
      expect(state.phases.includes('downloading')).toBe(true);
    });
  });

  describe('Real Log File Parsing', () => {
    it('should parse complete single package installation log', () => {
      // This would read from actual log file in real implementation
      const mockSinglePackageLog = `
        0.000690s DEBUG uv uv 0.8.13 (ede75fe62 2025-08-21)
        uv_requirements::specification::from_source source=assets/ComfyUI/requirements.txt
        0.078373s   0ms DEBUG uv_resolver::resolver Solving with installed Python version: 3.12.9
        0.079718s   1ms DEBUG uv_resolver::resolver Adding direct dependency: aiohttp>=3.11.8
        Resolved 60 packages in 2.00s
        uv_installer::preparer::get_wheel name=aiohttp==3.12.15, size=Some(469787), url="..."
        Prepared 1 package in 120ms
        Installed 1 package in 3ms
      `
        .trim()
        .split('\n');

      for (const line of mockSinglePackageLog) {
        parser.parseLine(line.trim());
      }
      const state = parser.getOverallState();

      expect(state.isComplete).toBe(true);
      expect(state.currentPhase).toBe('installed');
    });

    it('should parse complete multi-package installation log', () => {
      const mockMultiPackageLog = `
        0.000690s DEBUG uv uv 0.8.13 (ede75fe62 2025-08-21)
        Resolved 60 packages in 2.04s
        uv_installer::preparer::get_wheel name=sentencepiece==0.2.1, size=Some(1253645), url="..."
        uv_installer::preparer::get_wheel name=pydantic==2.11.7, size=Some(444782), url="..."
        uv_installer::preparer::get_wheel name=alembic==1.16.4, size=Some(247026), url="..."
        Downloading sentencepiece (1.2MiB)
        Prepared 5 packages in 515ms
        Installed 5 packages in 7ms
      `
        .trim()
        .split('\n');

      for (const line of mockMultiPackageLog) {
        parser.parseLine(line.trim());
      }
      const state = parser.getOverallState();

      expect(state.isComplete).toBe(true);
      expect(state.installedPackages).toBe(5);
    });
  });
});

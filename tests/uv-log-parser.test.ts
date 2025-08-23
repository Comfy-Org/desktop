/**
 * Test suite for UV pip install log parser
 * 
 * This test suite validates the parsing and interpretation of uv pip install trace logs
 * to extract meaningful status information about the installation process.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UvLogParser, DownloadProgress } from '../src/uvLogParser';

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
      expect(status.resolutionTime).toBe(2.00);
      expect(status.message).toBe('Resolved 60 packages in 2.00s');
    });
  });

  describe('Download Phase', () => {
    it('should detect when package download is being prepared', () => {
      const logLine = '   uv_installer::preparer::get_wheel name=aiohttp==3.12.15, size=Some(469787), url="https://files.pythonhosted.org/packages/3a/1d/aiohttp-3.12.15-cp312-cp312-macosx_11_0_arm64.whl"';
      const status = parser.parseLine(logLine);
      
      expect(status.phase).toBe('preparing_download');
      expect(status.currentPackage).toBe('aiohttp');
      expect(status.packageVersion).toBe('3.12.15');
      expect(status.packageSize).toBe(469787);
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
        '   uv_installer::preparer::get_wheel name=alembic==1.16.4, size=Some(247026), url="..."'
      ];
      
      lines.forEach(line => parser.parseLine(line));
      const downloads = parser.getActiveDownloads();
      
      expect(downloads).toHaveLength(3);
      expect(downloads[0].package).toBe('sentencepiece');
      expect(downloads[0].version).toBe('0.2.1');
      expect(downloads[0].totalBytes).toBe(1253645);
      
      expect(downloads[1].package).toBe('pydantic');
      expect(downloads[1].version).toBe('2.11.7');
      expect(downloads[1].totalBytes).toBe(444782);
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
        '2.155123s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15) }'
      ];
      
      lines.forEach(line => parser.parseLine(line));
      const transfers = parser.getActiveTransfers();
      
      expect(transfers).toHaveProperty('15');
      expect(transfers).toHaveProperty('13');
      expect(transfers['15'].frameCount).toBe(2);
      expect(transfers['13'].frameCount).toBe(1);
    });

    it('should detect when a stream completes', () => {
      const logLine = '2.603342s   2s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(11), flags: (0x1: END_STREAM) }';
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
      const startTime = Date.now();
      for (let i = 0; i < 100; i++) {
        parser.parseLine(`${startTime + i * 100}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }`);
      }
      
      const progress = parser.getDownloadProgress('numpy');
      
      expect(progress).toBeDefined();
      expect(progress!.package).toBe('numpy');
      expect(progress!.totalBytes).toBe(10485760);
      expect(progress!.estimatedBytesReceived).toBeGreaterThan(0);
      expect(progress!.percentComplete).toBeGreaterThanOrEqual(0);
      expect(progress!.percentComplete).toBeLessThanOrEqual(100);
    });

    it('should calculate transfer rate over sliding window', () => {
      const progress: DownloadProgress = {
        package: 'test-package',
        totalBytes: 1048576, // 1MB
        bytesReceived: 524288, // 512KB
        percentComplete: 50,
        startTime: Date.now() - 5000, // Started 5 seconds ago
        currentTime: Date.now(),
        transferRateSamples: [
          { timestamp: Date.now() - 5000, bytesPerSecond: 50000 },
          { timestamp: Date.now() - 4000, bytesPerSecond: 100000 },
          { timestamp: Date.now() - 3000, bytesPerSecond: 150000 },
          { timestamp: Date.now() - 2000, bytesPerSecond: 120000 },
          { timestamp: Date.now() - 1000, bytesPerSecond: 104857 }, // ~100KB/s
        ]
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
        'Installed 1 package in 3ms'
      ];
      
      lines.forEach(line => parser.parseLine(line));
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
      `.trim().split('\n');
      
      mockSinglePackageLog.forEach(line => parser.parseLine(line.trim()));
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
      `.trim().split('\n');
      
      mockMultiPackageLog.forEach(line => parser.parseLine(line.trim()));
      const state = parser.getOverallState();
      
      expect(state.isComplete).toBe(true);
      expect(state.installedPackages).toBe(5);
    });
  });
});
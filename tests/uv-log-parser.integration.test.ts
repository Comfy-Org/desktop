/**
 * Integration tests for UV log parser with real log data
 * 
 * These tests validate the parser against actual uv log output patterns
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { UvLogParser, UvStatus, Phase } from '../src/uvLogParser';

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
        { time: 200, line: '    0.078373s   0ms DEBUG uv_resolver::resolver Solving with installed Python version: 3.12.9' },
        { time: 2000, line: 'Resolved 60 packages in 2.00s' },
        { time: 2100, line: '   uv_installer::preparer::get_wheel name=numpy==2.0.0, size=Some(16277507), url="https://..."' },
        { time: 2200, line: 'Downloading numpy (15.5MiB)' },
        { time: 2300, line: '2.147564s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15) }' },
        { time: 2400, line: '2.155123s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15) }' },
        { time: 2500, line: '2.161986s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15) }' },
        { time: 5000, line: '2.603342s   2s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15), flags: (0x1: END_STREAM) }' },
        { time: 5100, line: 'Prepared 1 package in 3000ms' },
        { time: 5200, line: 'Installed 1 package in 10ms' }
      ];
      
      logStream.forEach(({ line }) => {
        const status = parser.parseLine(line);
        if (status.phase !== 'unknown') {
          statusUpdates.push(status);
        }
      });
      
      // Verify the progression of phases
      const phases = statusUpdates.map(s => s.phase);
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
      
      logLines.forEach(line => parser.parseLine(line));
      
      const downloads = parser.getActiveDownloads();
      expect(downloads).toHaveLength(3);
      expect(downloads.map(d => d.package)).toEqual(['package1', 'package2', 'package3']);
      expect(downloads.map(d => d.totalBytes)).toEqual([1000000, 2000000, 3000000]);
      
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
        const timestamp = 2000 + (i * frameInterval);
        parser.parseLine(`${timestamp}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }`);
      }
      
      const progress = parser.getDownloadProgress('tensorflow');
      expect(progress).toBeDefined();
      expect(progress!.package).toBe('tensorflow');
      expect(progress!.totalBytes).toBe(104857600);
      expect(progress!.percentComplete).toBeGreaterThan(0);
      expect(progress!.transferRateSamples.length).toBeGreaterThan(0);
    });

    it('should calculate smoothed transfer rate', () => {
      // Setup download with known progress
      parser.parseLine('   uv_installer::preparer::get_wheel name=pytorch==2.0.0, size=Some(52428800), url="..."'); // 50MB
      parser.parseLine('Downloading pytorch (50.0MiB)');
      
      // Simulate variable transfer rates
      const samples = [
        { time: 1000, frames: 5 },   // Slow start
        { time: 2000, frames: 10 },  // Speed up
        { time: 3000, frames: 15 },  // Peak speed
        { time: 4000, frames: 12 },  // Slight slowdown
        { time: 5000, frames: 13 },  // Stabilize
      ];
      
      samples.forEach(({ time, frames }) => {
        for (let i = 0; i < frames; i++) {
          parser.parseLine(`${time}ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }`);
        }
      });
      
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
      const scipyDownload = downloads.find(d => d.package === 'scipy');
      expect(scipyDownload?.status).toBe('failed');
    });

    it('should handle cached packages (no download needed)', () => {
      const logLines = [
        'Resolved 3 packages in 0.50s',
        '    0.571802s 489ms DEBUG uv_resolver::candidate_selector Found installed version of numpy==2.0.0 that satisfies *',
        '    0.571829s 493ms DEBUG uv_resolver::resolver Selecting: numpy==2.0.0 [installed] (installed)',
        'Installed 0 packages in 0ms'
      ];
      
      logLines.forEach(line => parser.parseLine(line));
      
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
        'Installed 5 packages in 7ms'
      ];
      
      perfLog.forEach(line => parser.parseLine(line));
      
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
      
      variations.forEach(line => {
        parser.reset();
        const status = parser.parseLine(line);
        expect(status.phase).toBe('started');
        expect(status.uvVersion).toMatch(/\d+\.\d+/);
      });
    });

    it('should handle different package size formats', () => {
      const sizeFormats = [
        { line: 'Downloading small-pkg (125B)', expected: '125B' },
        { line: 'Downloading medium-pkg (45.6KiB)', expected: '45.6KiB' },
        { line: 'Downloading large-pkg (1.2MiB)', expected: '1.2MiB' },
        { line: 'Downloading huge-pkg (2.5GiB)', expected: '2.5GiB' },
      ];
      
      sizeFormats.forEach(({ line, expected }) => {
        const status = parser.parseLine(line);
        expect(status.packageSizeFormatted).toBe(expected);
      });
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
        'Installed 1 package in 5ms'
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
        'installed'
      ];
      
      completeFlow.forEach((line, index) => {
        const status = parser.parseLine(line);
        if (status.phase !== 'unknown') {
          expect(status.phase).toBe(expectedPhases[index]);
        }
      });
      
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
        'Installed 1 package in 5ms'
      ];
      
      logSequence.forEach(line => {
        const status = parser.parseLine(line);
        if (status.phase !== 'unknown') {
          phases.push(status.phase);
        }
      });
      
      // Verify no regression from 'prepared' back to 'resolving'
      const preparedIndex = phases.indexOf('prepared');
      const resolvingAfter = phases.slice(preparedIndex).indexOf('resolving');
      expect(resolvingAfter).toBe(-1);
    });
  });
});
/**
 * Test suite for VirtualEnvironment UV log parser integration
 *
 * This test verifies that the UvLogParser is properly integrated
 * with the VirtualEnvironment class for pip install commands.
 */
import { describe, expect, it, vi } from 'vitest';

import { UvLogParser, type UvStatus } from '../../src/uvLogParser';
import type { ProcessCallbacks } from '../../src/virtualEnvironment';

describe('VirtualEnvironment UV Parser Integration', () => {
  describe('ProcessCallbacks with UV parsing', () => {
    it('should parse UV pip install output', () => {
      const parser = new UvLogParser();
      const statuses: UvStatus[] = [];

      // Sample UV pip install output
      const sampleOutput = [
        '    0.000690s DEBUG uv uv 0.8.13 (ede75fe62 2025-08-21)',
        'Resolved 60 packages in 2.00s',
        '   uv_installer::preparer::get_wheel name=numpy==2.0.0, size=Some(16277507), url="https://files.pythonhosted.org/packages/..."',
        'Downloading numpy (15.5MiB)',
        '2.147564s   1s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15) }',
        '2.603342s   2s  DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(15), flags: (0x1: END_STREAM) }',
        'Prepared 1 package in 3000ms',
        'Installed 1 package in 10ms',
      ];

      // Simulate parsing lines
      for (const line of sampleOutput) {
        const status = parser.parseLine(line);
        if (status.phase !== 'unknown') {
          statuses.push(status);
        }
      }

      // Verify phases were detected correctly
      const phases = statuses.map((s) => s.phase);
      expect(phases).toContain('started');
      expect(phases).toContain('resolved');
      expect(phases).toContain('preparing_download');
      expect(phases).toContain('downloading');
      expect(phases).toContain('prepared');
      expect(phases).toContain('installed');

      // Verify final state
      const state = parser.getOverallState();
      expect(state.isComplete).toBe(true);
      expect(state.totalPackages).toBe(60);
      expect(state.installedPackages).toBe(1);
    });

    it('should track multiple package downloads', () => {
      const parser = new UvLogParser();
      const statuses: UvStatus[] = [];

      const multiPackageOutput = [
        'Resolved 3 packages in 1.50s',
        '   uv_installer::preparer::get_wheel name=package1==1.0.0, size=Some(1000000), url="https://..."',
        'Downloading package1 (976.6KiB)',
        '2.100000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1), flags: (0x1: END_STREAM) }',
        '   uv_installer::preparer::get_wheel name=package2==2.0.0, size=Some(2000000), url="https://..."',
        'Downloading package2 (1.9MiB)',
        '2.200000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(3), flags: (0x1: END_STREAM) }',
        '   uv_installer::preparer::get_wheel name=package3==3.0.0, size=Some(3000000), url="https://..."',
        'Downloading package3 (2.9MiB)',
        '2.300000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(5), flags: (0x1: END_STREAM) }',
        'Prepared 3 packages in 500ms',
        'Installed 3 packages in 15ms',
      ];

      for (const line of multiPackageOutput) {
        const status = parser.parseLine(line);
        if (status.phase !== 'unknown') {
          statuses.push(status);
        }
      }

      // Verify phases: preparing_download (from get_wheel) and downloading (from Downloading message)
      const preparingStatuses = statuses.filter((s) => s.phase === 'preparing_download');
      const downloadStatuses = statuses.filter((s) => s.phase === 'downloading');

      // We get 3 preparing_download from get_wheel
      expect(preparingStatuses).toHaveLength(3);
      // We get 6 downloading phases: 3 from "Downloading" messages and 3 from HTTP/2 data frames
      expect(downloadStatuses).toHaveLength(6);

      // Check unique packages were downloaded (filter out undefined from HTTP/2 frames)
      const downloadedPackages = [
        ...new Set(downloadStatuses.map((s) => s.currentPackage).filter((p) => p !== undefined)),
      ];
      expect(downloadedPackages).toEqual(['package1', 'package2', 'package3']);

      const downloads = parser.getActiveDownloads();
      expect(downloads).toHaveLength(0); // All should be completed after END_STREAM

      const state = parser.getOverallState();
      expect(state.installedPackages).toBe(3);
    });

    it('should handle error conditions', () => {
      const parser = new UvLogParser();
      const statuses: UvStatus[] = [];

      const errorOutput = [
        '    0.000690s DEBUG uv uv 0.8.13',
        'Resolved 1 package in 0.50s',
        '   uv_installer::preparer::get_wheel name=badpackage==1.0.0, size=Some(1000), url="https://..."',
        'Downloading badpackage (1.0KiB)',
        'ERROR: Connection reset by peer',
      ];

      for (const line of errorOutput) {
        const status = parser.parseLine(line);
        statuses.push(status);
      }

      // Verify error was detected
      const errorStatus = statuses.find((s) => s.phase === 'error');
      expect(errorStatus).toBeDefined();
      expect(errorStatus?.error).toContain('Connection reset by peer');

      // Verify downloads were marked as failed
      const downloads = parser.getActiveDownloads();
      const failedDownload = downloads.find((d) => d.package === 'badpackage');
      expect(failedDownload?.status).toBe('failed');
    });

    it('should provide download progress estimation', () => {
      const parser = new UvLogParser();

      // Setup a download
      parser.parseLine('   uv_installer::preparer::get_wheel name=tensorflow==2.16.0, size=Some(104857600), url="..."');
      parser.parseLine('Downloading tensorflow (100.0MiB)');

      // Simulate receiving data frames
      for (let i = 0; i < 10; i++) {
        const timestamp = (2 + i * 0.1).toFixed(6);
        parser.parseLine(`${timestamp}s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }`);
      }

      const progress = parser.getDownloadProgress('tensorflow');
      expect(progress).toBeDefined();
      expect(progress?.totalBytes).toBe(104_857_600);
      expect(progress?.percentComplete).toBeGreaterThan(0);
      expect(progress?.percentComplete).toBeLessThanOrEqual(100);
      expect(progress?.transferRateSamples.length).toBeGreaterThan(0);
    });
  });

  describe('Mock ProcessCallbacks', () => {
    it('should call onUvStatus callback when parsing UV output', () => {
      const onStdout = vi.fn();
      const onUvStatus = vi.fn();

      const callbacks: ProcessCallbacks = {
        onStdout,
        onUvStatus,
      };

      // Simulate what runUvCommandAsync would do
      const parser = new UvLogParser();
      const testLine = 'Resolved 10 packages in 1.50s';

      // Call stdout callback
      callbacks.onStdout?.(testLine);

      // Parse and call UV status callback
      const status = parser.parseLine(testLine);
      callbacks.onUvStatus?.(status);

      // Verify callbacks were called
      expect(onStdout).toHaveBeenCalledWith(testLine);
      expect(onUvStatus).toHaveBeenCalled();

      const calledStatus = onUvStatus.mock.calls[0][0];
      expect(calledStatus.phase).toBe('resolved');
      expect(calledStatus.totalPackages).toBe(10);
    });

    it('should pass progress fields through callbacks', () => {
      const onUvStatus = vi.fn();
      const callbacks: ProcessCallbacks = { onUvStatus };

      const parser = new UvLogParser();

      // Simulate a complete download sequence
      const lines = [
        'Resolved 3 packages in 1.00s',
        '   uv_installer::preparer::get_wheel name=numpy==2.0.0, size=Some(16277507), url="https://..."',
        'Downloading numpy (15.5MiB)',
        '2.100000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }',
        '2.200000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1) }',
        '2.300000s DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1), flags: (0x1: END_STREAM) }',
        'Installed 3 packages in 100ms',
      ];

      for (const line of lines) {
        const status = parser.parseLine(line);
        if (status.phase !== 'unknown') {
          callbacks.onUvStatus?.(status);
        }
      }

      // Check that progress fields were passed
      const calls = onUvStatus.mock.calls;

      // Resolved phase should have totalPackages
      const resolvedCall = calls.find((c) => c[0].phase === 'resolved');
      expect(resolvedCall).toBeDefined();
      expect(resolvedCall![0].totalPackages).toBe(3);

      // Downloading phase should have progress fields
      const downloadingCall = calls.find((c) => c[0].phase === 'downloading');
      expect(downloadingCall).toBeDefined();
      expect(downloadingCall![0].currentPackage).toBe('numpy');
      expect(downloadingCall![0].totalPackages).toBe(3);
      expect(downloadingCall![0].downloadProgress).toBeDefined();

      // HTTP/2 frames should update progress
      const frameCall = calls.find((c) => c[0].streamId && !c[0].streamCompleted);
      if (frameCall) {
        expect(frameCall[0].downloadProgress).toBeDefined();
        expect(frameCall[0].totalPackages).toBe(3);
      }

      // END_STREAM should show 100% completion
      const endStreamCall = calls.find((c) => c[0].streamCompleted === true);
      expect(endStreamCall).toBeDefined();
      expect(endStreamCall![0].downloadProgress).toBe(100);

      // Installed phase should be complete
      const installedCall = calls.find((c) => c[0].phase === 'installed');
      expect(installedCall).toBeDefined();
      expect(installedCall![0].isComplete).toBe(true);
      expect(installedCall![0].totalPackages).toBe(3);
      expect(installedCall![0].installedPackages).toBe(3);
    });
  });
});

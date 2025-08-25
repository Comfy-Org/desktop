import { beforeEach, describe, expect, it } from 'vitest';

import { UvLogParser } from '../../src/uvLogParser';

describe('UvLogParser - Multi-package Download Tracking', () => {
  let parser: UvLogParser;

  beforeEach(() => {
    parser = new UvLogParser();
  });

  it('should completely ignore "Downloading" informational lines', () => {
    // These are just informational lines that should be ignored completely
    let status = parser.parseLine('Downloading torch-2.5.1-cp312-cp312-macosx_11_0_arm64.whl (63.4 MB)');

    // Status should have empty message and no package info
    expect(status.message).toBe('');
    expect(status.currentPackage).toBeUndefined();
    expect(status.totalBytes).toBeUndefined();
    expect(status.downloadedBytes).toBeUndefined();

    status = parser.parseLine('Downloading numpy-1.26.4-cp312-cp312-macosx_11_0_arm64.whl (14.1 MB)');

    // Still should have empty message and no package info
    expect(status.message).toBe('');
    expect(status.currentPackage).toBeUndefined();

    // Should not have created any downloads
    const torchProgress = parser.getDownloadProgress('torch');
    const numpyProgress = parser.getDownloadProgress('numpy');

    expect(torchProgress).toBeUndefined();
    expect(numpyProgress).toBeUndefined();

    expect(status.completedDownloads).toBeUndefined();
  });

  it('should only create downloads from get_wheel HTTP/2 requests', () => {
    // Real download starts with get_wheel
    parser.parseLine(
      '  uv_installer::preparer::get_wheel name=torch==2.5.1, size=Some(66492975), url="https://files.pythonhosted.org/packages/torch-2.5.1-cp312.whl"'
    );

    // Now we should have a torch download
    const torchProgress = parser.getDownloadProgress('torch');
    expect(torchProgress).toBeDefined();
    expect(torchProgress?.totalBytes).toBe(66_492_975);
    expect(torchProgress?.bytesReceived).toBe(0);
  });

  it('should track completed downloads separately from installed packages', () => {
    // Set up downloads for torch and numpy
    let status = parser.parseLine(
      '  uv_installer::preparer::get_wheel name=torch==2.5.1, size=Some(66492975), url="https://files.pythonhosted.org/packages/torch-2.5.1.whl"'
    );

    status = parser.parseLine(
      '  uv_installer::preparer::get_wheel name=numpy==1.26.4, size=Some(14795386), url="https://files.pythonhosted.org/packages/numpy-1.26.4.whl"'
    );

    // Initially, no downloads are complete
    expect(status.completedDownloads).toBe(0);

    // Simulate torch download completion
    // Need to establish stream associations first
    parser.parseLine('  ↪ https://files.pythonhosted.org/packages/torch-2.5.1.whl');
    parser.parseLine('    stream: 1');
    // Use the actual format from logs
    status = parser.parseLine(
      '0.1s 10ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1), flags: (0x1: END_STREAM) }'
    );

    // Now torch should be complete
    expect(status.completedDownloads).toBe(1);

    // Simulate numpy download completion
    parser.parseLine('  ↪ https://files.pythonhosted.org/packages/numpy-1.26.4.whl');
    parser.parseLine('    stream: 3');
    status = parser.parseLine(
      '0.2s 20ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(3), flags: (0x1: END_STREAM) }'
    );

    // Both downloads should be complete
    expect(status.completedDownloads).toBe(2);
  });

  it('should handle cached packages (no get_wheel) correctly', () => {
    // Simulating the UV log output where a package is cached
    let status = parser.parseLine('Downloading numpy-1.26.4-cp312-cp312-macosx_11_0_arm64.whl (14.1 MB)');
    // No get_wheel line follows for cached packages

    // numpy should not be in downloads
    const numpyProgress = parser.getDownloadProgress('numpy');
    expect(numpyProgress).toBeUndefined();

    // Start actual download for torch
    status = parser.parseLine(
      '  uv_installer::preparer::get_wheel name=torch==2.5.1, size=Some(66492975), url="https://files.pythonhosted.org/packages/torch-2.5.1.whl"'
    );

    // Only torch should be tracked
    const torchProgress = parser.getDownloadProgress('torch');
    expect(torchProgress).toBeDefined();

    expect(status.completedDownloads).toBe(0); // No downloads complete yet
  });

  it('should update completedDownloads count when END_STREAM is received', () => {
    // Start multiple downloads
    let status = parser.parseLine(
      '  uv_installer::preparer::get_wheel name=torch==2.5.1, size=Some(100000), url="https://files.pythonhosted.org/packages/torch-2.5.1.whl"'
    );

    status = parser.parseLine(
      '  uv_installer::preparer::get_wheel name=torchvision==0.20.1, size=Some(200000), url="https://files.pythonhosted.org/packages/torchvision-0.20.1.whl"'
    );

    status = parser.parseLine(
      '  uv_installer::preparer::get_wheel name=torchaudio==2.5.1, size=Some(300000), url="https://files.pythonhosted.org/packages/torchaudio-2.5.1.whl"'
    );

    // Initially no downloads complete
    expect(status.completedDownloads).toBe(0);

    // Need to establish stream associations
    parser.parseLine('  ↪ https://files.pythonhosted.org/packages/torch-2.5.1.whl');
    parser.parseLine('    stream: 1');

    // Complete torch download
    status = parser.parseLine(
      '0.1s 10ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(1), flags: (0x1: END_STREAM) }'
    );
    expect(status.completedDownloads).toBe(1);

    parser.parseLine('  ↪ https://files.pythonhosted.org/packages/torchvision-0.20.1.whl');
    parser.parseLine('    stream: 3');

    // Complete torchvision download
    status = parser.parseLine(
      '0.2s 20ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(3), flags: (0x1: END_STREAM) }'
    );
    expect(status.completedDownloads).toBe(2);

    parser.parseLine('  ↪ https://files.pythonhosted.org/packages/torchaudio-2.5.1.whl');
    parser.parseLine('    stream: 5');

    // Complete torchaudio download
    status = parser.parseLine(
      '0.3s 30ms DEBUG h2::codec::framed_read received, frame=Data { stream_id: StreamId(5), flags: (0x1: END_STREAM) }'
    );
    expect(status.completedDownloads).toBe(3);
  });
});

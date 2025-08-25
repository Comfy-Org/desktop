import { beforeEach, describe, expect, it } from 'vitest';

import { UvLogParser } from '../../src/uvLogParser';

describe('UvLogParser - Multi-package Download Tracking', () => {
  let parser: UvLogParser;

  beforeEach(() => {
    parser = new UvLogParser();
  });

  it('should not create download entries from "Downloading" informational lines', () => {
    // These are just informational lines, not actual download starts
    let status = parser.parseLine('Downloading torch-2.5.1-cp312-cp312-macosx_11_0_arm64.whl (63.4 MB)');
    status = parser.parseLine('Downloading numpy-1.26.4-cp312-cp312-macosx_11_0_arm64.whl (14.1 MB)');

    // Should not have created any downloads yet
    const torchProgress = parser.getDownloadProgress('torch');
    const numpyProgress = parser.getDownloadProgress('numpy');

    expect(torchProgress).toBeUndefined();
    expect(numpyProgress).toBeUndefined();

    expect(status.completedDownloads).toBe(0);
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
    parser.parseLine('    frame: DATA stream=1 len=1000000 flags=');
    parser.parseLine('    bytes_received: 66492975');
    status = parser.parseLine('    frame: DATA stream=1 len=0 flags=END_STREAM');

    // Now torch should be complete
    expect(status.completedDownloads).toBe(1);

    // Simulate numpy download completion
    parser.parseLine('  ↪ https://files.pythonhosted.org/packages/numpy-1.26.4.whl');
    parser.parseLine('    stream: 3');
    parser.parseLine('    frame: DATA stream=3 len=500000 flags=');
    parser.parseLine('    bytes_received: 14795386');
    status = parser.parseLine('    frame: DATA stream=3 len=0 flags=END_STREAM');

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
    status = parser.parseLine('    frame: DATA stream=1 len=0 flags=END_STREAM');
    expect(status.completedDownloads).toBe(1);

    parser.parseLine('  ↪ https://files.pythonhosted.org/packages/torchvision-0.20.1.whl');
    parser.parseLine('    stream: 3');

    // Complete torchvision download
    status = parser.parseLine('    frame: DATA stream=3 len=0 flags=END_STREAM');
    expect(status.completedDownloads).toBe(2);

    parser.parseLine('  ↪ https://files.pythonhosted.org/packages/torchaudio-2.5.1.whl');
    parser.parseLine('    stream: 5');

    // Complete torchaudio download
    status = parser.parseLine('    frame: DATA stream=5 len=0 flags=END_STREAM');
    expect(status.completedDownloads).toBe(3);
  });
});

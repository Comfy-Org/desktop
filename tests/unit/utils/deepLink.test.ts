import { describe, expect, it } from 'vitest';

import { findDeepLinkUrl, parseDeepLinkUrl } from '@/utils/deepLink';

describe('parseDeepLinkUrl', () => {
  it('should parse a valid comfy://open URL with file path', () => {
    const result = parseDeepLinkUrl('comfy://open?file=/path/to/workflow.json');
    expect(result).toEqual({ action: 'open', filePath: '/path/to/workflow.json' });
  });

  it('should decode an encoded file path', () => {
    const result = parseDeepLinkUrl('comfy://open?file=%2Ftmp%2Fmy%20workflow.json');
    expect(result).toEqual({ action: 'open', filePath: '/tmp/my workflow.json' });
  });

  it('should decode a Windows-style encoded path', () => {
    const result = parseDeepLinkUrl('comfy://open?file=C%3A%5CUsers%5Ctest%5Cworkflow.json');
    expect(result).toEqual({ action: 'open', filePath: String.raw`C:\Users\test\workflow.json` });
  });

  it('should return null for an invalid protocol', () => {
    expect(parseDeepLinkUrl('http://open?file=/path')).toBeNull();
  });

  it('should return null when action is missing', () => {
    expect(parseDeepLinkUrl('comfy://?file=/path')).toBeNull();
  });

  it('should return null when file param is missing', () => {
    expect(parseDeepLinkUrl('comfy://open')).toBeNull();
  });

  it('should return null when file param is empty', () => {
    expect(parseDeepLinkUrl('comfy://open?file=')).toBeNull();
  });

  it('should return null for a malformed URL', () => {
    expect(parseDeepLinkUrl('not-a-url')).toBeNull();
  });

  it('should allow non-.json file extensions', () => {
    const result = parseDeepLinkUrl('comfy://open?file=/path/to/file.png');
    expect(result).toEqual({ action: 'open', filePath: '/path/to/file.png' });
  });

  it('should extract non-open actions', () => {
    const result = parseDeepLinkUrl('comfy://install?file=/path/to/node.json');
    expect(result).toEqual({ action: 'install', filePath: '/path/to/node.json' });
  });

  it('should normalize action to lowercase', () => {
    const result = parseDeepLinkUrl('comfy://OPEN?file=/path/to/workflow.json');
    expect(result).toEqual({ action: 'open', filePath: '/path/to/workflow.json' });
  });

  it('should handle mixed-case action', () => {
    const result = parseDeepLinkUrl('comfy://Open?file=/path/to/workflow.json');
    expect(result).toEqual({ action: 'open', filePath: '/path/to/workflow.json' });
  });
});

describe('findDeepLinkUrl', () => {
  it('should find a comfy:// URL in an args array', () => {
    const result = findDeepLinkUrl(['electron', '--flag', 'comfy://open?file=/test.json']);
    expect(result).toBe('comfy://open?file=/test.json');
  });

  it('should return undefined when no deep link URL is present', () => {
    expect(findDeepLinkUrl(['electron', '--flag'])).toBeUndefined();
  });

  it('should return the first match if multiple are present', () => {
    const result = findDeepLinkUrl(['comfy://open?file=/first.json', 'comfy://open?file=/second.json']);
    expect(result).toBe('comfy://open?file=/first.json');
  });

  it('should return undefined for an empty array', () => {
    expect(findDeepLinkUrl([])).toBeUndefined();
  });
});

import { describe, expect, it } from 'vitest';

import { isValidComfyProtocolUrl, parseComfyProtocolUrl } from '@/protocol/protocolParser';

describe('Protocol Parser', () => {
  describe('parseComfyProtocolUrl', () => {
    it('should parse install-custom-node URLs correctly', () => {
      const result = parseComfyProtocolUrl('comfy://install-custom-node/some-node-id');
      expect(result).toEqual({
        action: 'install-custom-node',
        params: { nodeId: 'some-node-id' },
        originalUrl: 'comfy://install-custom-node/some-node-id',
      });
    });

    it('should parse import URLs correctly', () => {
      const result = parseComfyProtocolUrl('comfy://import/workflow-id');
      expect(result).toEqual({
        action: 'import',
        params: { nodeId: 'workflow-id' },
        originalUrl: 'comfy://import/workflow-id',
      });
    });

    it('should handle URLs with complex node IDs', () => {
      const result = parseComfyProtocolUrl('comfy://install-custom-node/my-custom-node-123');
      expect(result).toEqual({
        action: 'install-custom-node',
        params: { nodeId: 'my-custom-node-123' },
        originalUrl: 'comfy://install-custom-node/my-custom-node-123',
      });
    });

    it('should return null for non-comfy protocol URLs', () => {
      expect(parseComfyProtocolUrl('http://example.com')).toBeNull();
      expect(parseComfyProtocolUrl('https://example.com')).toBeNull();
      expect(parseComfyProtocolUrl('ftp://example.com')).toBeNull();
    });

    it('should return null for invalid comfy URLs', () => {
      expect(parseComfyProtocolUrl('comfy://')).toBeNull();
      expect(parseComfyProtocolUrl('comfy://invalid')).toBeNull();
      expect(parseComfyProtocolUrl('comfy://install-custom-node')).toBeNull();
      expect(parseComfyProtocolUrl('comfy://install-custom-node/')).toBeNull();
      expect(parseComfyProtocolUrl('comfy://unknown-action/param')).toBeNull();
    });

    it('should return null for URLs with too many parameters', () => {
      expect(parseComfyProtocolUrl('comfy://install-custom-node/node1/node2')).toBeNull();
      expect(parseComfyProtocolUrl('comfy://import/node1/node2/node3')).toBeNull();
    });

    it('should return null for malformed URLs', () => {
      expect(parseComfyProtocolUrl('not-a-url')).toBeNull();
      expect(parseComfyProtocolUrl('')).toBeNull();
      expect(parseComfyProtocolUrl('://invalid')).toBeNull();
    });

    it('should handle URL encoded node IDs', () => {
      const result = parseComfyProtocolUrl('comfy://install-custom-node/node%20with%20spaces');
      expect(result).toEqual({
        action: 'install-custom-node',
        params: { nodeId: 'node with spaces' },
        originalUrl: 'comfy://install-custom-node/node%20with%20spaces',
      });
    });
  });

  describe('isValidComfyProtocolUrl', () => {
    it('should return true for valid comfy URLs', () => {
      expect(isValidComfyProtocolUrl('comfy://install-custom-node/node-id')).toBe(true);
      expect(isValidComfyProtocolUrl('comfy://import/workflow-id')).toBe(true);
    });

    it('should return false for invalid URLs', () => {
      expect(isValidComfyProtocolUrl('http://example.com')).toBe(false);
      expect(isValidComfyProtocolUrl('comfy://')).toBe(false);
      expect(isValidComfyProtocolUrl('comfy://invalid')).toBe(false);
      expect(isValidComfyProtocolUrl('not-a-url')).toBe(false);
    });
  });
});

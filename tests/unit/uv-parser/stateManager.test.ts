/**
 * Unit tests for UV State Manager
 */
import { describe, expect, it } from 'vitest';

import { UVStateManager } from '@/uv-parser/stateManager';

describe('UVStateManager', () => {
  describe('Type Safety', () => {
    it('should return correctly typed arrays, not never[]', () => {
      const manager = new UVStateManager();

      // These should all return properly typed arrays, NOT never[]
      const warnings = manager.getOutputsByType('warning');
      const errors = manager.getOutputsByType('error');
      const packages = manager.getOutputsByType('changed_package');
      const summaries = manager.getOutputsByType('resolution_summary');

      // Verify the types are not never[] by checking they're arrays
      expect(warnings).toBeInstanceOf(Array);
      expect(errors).toBeInstanceOf(Array);
      expect(packages).toBeInstanceOf(Array);
      expect(summaries).toBeInstanceOf(Array);

      // TypeScript compile-time check: if these were never[], accessing properties would fail
      const testWarning: { message: string; type: string } | undefined = warnings[0];
      const testError: { message: string; type: string } | undefined = errors[0];
      const testPackage: { operation: string; package: object } | undefined = packages[0];
      const testSummary: { packageCount: number; duration: string } | undefined = summaries[0];

      // These assignments prove the types are correct (would fail if never[])
      expect(testWarning).toBeUndefined(); // Empty array, but correct type
      expect(testError).toBeUndefined();
      expect(testPackage).toBeUndefined();
      expect(testSummary).toBeUndefined();
    });

    it('should properly infer types from getOutputsByType without type assertions', () => {
      const manager = new UVStateManager();

      // Process some test lines to populate outputs
      manager.processLine('ERROR uv::test Error message');
      manager.processLine('WARN uv::test Warning message');
      manager.processLine(' + numpy==1.2.3');

      // Test that errors are properly typed as UvError[]
      const errors = manager.getErrors();
      expect(errors).toBeInstanceOf(Array);
      if (errors.length > 0) {
        // TypeScript should know these properties exist without type assertions
        expect(errors[0].type).toBe('error');
        expect(errors[0].message).toBeDefined();
      }

      // Test that warnings are properly typed as UvWarning[]
      const warnings = manager.getWarnings();
      expect(warnings).toBeInstanceOf(Array);
      if (warnings.length > 0) {
        expect(warnings[0].type).toBe('warning');
        expect(warnings[0].message).toBeDefined();
      }

      // Test that changed packages are properly typed as ChangedPackage[]
      const changedPackages = manager.getOutputsByType('changed_package');
      expect(changedPackages).toBeInstanceOf(Array);
      if (changedPackages.length > 0) {
        // TypeScript knows the type without needing <ChangedPackage> generic
        expect(changedPackages[0].operation).toMatch(/^[+-]$/);
        expect(changedPackages[0].package).toBeDefined();
        expect(changedPackages[0].package.name).toBeDefined();
      }

      // Test that resolution summaries are properly typed
      manager.processLine('Resolved 42 packages in 1.5s');
      const resolutionSummaries = manager.getOutputsByType('resolution_summary');
      if (resolutionSummaries.length > 0) {
        expect(typeof resolutionSummaries[0].packageCount).toBe('number');
        expect(typeof resolutionSummaries[0].duration).toBe('string');
      }

      // Test that log messages are properly typed
      const logMessages = manager.getOutputsByType('log_message');
      if (logMessages.length > 0) {
        expect(logMessages[0].level).toBeDefined();
        expect(logMessages[0].module).toBeDefined();
        expect(logMessages[0].message).toBeDefined();
      }

      // Test that getSummary returns properly typed values without assertions
      const summary = manager.getSummary();
      expect(summary.stage).toBeDefined();
      expect(summary.complete).toBeDefined();
      expect(summary.hasErrors).toBeDefined();
      expect(summary.installedPackages).toBeInstanceOf(Array);
      expect(summary.removedPackages).toBeInstanceOf(Array);
    });

    it('should handle empty state correctly', () => {
      const manager = new UVStateManager();

      // All methods should return properly typed empty arrays
      expect(manager.getErrors()).toEqual([]);
      expect(manager.getWarnings()).toEqual([]);
      expect(manager.getOutputsByType('changed_package')).toEqual([]);
      expect(manager.getOutputsByType('resolution_summary')).toEqual([]);

      // Summary should have proper types even when empty
      const summary = manager.getSummary();
      expect(summary.resolution).toBeUndefined();
      expect(summary.installation).toBeUndefined();
      expect(summary.preparation).toBeUndefined();
      expect(summary.installedPackages).toEqual([]);
      expect(summary.removedPackages).toEqual([]);
    });
  });

  describe('Output Processing', () => {
    it('should correctly parse and categorize different output types', () => {
      const manager = new UVStateManager();

      // Test various output types
      manager.processLine('    0.001s DEBUG uv uv 0.5.0');
      manager.processLine('Resolved 10 packages in 500ms');
      manager.processLine('Downloading numpy (15.3 MiB)');
      manager.processLine(' + pandas==2.0.0');
      manager.processLine(' - old-package==1.0.0');

      // Check that outputs are properly categorized
      const logMessages = manager.getOutputsByType('log_message');
      expect(logMessages.length).toBeGreaterThan(0);

      const resolutionSummaries = manager.getOutputsByType('resolution_summary');
      expect(resolutionSummaries.length).toBeGreaterThan(0);

      const changedPackages = manager.getOutputsByType('changed_package');
      expect(changedPackages.length).toBe(2);
      expect(changedPackages[0].operation).toBe('+');
      expect(changedPackages[1].operation).toBe('-');
    });
  });

  describe('State Transitions', () => {
    it('should track stage progression', () => {
      const manager = new UVStateManager();

      expect(manager.getCurrentStage()).toBe('initializing');

      // Simulate UV startup
      manager.processLine('    0.001s DEBUG uv uv 0.5.0');
      expect(manager.getCurrentStage()).toBe('startup');

      // Simulate resolution
      manager.processLine('    0.002s DEBUG uv_resolver Solving with installed Python version 3.11.0');
      expect(manager.getCurrentStage()).toBe('resolution_setup');

      // Simulate resolution complete
      manager.processLine('Resolved 5 packages in 1s');
      expect(manager.getCurrentStage()).toBe('resolution_summary');
    });
  });
});

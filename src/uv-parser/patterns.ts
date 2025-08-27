/**
 * UV Output Pattern Definitions
 *
 * Regular expressions and matchers for identifying UV output line types.
 * Each pattern is designed to work independently without requiring context.
 */

/**
 * Pattern for timestamped log lines
 * Example: "    0.000172s DEBUG uv uv 0.7.9 (13a86a23b 2025-05-30)"
 */
export const TIMESTAMP_LOG_PATTERN = /^\s*([\d.]+)s(?:\s+([\d.]+)ms)?\s+(DEBUG|INFO|WARN|ERROR)\s+([\w:]+)\s+(.*)$/;

/**
 * Pattern for module trace lines (indented, no timestamp)
 * Example: " uv_requirements::specification::from_source source=Named(...)"
 */
export const MODULE_TRACE_PATTERN = /^\s+(uv\w*:{2}[\w:]+)\s*(.*)$/;

/**
 * Pattern for resolution summary
 * Example: "Resolved 12 packages in 379ms"
 */
export const RESOLVED_PATTERN = /^Resolved\s+(\d+)\s+packages?\s+in\s+([\d.]+\w+)$/;

/**
 * Pattern for preparation summary
 * Example: "Prepared 3 packages in 21.72s"
 */
export const PREPARED_PATTERN = /^Prepared\s+(\d+)\s+packages?\s+in\s+([\d.]+\w+)$/;

/**
 * Pattern for installation summary
 * Example: "Installed 3 packages in 215ms"
 */
export const INSTALLED_PATTERN = /^Installed\s+(\d+)\s+packages?\s+in\s+([\d.]+\w+)$/;

/**
 * Pattern for audited packages
 * Example: "Audited 3 packages in 18ms"
 */
export const AUDITED_PATTERN = /^Audited\s+(\d+)\s+packages?\s+in\s+([\d.]+\w+)$/;

/**
 * Pattern for downloading status with size
 * Example: "Downloading torch (70.2MiB)"
 */
export const DOWNLOADING_WITH_SIZE_PATTERN = /^Downloading\s+([\w-]+)\s+\(([\d.]+\s*\w+)\)$/;

/**
 * Pattern for simple downloading status
 * Example: " Downloading numpy"
 */
export const DOWNLOADING_SIMPLE_PATTERN = /^\s+Downloading\s+([\w-]+)$/;

/**
 * Pattern for final package list
 * Example: " + numpy==2.3.2" or " - old-package==1.0.0"
 */
export const CHANGED_PACKAGE_PATTERN = /^\s+([+-])\s+([\w-]+)==([\d.]+(?:\w+[\d.]*)*)$/;

/**
 * Pattern for installation planning messages
 * Example: "    0.041008s DEBUG uv_installer::plan Registry requirement already cached: scipy==1.16.1"
 */
export const INSTALL_PLAN_CACHED = /Registry requirement already cached:\s+([\w-]+)==([\d.]+)/;
export const INSTALL_PLAN_INSTALLED = /Requirement already installed:\s+([\w-]+)==([\d.]+)/;
export const INSTALL_PLAN_UNCACHED = /Identified uncached distribution:\s+([\w-]+)==([\d.]+)/;
export const INSTALL_PLAN_UNNECESSARY = /Unnecessary package:\s+([\w-]+)==([\d.]+)/;

/**
 * Pattern for cache events
 * Example: "Found fresh response for: https://pypi.org/simple/torch/"
 */
export const CACHE_HIT_PATTERN = /Found fresh response for:\s+(https?:\/\/\S+)/;
export const CACHE_MISS_PATTERN = /No cache entry for:\s+(https?:\/\/\S+)/;
export const CACHE_WRITE_PATTERN = /new_cache file=(\S+)/;

/**
 * Pattern for resolution events
 * Example: "add_decision: Id::<PubGrubPackage>(1) @ 2.3.2 without checking dependencies"
 */
export const RESOLUTION_DECISION_PATTERN = /add_decision:\s+Id::<PubGrubPackage>\((\d+)\)\s+@\s+([\d.]+)\s+(.*)/;

/**
 * Pattern for selecting packages
 * Example: "Selecting: torch==2.8.0 [satisfies torch] (built)"
 */
export const SELECTING_PATTERN = /Selecting:\s+([\w-]+)==([\d.]+)\s+\[([^\]]+)]\s+\(([^)]+)\)/;

/**
 * Pattern for searching packages
 * Example: "Searching for a compatible version of numpy (>2.0)"
 */
export const SEARCHING_PATTERN = /Searching for a compatible version of\s+([\w-]+)\s*(\([^)]*\))?/;

/**
 * Pattern for HTTP/2 frames
 * Example: "received, frame=Headers { stream_id: StreamId(1), flags: (0x4: END_HEADERS) }"
 */
export const HTTP2_FRAME_PATTERN =
  /received,\s+frame=(\w+)\s+{\s*stream_id:\s+StreamId\((\d+)\)(?:,\s*flags:\s*\(([^)]+)\))?\s*}/;

/**
 * Pattern for warning messages
 * Example: "WARN uv::commands::pip Skipping torch==2.8.0+cpu..."
 */
export const WARNING_PATTERN = /^\s*[\d.]+s.*\s+WARN\s+[\w:]+\s+(.*)$/;

/**
 * Pattern for error messages
 * Example: "ERROR uv::commands::pip Failed to install package"
 */
export const ERROR_PATTERN = /^\s*[\d.]+s.*\s+ERROR\s+[\w:]+\s+(.*)$/;

/**
 * Pattern for UV version line
 * Example: "uv 0.7.9 (13a86a23b 2025-05-30)"
 */
export const UV_VERSION_PATTERN = /uv\s+([\d.]+)\s+\(([\da-f]+)\s+([\d-]+)\)/;

/**
 * Extract package name from PyPI URL
 */
export function extractPackageFromUrl(url: string): string | undefined {
  const match = url.match(/\/simple\/([\w-]+)\/?/);
  return match?.[1];
}

/**
 * Parse timestamp to seconds
 */
export function parseTimestamp(timestamp: string): number {
  return Number.parseFloat(timestamp.replaceAll(/[^\d.]/g, ''));
}

/**
 * Identify module category from full module path
 */
export function getModuleCategory(modulePath: string): string {
  if (modulePath.startsWith('uv_resolver')) return 'uv_resolver';
  if (modulePath.startsWith('uv_client')) return 'uv_client';
  if (modulePath.startsWith('uv_installer')) return 'uv_installer';
  if (modulePath.startsWith('uv_distribution')) return 'uv_distribution';
  if (modulePath.startsWith('uv_requirements')) return 'uv';
  if (modulePath.startsWith('uv_python')) return 'uv';
  if (modulePath.startsWith('uv')) return 'uv';
  if (modulePath.startsWith('pubgrub')) return 'pubgrub';
  if (modulePath.startsWith('h2')) return 'h2';
  if (modulePath.startsWith('reqwest')) return 'reqwest';
  return 'other';
}

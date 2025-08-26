/**
 * UV State Manager Types
 *
 * Stage definitions for tracking UV installation progress.
 * Used by state managers that consume the stateless parser output.
 */

/**
 * Represents the distinct stages of a UV pip install process.
 * UV progresses through these stages sequentially, though some may be skipped
 * based on cache state and installation requirements.
 */
export type UVStage =
  /** Default state before any output has been processed. */
  | 'initializing'
  /** UV startup and environment discovery phase. */
  | 'startup'
  /** Dependency resolution setup with PubGrub solver. */
  | 'resolution_setup'
  /** Cache checking and metadata retrieval (from cache or network). */
  | 'cache_checking'
  /** Dependency resolution using PubGrub algorithm. */
  | 'dependency_resolution'
  /** Resolution complete summary. */
  | 'resolution_summary'
  /** Planning what needs to be installed/removed. */
  | 'installation_planning'
  /** Downloading packages from network (skipped if all cached). */
  | 'package_downloads'
  /** Package preparation complete (only after downloads). */
  | 'package_preparation'
  /** Installing packages to environment. */
  | 'installation'
  /** Final summary with list of installed packages. */
  | 'final_summary'
  /** Process complete. */
  | 'complete';

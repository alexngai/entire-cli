/**
 * Path Classification Helpers
 *
 * Utilities for classifying and normalizing paths within the Sessionlog system.
 *
 * Ported from Go: paths/paths.go
 */

import * as path from 'node:path';

/** All possible sessionlog directory locations (relative paths) */
const SESSIONLOG_DIRS = ['.sessionlog', '.swarm/sessionlog'];

/**
 * Returns true if the path is part of Sessionlog's infrastructure
 * (i.e., inside a `.sessionlog/` or `.swarm/sessionlog/` directory).
 */
export function isInfrastructurePath(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/');
  return SESSIONLOG_DIRS.some(
    (dir) => normalized === dir || normalized.startsWith(dir + '/'),
  );
}

/**
 * Converts an absolute path to a repository-relative path.
 * Returns empty string if the path is outside the working directory.
 */
export function toRelativePath(absPath: string, cwd: string): string {
  if (!path.isAbsolute(absPath)) return absPath;

  const relPath = path.relative(cwd, absPath);
  if (relPath.startsWith('..')) return '';

  return relPath;
}

/**
 * Normalizes a path for storage: converts to CWD-relative when inside the
 * working directory, keeps absolute otherwise.
 *
 * Examples (cwd = /Users/alex/project):
 *   /Users/alex/project/src/app.ts  →  src/app.ts
 *   /Users/alex/.claude/plans/p.md  →  /Users/alex/.claude/plans/p.md  (outside CWD)
 *   src/app.ts                      →  src/app.ts  (already relative)
 */
export function normalizeStoredPath(filePath: string, cwd: string): string {
  if (!path.isAbsolute(filePath)) return filePath;
  const relPath = path.relative(cwd, filePath);
  if (relPath.startsWith('..')) return filePath;
  return relPath;
}

/**
 * Returns the absolute path for a relative path within the repository.
 * If the path is already absolute, it is returned as-is.
 */
export function absPath(relPath: string, repoRoot: string): string {
  if (path.isAbsolute(relPath)) return relPath;
  return path.join(repoRoot, relPath);
}

/**
 * Extract the session ID from a transcript file path.
 * Expects paths like `/path/to/<sessionID>.jsonl` or `/path/to/<sessionID>.json`.
 */
export function extractSessionIDFromPath(transcriptPath: string): string {
  const base = path.basename(transcriptPath);
  // Remove extension (.jsonl, .json, etc.)
  const dotIndex = base.indexOf('.');
  return dotIndex > 0 ? base.slice(0, dotIndex) : base;
}

/**
 * Returns the session metadata directory path for a given session ID.
 */
export function sessionMetadataDir(metadataRoot: string, sessionID: string): string {
  return path.join(metadataRoot, 'sessions', sessionID);
}

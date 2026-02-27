/**
 * Content Overlap Detection
 *
 * Determines whether a commit contains session-related work by comparing
 * file content (not just filenames) against the shadow branch. This enables
 * accurate detection of the "reverted and replaced" scenario.
 */

import { gitSafe } from '../git-operations.js';

// ============================================================================
// Content Overlap
// ============================================================================

/**
 * Check if any file in filesTouched overlaps with the committed content.
 * Uses content-aware comparison to detect the "reverted and replaced" scenario.
 *
 * For modified files (exist in parent), always counts as overlap.
 * For new files, requires content match against shadow branch.
 */
export async function filesOverlapWithContent(
  shadowBranchName: string,
  headCommitHash: string,
  parentCommitHash: string | null,
  filesTouched: string[],
  cwd?: string,
): Promise<boolean> {
  if (filesTouched.length === 0) return false;

  for (const filePath of filesTouched) {
    // Get file from HEAD (committed content)
    const headContent = await gitSafe(['show', `${headCommitHash}:${filePath}`], { cwd });
    if (headContent === null) {
      // File not in HEAD commit - check if it's a deletion
      if (parentCommitHash) {
        const parentContent = await gitSafe(['show', `${parentCommitHash}:${filePath}`], { cwd });
        if (parentContent !== null) {
          // File existed in parent but not in HEAD = deletion = overlap
          return true;
        }
      }
      continue;
    }

    // Check if this is a modified file (exists in parent) or new file
    let isModified = false;
    if (parentCommitHash) {
      const parentContent = await gitSafe(['show', `${parentCommitHash}:${filePath}`], { cwd });
      isModified = parentContent !== null;
    }

    // Modified files always count as overlap
    if (isModified) return true;

    // For new files, check content against shadow branch
    const shadowContent = await gitSafe(['show', `refs/heads/${shadowBranchName}:${filePath}`], {
      cwd,
    });
    if (shadowContent === null) continue;

    // Compare by hashing - get blob hashes
    const headHash = await gitSafe(['rev-parse', `${headCommitHash}:${filePath}`], { cwd });
    const shadowHash = await gitSafe(['rev-parse', `refs/heads/${shadowBranchName}:${filePath}`], {
      cwd,
    });

    if (headHash !== null && shadowHash !== null && headHash.trim() === shadowHash.trim()) {
      return true;
    }

    // Check for significant content overlap if hashes differ
    if (headContent && shadowContent && hasSignificantContentOverlap(headContent, shadowContent)) {
      return true;
    }
  }

  return false;
}

/**
 * Check if any staged file overlaps with filesTouched using content comparison.
 */
export async function stagedFilesOverlapWithContent(
  shadowBranchName: string,
  stagedFiles: string[],
  filesTouched: string[],
  cwd?: string,
): Promise<boolean> {
  const touchedSet = new Set(filesTouched);

  for (const stagedPath of stagedFiles) {
    if (!touchedSet.has(stagedPath)) continue;

    // Check if modified (exists in HEAD) or new
    const headContent = await gitSafe(['show', `HEAD:${stagedPath}`], { cwd });
    const isModified = headContent !== null;

    if (isModified) return true;

    // For new files, compare staged content with shadow
    const shadowContent = await gitSafe(['show', `refs/heads/${shadowBranchName}:${stagedPath}`], {
      cwd,
    });
    if (shadowContent === null) continue;

    // Get staged content
    const stagedContent = await gitSafe(['show', `:${stagedPath}`], { cwd });
    if (stagedContent === null) continue;

    // Compare hashes
    const stagedHash = await gitSafe(['rev-parse', `:${stagedPath}`], { cwd });
    const shadowHash = await gitSafe(
      ['rev-parse', `refs/heads/${shadowBranchName}:${stagedPath}`],
      { cwd },
    );

    if (stagedHash && shadowHash && stagedHash.trim() === shadowHash.trim()) {
      return true;
    }

    // Check significant overlap
    if (hasSignificantContentOverlap(stagedContent, shadowContent)) {
      return true;
    }
  }

  return false;
}

/**
 * Return files from filesTouched that still have uncommitted agent changes.
 */
export async function filesWithRemainingAgentChanges(
  shadowBranchName: string,
  headCommitHash: string,
  filesTouched: string[],
  committedFiles: Set<string>,
  cwd?: string,
): Promise<string[]> {
  const remaining: string[] = [];

  for (const filePath of filesTouched) {
    if (!committedFiles.has(filePath)) {
      remaining.push(filePath);
      continue;
    }

    // File was committed - check if committed content matches shadow
    const commitHash = await gitSafe(['rev-parse', `${headCommitHash}:${filePath}`], { cwd });
    const shadowHash = await gitSafe(['rev-parse', `refs/heads/${shadowBranchName}:${filePath}`], {
      cwd,
    });

    if (commitHash === null || shadowHash === null) continue;
    if (commitHash.trim() === shadowHash.trim()) continue;

    // Content differs - check if working tree is clean for this file
    const workingDiff = await gitSafe(['diff', '--name-only', 'HEAD', '--', filePath], { cwd });
    if (workingDiff !== null && workingDiff.trim() === '') {
      // Working tree is clean - user intentionally wrote different content
      continue;
    }

    remaining.push(filePath);
  }

  return remaining;
}

// ============================================================================
// Content Overlap Helpers
// ============================================================================

/**
 * Check if two file contents share significant lines.
 * Distinguishes partial staging from "reverted and replaced".
 */
export function hasSignificantContentOverlap(
  stagedContent: string,
  shadowContent: string,
): boolean {
  const shadowLines = extractSignificantLines(shadowContent);
  const stagedLines = extractSignificantLines(stagedContent);

  if (shadowLines.size === 0 || stagedLines.size === 0) return false;

  const isVerySmallFile = shadowLines.size < 2 || stagedLines.size < 2;
  const requiredMatches = isVerySmallFile ? 1 : 2;

  let matchCount = 0;
  for (const line of stagedLines) {
    if (shadowLines.has(line)) {
      matchCount++;
      if (matchCount >= requiredMatches) return true;
    }
  }

  return false;
}

/**
 * Extract significant lines from content (>= 10 chars after trimming).
 * Short lines like `{`, `}`, `});` are filtered as common boilerplate.
 */
function extractSignificantLines(content: string): Set<string> {
  const lines = new Set<string>();
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (trimmed.length >= 10) {
      lines.add(trimmed);
    }
  }
  return lines;
}

/**
 * Simple filename-based overlap check (fallback).
 */
export function hasOverlappingFiles(stagedFiles: string[], filesTouched: string[]): boolean {
  const touchedSet = new Set(filesTouched);
  return stagedFiles.some((f) => touchedSet.has(f));
}

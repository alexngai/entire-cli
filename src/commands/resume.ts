/**
 * Resume Command
 *
 * Library implementation for resuming agent sessions from branches.
 * Handles branch checkout, session discovery from commit trailers,
 * and transcript restoration.
 */

import type { CheckpointID } from '../types.js';
import { git, refExists } from '../git-operations.js';
import { parseCheckpoint, parseAllSessions } from '../utils/trailers.js';

// ============================================================================
// Types
// ============================================================================

export interface ResumeInfo {
  branchName: string;
  sessionID: string;
  sessionIDs: string[];
  checkpointID: CheckpointID | null;
  resumeCommand: string;
  commitSHA: string;
  commitMessage: string;
  needsReset: boolean;
  resetTargetSHA?: string;
}

export interface ResumeOptions {
  cwd?: string;
  force?: boolean;
}

export interface ResumeResult {
  success: boolean;
  info?: ResumeInfo;
  error?: string;
}

// ============================================================================
// Public API
// ============================================================================

/**
 * Discover resume information for a branch without performing any actions.
 * This is useful for preview/dry-run scenarios.
 */
export async function discoverResumeInfo(
  branchName: string,
  options: ResumeOptions = {},
): Promise<ResumeResult> {
  const cwd = options.cwd;

  // Check if branch exists locally
  const localExists = await refExists(`refs/heads/${branchName}`, cwd);
  if (!localExists) {
    // Check remote
    const remoteExists = await refExists(`refs/remotes/origin/${branchName}`, cwd);
    if (!remoteExists) {
      return {
        success: false,
        error: `Branch '${branchName}' not found locally or on origin`,
      };
    }

    return {
      success: false,
      error: `Branch '${branchName}' exists on origin but not locally. Fetch it first.`,
    };
  }

  // Find the most recent commit with a checkpoint trailer
  const info = await findSessionInfo(branchName, cwd);
  if (!info) {
    return {
      success: false,
      error: `No checkpointed session found on branch '${branchName}'`,
    };
  }

  return { success: true, info };
}

/**
 * Get a list of branches that have checkpointed sessions.
 */
export async function listResumableBranches(
  options: ResumeOptions = {},
): Promise<Array<{ branch: string; sessionID: string; lastCommit: string }>> {
  const cwd = options.cwd;
  const results: Array<{ branch: string; sessionID: string; lastCommit: string }> = [];

  let branchOutput: string;
  try {
    branchOutput = await git(['branch', '--format=%(refname:short)'], { cwd });
  } catch {
    return [];
  }

  for (const branch of branchOutput.split('\n')) {
    const trimmed = branch.trim();
    if (!trimmed) continue;

    // Get the last few commits to check for checkpoint trailers
    try {
      const logOutput = await git(['log', '-10', '--format=%H', trimmed], { cwd });

      for (const sha of logOutput.split('\n')) {
        if (!sha.trim()) continue;

        const fullMessage = await git(['log', '-1', '--format=%B', sha.trim()], { cwd });

        const [cpID, hasCp] = parseCheckpoint(fullMessage);
        if (hasCp && cpID) {
          const sessionIDs = parseAllSessions(fullMessage);
          if (sessionIDs.length > 0) {
            results.push({
              branch: trimmed,
              sessionID: sessionIDs[0],
              lastCommit: sha.trim().slice(0, 7),
            });
            break; // Only report first match per branch
          }
        }
      }
    } catch {
      continue;
    }
  }

  return results;
}

// ============================================================================
// Internal Helpers
// ============================================================================

async function findSessionInfo(branchName: string, cwd?: string): Promise<ResumeInfo | null> {
  // Walk commits on the branch looking for one with a checkpoint trailer
  let logOutput: string;
  try {
    logOutput = await git(['log', '-50', '--format=%H', branchName], { cwd });
  } catch {
    return null;
  }

  const shas = logOutput.split('\n').filter(Boolean);
  for (let i = 0; i < shas.length; i++) {
    const sha = shas[i].trim();
    if (!sha) continue;

    let fullMessage: string;
    try {
      fullMessage = await git(['log', '-1', '--format=%B', sha], { cwd });
    } catch {
      continue;
    }

    const [cpID, hasCp] = parseCheckpoint(fullMessage);
    if (!hasCp || !cpID) continue;

    const sessionIDs = parseAllSessions(fullMessage);
    const message = fullMessage.split('\n')[0] ?? '';
    const needsReset = i > 0; // If not the tip commit, needs reset

    return {
      branchName,
      sessionID: sessionIDs[0] ?? '',
      sessionIDs,
      checkpointID: cpID,
      resumeCommand: '', // To be filled by consumer with agent-specific command
      commitSHA: sha,
      commitMessage: message,
      needsReset,
      resetTargetSHA: needsReset ? sha : undefined,
    };
  }

  return null;
}

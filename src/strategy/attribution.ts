/**
 * Attribution Logic
 *
 * Computes line-level attribution between agent-generated and human-edited code.
 * Uses diff-based analysis to track who wrote which lines.
 */

import type { InitialAttribution } from '../types.js';
import { countLines } from '../utils/string-utils.js';
import type { PromptAttribution } from './types.js';

// ============================================================================
// Diff-based Attribution
// ============================================================================

/**
 * Compare two strings and return line-level diff stats.
 * Returns [unchanged, added, removed] line counts.
 *
 * Uses a simple line-by-line comparison. For production-grade diffing,
 * we compare line sets since we only need counts, not actual patches.
 */
export function diffLines(
  oldContent: string,
  newContent: string,
): [unchanged: number, added: number, removed: number] {
  if (oldContent === newContent) {
    return [countLines(newContent), 0, 0];
  }
  if (oldContent === '') {
    return [0, countLines(newContent), 0];
  }
  if (newContent === '') {
    return [0, 0, countLines(oldContent)];
  }

  // Line-by-line LCS-based diff for accurate counting
  const oldLines = oldContent.split('\n');
  const newLines = newContent.split('\n');

  // Remove trailing empty string from split if content ends with newline
  if (oldLines[oldLines.length - 1] === '' && oldContent.endsWith('\n')) {
    oldLines.pop();
  }
  if (newLines[newLines.length - 1] === '' && newContent.endsWith('\n')) {
    newLines.pop();
  }

  // Build a set-based approximation for line counts
  // This is simpler than full LCS but gives good accuracy for attribution
  const oldSet = new Map<string, number>();
  for (const line of oldLines) {
    oldSet.set(line, (oldSet.get(line) ?? 0) + 1);
  }

  let unchanged = 0;
  const matchedOld = new Map<string, number>();

  for (const line of newLines) {
    const available = (oldSet.get(line) ?? 0) - (matchedOld.get(line) ?? 0);
    if (available > 0) {
      unchanged++;
      matchedOld.set(line, (matchedOld.get(line) ?? 0) + 1);
    }
  }

  const removed = oldLines.length - unchanged;
  const added = newLines.length - unchanged;

  return [unchanged, added, removed];
}

/**
 * Get all changed files between two sets of file contents.
 */
export function getAllChangedFiles(
  tree1: Map<string, string>,
  tree2: Map<string, string>,
): string[] {
  const changed = new Set<string>();

  for (const [path, hash1] of tree1) {
    const hash2 = tree2.get(path);
    if (hash2 === undefined || hash1 !== hash2) {
      changed.add(path);
    }
  }

  for (const path of tree2.keys()) {
    if (!tree1.has(path)) {
      changed.add(path);
    }
  }

  return Array.from(changed);
}

/**
 * Calculate attribution with accumulated prompt data.
 *
 * This provides more accurate attribution than tree-only comparison because
 * it captures user edits between checkpoints.
 *
 * @param baseFiles - File contents at session start
 * @param shadowFiles - File contents at last checkpoint
 * @param headFiles - File contents at commit time (HEAD)
 * @param filesTouched - Files the agent modified
 * @param promptAttributions - Per-prompt user edit tracking
 */
export function calculateAttributionWithAccumulated(
  baseFiles: Map<string, string>,
  shadowFiles: Map<string, string>,
  headFiles: Map<string, string>,
  filesTouched: string[],
  promptAttributions: PromptAttribution[],
): InitialAttribution | null {
  if (filesTouched.length === 0) return null;

  // Sum accumulated user lines from prompt attributions
  let accumulatedUserRemoved = 0;
  const accumulatedUserAddedPerFile = new Map<string, number>();

  for (const pa of promptAttributions) {
    accumulatedUserRemoved += pa.userLinesRemoved;
    for (const [filePath, added] of Object.entries(pa.userAddedPerFile)) {
      accumulatedUserAddedPerFile.set(
        filePath,
        (accumulatedUserAddedPerFile.get(filePath) ?? 0) + added,
      );
    }
  }

  // Calculate for agent-touched files
  let totalAgentAndUserWork = 0;
  let postCheckpointUserAdded = 0;
  let postCheckpointUserRemoved = 0;
  const postCheckpointUserRemovedPerFile = new Map<string, number>();

  for (const filePath of filesTouched) {
    const baseContent = baseFiles.get(filePath) ?? '';
    const shadowContent = shadowFiles.get(filePath) ?? '';
    const headContent = headFiles.get(filePath) ?? '';

    // Total work in shadow: base → shadow
    const [, workAdded] = diffLines(baseContent, shadowContent);
    totalAgentAndUserWork += workAdded;

    // Post-checkpoint user edits: shadow → head
    const [, postUserAdded, postUserRemoved] = diffLines(shadowContent, headContent);
    postCheckpointUserAdded += postUserAdded;
    postCheckpointUserRemoved += postUserRemoved;

    if (postUserRemoved > 0) {
      postCheckpointUserRemovedPerFile.set(filePath, postUserRemoved);
    }
  }

  // User edits to non-agent files
  const nonAgentFiles = getAllChangedFiles(baseFiles, headFiles);
  const touchedSet = new Set(filesTouched);
  let allUserEditsToNonAgentFiles = 0;

  for (const filePath of nonAgentFiles) {
    if (touchedSet.has(filePath)) continue;
    const baseContent = baseFiles.get(filePath) ?? '';
    const headContent = headFiles.get(filePath) ?? '';
    const [, userAdded] = diffLines(baseContent, headContent);
    allUserEditsToNonAgentFiles += userAdded;
  }

  // Separate accumulated edits by file type
  const committedNonAgentSet = new Set(nonAgentFiles.filter((f) => !touchedSet.has(f)));

  let accumulatedToAgentFiles = 0;
  let accumulatedToCommittedNonAgentFiles = 0;
  for (const [filePath, added] of accumulatedUserAddedPerFile) {
    if (touchedSet.has(filePath)) {
      accumulatedToAgentFiles += added;
    } else if (committedNonAgentSet.has(filePath)) {
      accumulatedToCommittedNonAgentFiles += added;
    }
  }

  // Agent work = (base→shadow for agent files) - (accumulated user edits to agent files)
  const totalAgentAdded = Math.max(0, totalAgentAndUserWork - accumulatedToAgentFiles);

  // Post-checkpoint edits to non-agent files
  const postToNonAgentFiles = Math.max(
    0,
    allUserEditsToNonAgentFiles - accumulatedToCommittedNonAgentFiles,
  );

  // Total user contribution
  const relevantAccumulatedUser = accumulatedToAgentFiles + accumulatedToCommittedNonAgentFiles;
  const totalUserAdded = relevantAccumulatedUser + postCheckpointUserAdded + postToNonAgentFiles;
  const totalUserRemoved = accumulatedUserRemoved + postCheckpointUserRemoved;

  // Estimate modified lines
  const totalHumanModified = Math.min(totalUserAdded, totalUserRemoved);

  // Estimate user self-modifications
  const userSelfModified = estimateUserSelfModifications(
    accumulatedUserAddedPerFile,
    postCheckpointUserRemovedPerFile,
  );

  const humanModifiedAgent = Math.max(0, totalHumanModified - userSelfModified);
  const pureUserAdded = totalUserAdded - totalHumanModified;
  const pureUserRemoved = totalUserRemoved - totalHumanModified;

  let totalCommitted = totalAgentAdded + pureUserAdded - pureUserRemoved;
  if (totalCommitted <= 0) {
    totalCommitted = Math.max(0, totalAgentAdded);
  }

  const agentLinesInCommit = Math.max(0, totalAgentAdded - pureUserRemoved - humanModifiedAgent);

  let agentPercentage = 0;
  if (totalCommitted > 0) {
    agentPercentage = (agentLinesInCommit / totalCommitted) * 100;
  }

  return {
    calculatedAt: new Date().toISOString(),
    agentLines: agentLinesInCommit,
    humanAdded: pureUserAdded,
    humanModified: totalHumanModified,
    humanRemoved: pureUserRemoved,
    totalCommitted,
    agentPercentage,
  };
}

/**
 * Estimate how many removed lines were the user's own additions.
 * Uses LIFO assumption: user removes their own recent additions first.
 */
function estimateUserSelfModifications(
  accumulatedUserAddedPerFile: Map<string, number>,
  postCheckpointUserRemovedPerFile: Map<string, number>,
): number {
  let selfModified = 0;
  for (const [filePath, removed] of postCheckpointUserRemovedPerFile) {
    const userAddedToFile = accumulatedUserAddedPerFile.get(filePath) ?? 0;
    selfModified += Math.min(removed, userAddedToFile);
  }
  return selfModified;
}

/**
 * Calculate prompt attribution at the start of a prompt.
 * Captures user edits since the last checkpoint BEFORE the agent makes changes.
 */
export function calculatePromptAttribution(
  baseFiles: Map<string, string>,
  lastCheckpointFiles: Map<string, string> | null,
  worktreeFiles: Map<string, string>,
  checkpointNumber: number,
): PromptAttribution {
  const result: PromptAttribution = {
    checkpointNumber,
    userLinesAdded: 0,
    userLinesRemoved: 0,
    agentLinesAdded: 0,
    agentLinesRemoved: 0,
    userAddedPerFile: {},
  };

  if (worktreeFiles.size === 0) return result;

  const referenceFiles = lastCheckpointFiles ?? baseFiles;

  for (const [filePath, worktreeContent] of worktreeFiles) {
    const referenceContent = referenceFiles.get(filePath) ?? '';
    const baseContent = baseFiles.get(filePath) ?? '';

    // User changes: diff(reference, worktree)
    const [, userAdded, userRemoved] = diffLines(referenceContent, worktreeContent);
    result.userLinesAdded += userAdded;
    result.userLinesRemoved += userRemoved;

    if (userAdded > 0) {
      result.userAddedPerFile[filePath] = userAdded;
    }

    // Agent lines so far: diff(base, lastCheckpoint)
    if (lastCheckpointFiles) {
      const checkpointContent = lastCheckpointFiles.get(filePath) ?? '';
      const [, agentAdded, agentRemoved] = diffLines(baseContent, checkpointContent);
      result.agentLinesAdded += agentAdded;
      result.agentLinesRemoved += agentRemoved;
    }
  }

  return result;
}

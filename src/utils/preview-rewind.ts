/**
 * Rewind Preview
 *
 * Preview what files would change when rewinding to a checkpoint.
 * Shows files that would be restored and untracked files that would be deleted.
 *
 * Ported from Go: strategy/manual_commit_rewind.go
 */

import { getHead, lsTree, getUntrackedFiles } from '../git-operations.js';
import { isInfrastructurePath } from './paths.js';

export interface RewindPreview {
  filesToRestore: string[];
  filesToDelete: string[];
}

/**
 * Preview what will happen when rewinding to the given commit.
 *
 * Returns the list of files that would be restored from the checkpoint
 * and untracked files that would be deleted.
 *
 * For logs-only rewind points, returns empty arrays since the working
 * directory is not modified.
 */
export async function previewRewind(
  commitHash: string,
  isLogsOnly: boolean,
  preservedUntrackedFiles?: string[],
  cwd?: string,
): Promise<RewindPreview> {
  // Logs-only points don't modify the working directory
  if (isLogsOnly) {
    return { filesToRestore: [], filesToDelete: [] };
  }

  // Get files in the checkpoint tree (excluding infrastructure)
  const checkpointEntries = await lsTree(commitHash, undefined, cwd);
  const checkpointFiles = new Set<string>();
  const filesToRestore: string[] = [];

  for (const entry of checkpointEntries) {
    if (!isInfrastructurePath(entry.name)) {
      checkpointFiles.add(entry.name);
      filesToRestore.push(entry.name);
    }
  }

  // Get HEAD tree to identify tracked files
  const headHash = await getHead(cwd);
  const headEntries = await lsTree(headHash, undefined, cwd);
  const trackedFiles = new Set<string>();
  for (const entry of headEntries) {
    trackedFiles.add(entry.name);
  }

  // Build set of preserved untracked files
  const preserved = new Set(preservedUntrackedFiles ?? []);

  // Find untracked files that would be deleted
  const untrackedNow = await getUntrackedFiles(cwd);
  const filesToDelete: string[] = [];

  for (const relPath of untrackedNow) {
    // Skip if file exists in the checkpoint
    if (checkpointFiles.has(relPath)) continue;
    // Skip if file is tracked in HEAD
    if (trackedFiles.has(relPath)) continue;
    // Skip if file was preserved from session start
    if (preserved.has(relPath)) continue;

    filesToDelete.push(relPath);
  }

  filesToRestore.sort();
  filesToDelete.sort();

  return { filesToRestore, filesToDelete };
}

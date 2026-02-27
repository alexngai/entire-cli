/**
 * Git Worktree Utilities
 *
 * Provides detection and identification of git worktrees.
 * Linked worktrees have `.git` as a file pointing to the main repository,
 * while the main worktree has `.git` as a directory.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';

/**
 * Get the internal git worktree identifier for the given path.
 *
 * - For the main worktree (where .git is a directory), returns empty string.
 * - For linked worktrees (where .git is a file), extracts the name from
 *   `.git/worktrees/<name>/` path. This name is stable across `git worktree move`.
 */
export async function getWorktreeID(worktreePath: string): Promise<string> {
  const gitPath = path.join(worktreePath, '.git');

  let stat: fs.Stats;
  try {
    stat = await fs.promises.stat(gitPath);
  } catch {
    throw new Error(`failed to stat .git: ${gitPath}`);
  }

  // Main worktree has .git as a directory
  if (stat.isDirectory()) {
    return '';
  }

  // Linked worktree has .git as a file with content: "gitdir: /path/to/.git/worktrees/<name>"
  const content = await fs.promises.readFile(gitPath, 'utf-8');
  const line = content.trim();

  if (!line.startsWith('gitdir: ')) {
    throw new Error(`invalid .git file format: ${line}`);
  }

  const gitdir = line.slice('gitdir: '.length);

  // Extract worktree name from path like /repo/.git/worktrees/<name>
  const marker = '.git/worktrees/';
  const idx = gitdir.indexOf(marker);
  if (idx === -1) {
    throw new Error(`unexpected gitdir format (no worktrees): ${gitdir}`);
  }

  let worktreeID = gitdir.slice(idx + marker.length);
  // Remove trailing slashes if any
  if (worktreeID.endsWith('/')) {
    worktreeID = worktreeID.slice(0, -1);
  }

  return worktreeID;
}

/**
 * Git Tree Manipulation
 *
 * Structured tree operations for building and modifying git tree objects.
 * Provides higher-level abstractions over raw `git mktree` / `git ls-tree`.
 *
 * Ported from Go: checkpoint/parse_tree.go
 */

import { lsTree, mktree, hashObject } from '../git-operations.js';

// ============================================================================
// Types
// ============================================================================

export interface TreeEntry {
  mode: string;
  type: string;
  hash: string;
  name: string;
}

export const enum MergeMode {
  /** Replace the entire subtree at the target path */
  ReplaceAll = 0,
  /** Merge into existing subtree, keeping existing entries */
  MergeKeepExisting = 1,
}

export interface TreeChange {
  path: string;
  mode: string;
  hash: string;
  deleted?: boolean;
}

// ============================================================================
// Tree Operations
// ============================================================================

/**
 * Update (or create) a subtree at a given path within a root tree.
 *
 * @param rootTree - The root tree hash (or empty string for a new tree)
 * @param subtreePath - The path to the subtree (e.g., "a3/b2c4d5e6f7")
 * @param newSubtreeHash - The hash of the new subtree to place at path
 * @param mergeMode - How to handle existing entries at the path
 * @param cwd - Working directory for git commands
 */
export async function updateSubtree(
  rootTree: string,
  subtreePath: string,
  newSubtreeHash: string,
  mergeMode: MergeMode = MergeMode.ReplaceAll,
  cwd?: string,
): Promise<string> {
  const parts = subtreePath.split('/').filter(Boolean);
  if (parts.length === 0) return newSubtreeHash;

  // Walk the tree path, collecting existing entries at each level
  return updateSubtreeRecursive(rootTree, parts, 0, newSubtreeHash, mergeMode, cwd);
}

async function updateSubtreeRecursive(
  currentTree: string,
  pathParts: string[],
  depth: number,
  newSubtreeHash: string,
  mergeMode: MergeMode,
  cwd?: string,
): Promise<string> {
  const targetName = pathParts[depth];
  const isLeaf = depth === pathParts.length - 1;

  // Get existing entries at this tree level
  let existingEntries: TreeEntry[] = [];
  if (currentTree) {
    try {
      existingEntries = await lsTree(currentTree, undefined, cwd);
    } catch {
      // Tree doesn't exist or is empty
    }
  }

  if (isLeaf) {
    let finalHash = newSubtreeHash;

    // If merge mode, combine existing and new entries
    if (mergeMode === MergeMode.MergeKeepExisting) {
      const existingEntry = existingEntries.find((e) => e.name === targetName);
      if (existingEntry && existingEntry.type === 'tree') {
        finalHash = await mergeTreesKeepExisting(existingEntry.hash, newSubtreeHash, cwd);
      }
    }

    // Replace or add the entry at this level
    const filtered = existingEntries.filter((e) => e.name !== targetName);
    filtered.push({
      mode: '040000',
      type: 'tree',
      hash: finalHash,
      name: targetName,
    });

    return mktree(filtered, cwd);
  }

  // Intermediate level: find or create the subtree
  const existingEntry = existingEntries.find((e) => e.name === targetName);
  const childTree = existingEntry?.hash ?? '';

  const updatedChildHash = await updateSubtreeRecursive(
    childTree,
    pathParts,
    depth + 1,
    newSubtreeHash,
    mergeMode,
    cwd,
  );

  const filtered = existingEntries.filter((e) => e.name !== targetName);
  filtered.push({
    mode: '040000',
    type: 'tree',
    hash: updatedChildHash,
    name: targetName,
  });

  return mktree(filtered, cwd);
}

/**
 * Merge two trees, keeping existing entries when conflicts arise.
 */
async function mergeTreesKeepExisting(
  existingTreeHash: string,
  newTreeHash: string,
  cwd?: string,
): Promise<string> {
  const existingEntries = await lsTree(existingTreeHash, undefined, cwd);
  const newEntries = await lsTree(newTreeHash, undefined, cwd);

  const existingNames = new Set(existingEntries.map((e) => e.name));
  const merged = [...existingEntries];

  for (const entry of newEntries) {
    if (!existingNames.has(entry.name)) {
      merged.push(entry);
    }
  }

  return mktree(merged, cwd);
}

/**
 * Apply a batch of file-level changes to a tree.
 * Returns the hash of the new root tree.
 */
export async function applyTreeChanges(
  rootTree: string,
  changes: TreeChange[],
  cwd?: string,
): Promise<string> {
  if (changes.length === 0) return rootTree;

  // Get existing entries
  let entries: TreeEntry[] = [];
  if (rootTree) {
    try {
      entries = await lsTree(rootTree, undefined, cwd);
    } catch {
      // Empty tree
    }
  }

  for (const change of changes) {
    if (change.deleted) {
      entries = entries.filter((e) => e.name !== change.path);
    } else {
      const existing = entries.findIndex((e) => e.name === change.path);
      const entry: TreeEntry = {
        mode: change.mode,
        type: change.mode === '040000' ? 'tree' : 'blob',
        hash: change.hash,
        name: change.path,
      };
      if (existing >= 0) {
        entries[existing] = entry;
      } else {
        entries.push(entry);
      }
    }
  }

  return mktree(entries, cwd);
}

/**
 * Create a tree from a map of file paths to content strings.
 * Useful for building trees from scratch in tests.
 */
export async function createTreeFromMap(
  files: Record<string, string>,
  cwd?: string,
): Promise<string> {
  const entries: TreeEntry[] = [];

  for (const [name, content] of Object.entries(files)) {
    const hash = await hashObject(content, cwd);
    entries.push({
      mode: '100644',
      type: 'blob',
      hash,
      name,
    });
  }

  return mktree(entries, cwd);
}

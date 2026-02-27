/**
 * Tests for Worktree Utilities
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { getWorktreeID } from '../utils/worktree.js';

describe('Worktree Utilities', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'worktree-test-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('getWorktreeID', () => {
    it('should return empty string for main worktree', async () => {
      // Main worktree has .git as a directory
      fs.mkdirSync(path.join(tmpDir, '.git'));
      const id = await getWorktreeID(tmpDir);
      expect(id).toBe('');
    });

    it('should extract worktree ID from linked worktree', async () => {
      // Linked worktree has .git as a file pointing to worktrees/<name>
      fs.writeFileSync(path.join(tmpDir, '.git'), 'gitdir: /repo/.git/worktrees/my-feature\n');
      const id = await getWorktreeID(tmpDir);
      expect(id).toBe('my-feature');
    });

    it('should handle trailing slash in gitdir', async () => {
      fs.writeFileSync(path.join(tmpDir, '.git'), 'gitdir: /repo/.git/worktrees/feature-branch/\n');
      const id = await getWorktreeID(tmpDir);
      expect(id).toBe('feature-branch');
    });

    it('should throw for missing .git', async () => {
      await expect(getWorktreeID(tmpDir)).rejects.toThrow('failed to stat .git');
    });

    it('should throw for invalid .git file format', async () => {
      fs.writeFileSync(path.join(tmpDir, '.git'), 'invalid content\n');
      await expect(getWorktreeID(tmpDir)).rejects.toThrow('invalid .git file format');
    });

    it('should throw for gitdir without worktrees path', async () => {
      fs.writeFileSync(path.join(tmpDir, '.git'), 'gitdir: /some/other/path\n');
      await expect(getWorktreeID(tmpDir)).rejects.toThrow('no worktrees');
    });
  });
});

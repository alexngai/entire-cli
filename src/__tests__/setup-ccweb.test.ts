/**
 * Tests for setup-ccweb command
 *
 * Covers: setupCcweb function — settings creation, script creation,
 * idempotency, --force overwrite, push prefix customization, prefix
 * preservation on --force, non-git-repo error, and directory creation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { setupCcweb } from '../commands/setup-ccweb.js';

// ============================================================================
// Helpers
// ============================================================================

function initRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
}

function readJSON(filePath: string): Record<string, unknown> {
  return JSON.parse(fs.readFileSync(filePath, 'utf-8'));
}

// ============================================================================
// Tests
// ============================================================================

describe('setup-ccweb', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'setup-ccweb-'));
    initRepo(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // --------------------------------------------------------------------------
  // Basic creation
  // --------------------------------------------------------------------------

  describe('fresh setup', () => {
    it('should create .claude/settings.json with SessionStart hook', async () => {
      const result = await setupCcweb({ cwd: tmpDir });

      expect(result.success).toBe(true);
      expect(result.settingsCreated).toBe(true);

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      expect(fs.existsSync(settingsPath)).toBe(true);

      const settings = readJSON(settingsPath) as {
        hooks: { SessionStart: Array<{ hooks: Array<{ type: string; command: string }> }> };
      };
      expect(settings.hooks).toBeDefined();
      expect(settings.hooks.SessionStart).toHaveLength(1);
      expect(settings.hooks.SessionStart[0].hooks[0].type).toBe('command');
      expect(settings.hooks.SessionStart[0].hooks[0].command).toBe(
        'sh .claude/scripts/setup-env.sh',
      );
    });

    it('should add bash permission for the setup script', async () => {
      await setupCcweb({ cwd: tmpDir });

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const settings = readJSON(settingsPath) as {
        permissions: { allow: string[] };
      };

      expect(settings.permissions).toBeDefined();
      expect(settings.permissions.allow).toContain('Bash(sh .claude/scripts/setup-env.sh)');
    });

    it('should create .claude/scripts/setup-env.sh', async () => {
      const result = await setupCcweb({ cwd: tmpDir });

      expect(result.success).toBe(true);
      expect(result.scriptCreated).toBe(true);

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      expect(fs.existsSync(scriptPath)).toBe(true);

      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('#!/bin/sh');
      expect(content).toContain('CLAUDE_CODE_REMOTE');
      expect(content).toContain('npm install -g sessionlog');
      expect(content).toContain('sessionlog enable --agent claude-code');
      expect(content).toContain('GITHUB_TOKEN');
      expect(content).toContain('sessionlog-ccweb-push-filter');
    });

    it('should make setup-env.sh executable', async () => {
      await setupCcweb({ cwd: tmpDir });

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      const stat = fs.statSync(scriptPath);
      // Check owner execute bit
      expect(stat.mode & 0o100).toBeTruthy();
    });

    it('should create .claude/scripts/ directory', async () => {
      await setupCcweb({ cwd: tmpDir });

      const scriptsDir = path.join(tmpDir, '.claude', 'scripts');
      expect(fs.existsSync(scriptsDir)).toBe(true);
      expect(fs.statSync(scriptsDir).isDirectory()).toBe(true);
    });

    it('should return no errors on fresh setup', async () => {
      const result = await setupCcweb({ cwd: tmpDir });

      expect(result.success).toBe(true);
      expect(result.errors).toHaveLength(0);
    });
  });

  // --------------------------------------------------------------------------
  // Default push prefixes
  // --------------------------------------------------------------------------

  describe('push prefixes', () => {
    it('should use default push prefixes (sessionlog/ claude/)', async () => {
      await setupCcweb({ cwd: tmpDir });

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('ALLOWED_PUSH_PREFIXES="sessionlog/ claude/"');
    });

    it('should use custom push prefixes when specified', async () => {
      await setupCcweb({ cwd: tmpDir, pushPrefixes: 'sessionlog/ my-prefix/ other/' });

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('ALLOWED_PUSH_PREFIXES="sessionlog/ my-prefix/ other/"');
    });

    it('should preserve user-customized prefixes on --force without explicit prefixes', async () => {
      // First setup with custom prefixes
      await setupCcweb({ cwd: tmpDir, pushPrefixes: 'custom/ special/' });

      // Force reinstall without specifying prefixes
      const result = await setupCcweb({ cwd: tmpDir, force: true });
      expect(result.scriptCreated).toBe(true);

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('ALLOWED_PUSH_PREFIXES="custom/ special/"');
    });

    it('should override preserved prefixes when --force with explicit prefixes', async () => {
      // First setup with custom prefixes
      await setupCcweb({ cwd: tmpDir, pushPrefixes: 'custom/ special/' });

      // Force reinstall with new explicit prefixes
      await setupCcweb({ cwd: tmpDir, force: true, pushPrefixes: 'new-prefix/' });

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('ALLOWED_PUSH_PREFIXES="new-prefix/"');
    });
  });

  // --------------------------------------------------------------------------
  // Idempotency
  // --------------------------------------------------------------------------

  describe('idempotency', () => {
    it('should not overwrite settings on second run', async () => {
      await setupCcweb({ cwd: tmpDir });
      const result = await setupCcweb({ cwd: tmpDir });

      expect(result.success).toBe(true);
      expect(result.settingsCreated).toBe(false);
      expect(result.scriptCreated).toBe(false);
    });

    it('should not duplicate SessionStart hooks on second run', async () => {
      await setupCcweb({ cwd: tmpDir });
      await setupCcweb({ cwd: tmpDir });

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const settings = readJSON(settingsPath) as {
        hooks: { SessionStart: unknown[] };
      };
      expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it('should not duplicate bash permission on second run', async () => {
      await setupCcweb({ cwd: tmpDir });
      await setupCcweb({ cwd: tmpDir });

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const settings = readJSON(settingsPath) as {
        permissions: { allow: string[] };
      };
      const permCount = settings.permissions.allow.filter((p) => p.includes('setup-env.sh')).length;
      expect(permCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // --force flag
  // --------------------------------------------------------------------------

  describe('--force flag', () => {
    it('should overwrite settings when force is true', async () => {
      await setupCcweb({ cwd: tmpDir });
      const result = await setupCcweb({ cwd: tmpDir, force: true });

      expect(result.success).toBe(true);
      expect(result.settingsCreated).toBe(true);
      expect(result.scriptCreated).toBe(true);
    });

    it('should not duplicate SessionStart hooks on force reinstall', async () => {
      await setupCcweb({ cwd: tmpDir });
      await setupCcweb({ cwd: tmpDir, force: true });

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const settings = readJSON(settingsPath) as {
        hooks: { SessionStart: unknown[] };
      };
      expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it('should not duplicate bash permission on force reinstall', async () => {
      await setupCcweb({ cwd: tmpDir });
      await setupCcweb({ cwd: tmpDir, force: true });

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const settings = readJSON(settingsPath) as {
        permissions: { allow: string[] };
      };
      const permCount = settings.permissions.allow.filter((p) => p.includes('setup-env.sh')).length;
      expect(permCount).toBe(1);
    });
  });

  // --------------------------------------------------------------------------
  // Existing settings preservation
  // --------------------------------------------------------------------------

  describe('existing settings preservation', () => {
    it('should preserve existing hooks when adding SessionStart', async () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const existingSettings = {
        hooks: {
          PreToolUse: [
            {
              matcher: 'Bash',
              hooks: [{ type: 'command', command: 'echo test' }],
            },
          ],
        },
      };
      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify(existingSettings, null, 2),
      );

      await setupCcweb({ cwd: tmpDir });

      const settings = readJSON(path.join(claudeDir, 'settings.json')) as {
        hooks: {
          PreToolUse: unknown[];
          SessionStart: unknown[];
        };
      };
      expect(settings.hooks.PreToolUse).toHaveLength(1);
      expect(settings.hooks.SessionStart).toHaveLength(1);
    });

    it('should preserve existing permissions when adding setup-env permission', async () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const existingSettings = {
        permissions: {
          allow: ['Bash(npm test)'],
        },
      };
      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify(existingSettings, null, 2),
      );

      await setupCcweb({ cwd: tmpDir });

      const settings = readJSON(path.join(claudeDir, 'settings.json')) as {
        permissions: { allow: string[] };
      };
      expect(settings.permissions.allow).toContain('Bash(npm test)');
      expect(settings.permissions.allow).toContain('Bash(sh .claude/scripts/setup-env.sh)');
      expect(settings.permissions.allow).toHaveLength(2);
    });

    it('should preserve other top-level settings keys', async () => {
      const claudeDir = path.join(tmpDir, '.claude');
      fs.mkdirSync(claudeDir, { recursive: true });

      const existingSettings = {
        model: 'claude-sonnet-4-5-20250514',
        customKey: 'customValue',
      };
      fs.writeFileSync(
        path.join(claudeDir, 'settings.json'),
        JSON.stringify(existingSettings, null, 2),
      );

      await setupCcweb({ cwd: tmpDir });

      const settings = readJSON(path.join(claudeDir, 'settings.json')) as Record<string, unknown>;
      expect(settings.model).toBe('claude-sonnet-4-5-20250514');
      expect(settings.customKey).toBe('customValue');
      expect(settings.hooks).toBeDefined();
    });
  });

  // --------------------------------------------------------------------------
  // Error handling
  // --------------------------------------------------------------------------

  describe('error handling', () => {
    it('should fail when not in a git repository', async () => {
      const nonGitDir = fs.mkdtempSync(path.join(os.tmpdir(), 'no-git-'));

      try {
        const result = await setupCcweb({ cwd: nonGitDir });

        expect(result.success).toBe(false);
        expect(result.settingsCreated).toBe(false);
        expect(result.scriptCreated).toBe(false);
        expect(result.errors).toContain('Not a git repository');
      } finally {
        fs.rmSync(nonGitDir, { recursive: true, force: true });
      }
    });
  });

  // --------------------------------------------------------------------------
  // Script content validation
  // --------------------------------------------------------------------------

  describe('script content', () => {
    it('should only run in remote Claude Code environments', async () => {
      await setupCcweb({ cwd: tmpDir });

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('CLAUDE_CODE_REMOTE');
      expect(content).toContain('exit 0');
    });

    it('should install sessionlog via npm', async () => {
      await setupCcweb({ cwd: tmpDir });

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('npm install -g sessionlog');
    });

    it('should enable sessionlog with claude-code agent', async () => {
      await setupCcweb({ cwd: tmpDir });

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('sessionlog enable --agent claude-code --local');
    });

    it('should configure GitHub direct-push access', async () => {
      await setupCcweb({ cwd: tmpDir });

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('GITHUB_TOKEN');
      expect(content).toContain('git remote set-url --push origin');
      expect(content).toContain('x-access-token');
    });

    it('should install pre-push branch filter', async () => {
      await setupCcweb({ cwd: tmpDir });

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('sessionlog-ccweb-push-filter');
      expect(content).toContain('Blocked push to');
    });

    it('should start with proper shebang', async () => {
      await setupCcweb({ cwd: tmpDir });

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content.startsWith('#!/bin/sh')).toBe(true);
    });

    it('should use set -e for error handling', async () => {
      await setupCcweb({ cwd: tmpDir });

      const scriptPath = path.join(tmpDir, '.claude', 'scripts', 'setup-env.sh');
      const content = fs.readFileSync(scriptPath, 'utf-8');
      expect(content).toContain('set -e');
    });
  });

  // --------------------------------------------------------------------------
  // Settings JSON structure
  // --------------------------------------------------------------------------

  describe('settings structure', () => {
    it('should use correct SessionStart hook format with matcher and hooks array', async () => {
      await setupCcweb({ cwd: tmpDir });

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const settings = readJSON(settingsPath) as {
        hooks: {
          SessionStart: Array<{
            matcher: string;
            hooks: Array<{ type: string; command: string }>;
          }>;
        };
      };

      const hook = settings.hooks.SessionStart[0];
      expect(hook.matcher).toBe('');
      expect(hook.hooks).toHaveLength(1);
      expect(hook.hooks[0].type).toBe('command');
      expect(hook.hooks[0].command).toBe('sh .claude/scripts/setup-env.sh');
    });

    it('should write valid JSON with trailing newline', async () => {
      await setupCcweb({ cwd: tmpDir });

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const raw = fs.readFileSync(settingsPath, 'utf-8');

      // Should be valid JSON
      expect(() => JSON.parse(raw)).not.toThrow();

      // Should end with newline
      expect(raw.endsWith('\n')).toBe(true);
    });

    it('should use pretty-printed JSON with 2-space indent', async () => {
      await setupCcweb({ cwd: tmpDir });

      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      const raw = fs.readFileSync(settingsPath, 'utf-8');

      // Check that it has 2-space indentation
      expect(raw).toContain('  "hooks"');
    });
  });
});

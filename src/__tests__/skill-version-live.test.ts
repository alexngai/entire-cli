/**
 * Live Integration Tests for Skill Version Resolution
 *
 * Tests the resolver chain against REAL tool-managed skill directories:
 *   - openskills CLI (reads/lists skills from .claude/skills/)
 *   - Claude Code native skills (~/.claude/skills/)
 *
 * Gated behind LIVE_SKILL_RESOLUTION=1 environment variable:
 *   LIVE_SKILL_RESOLUTION=1 npx vitest run src/__tests__/skill-version-live.test.ts
 *
 * Prerequisites:
 *   - `openskills` installed globally or available via npx
 *   - Network access for GitHub cloning (for openskills install tests)
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';
import { createClaudeCodeAgent } from '../agent/agents/claude-code.js';
import { createLifecycleHandler } from '../hooks/lifecycle.js';
import { createSessionStore } from '../store/session-store.js';
import { createCheckpointStore } from '../store/checkpoint-store.js';
import { EventType, type Event, type TrackedSkill } from '../types.js';
import {
  UserSkillResolver,
  createSkillVersionResolverChain,
} from '../hooks/skill-version-resolver.js';

const LIVE = process.env.LIVE_SKILL_RESOLUTION === '1';

// ============================================================================
// Helpers
// ============================================================================

function initRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'commit.gpgsign', 'false'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'pipe' });
}

function writeFile(dir: string, relPath: string, content: string): void {
  const absPath = path.join(dir, relPath);
  fs.mkdirSync(path.dirname(absPath), { recursive: true });
  fs.writeFileSync(absPath, content);
}

function commitFile(dir: string, relPath: string, content: string): string {
  writeFile(dir, relPath, content);
  execFileSync('git', ['add', relPath], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', `Add ${relPath}`], { cwd: dir, stdio: 'pipe' });
  return execFileSync('git', ['log', '-1', '--format=%H'], { cwd: dir, stdio: 'pipe' })
    .toString()
    .trim();
}

function makeEvent(overrides: Partial<Event> & { type: EventType }): Event {
  return {
    sessionID: 'live-version-session',
    sessionRef: '/path/to/transcript.jsonl',
    timestamp: new Date(),
    ...overrides,
  };
}

function openskillsAvailable(): boolean {
  try {
    execSync('npx openskills@latest --version', { stdio: 'pipe', timeout: 15_000 });
    return true;
  } catch {
    return false;
  }
}

// ============================================================================
// Live Tests: openskills CLI integration
// ============================================================================

describe.skipIf(!LIVE)('Live Integration — Skill Version Resolution', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionlog-skill-live-'));
    initRepo(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  // ==========================================================================
  // openskills: verify our resolver finds what openskills manages
  // ==========================================================================

  describe('openskills CLI — resolver compatibility', () => {
    let openskillsOk: boolean;

    beforeAll(() => {
      openskillsOk = openskillsAvailable();
      if (!openskillsOk) {
        console.warn('openskills CLI not available — skipping openskills tests');
      }
    });

    it('should resolve a skill that openskills recognizes via `openskills list`', async () => {
      if (!openskillsOk) return;

      // Create a skill in .claude/skills/ — the format openskills expects
      const skillContent = `---
name: test-resolver-skill
description: Skill created to verify resolver picks it up
version: 1.0.0
author: integration-test
---

# Test Resolver Skill

This skill exists to verify that sessionlog's version resolver
correctly identifies skills managed by openskills.
`;
      commitFile(tmpDir, '.claude/skills/test-resolver-skill/SKILL.md', skillContent);

      // Verify openskills sees it
      const listOutput = execSync('npx openskills@latest list', {
        cwd: tmpDir,
        encoding: 'utf-8',
        timeout: 15_000,
      });
      console.log('openskills list output:', listOutput);
      expect(listOutput).toContain('test-resolver-skill');

      // Verify openskills can read it
      const readOutput = execSync('npx openskills@latest read test-resolver-skill', {
        cwd: tmpDir,
        encoding: 'utf-8',
        timeout: 15_000,
      });
      expect(readOutput).toContain('Test Resolver Skill');

      // Now verify OUR resolver chain finds the same skill
      const chain = createSkillVersionResolverChain();
      const resolved = await chain.resolve({
        skillName: 'test-resolver-skill',
        cwd: tmpDir,
      });

      expect(resolved).not.toBeNull();
      expect(resolved!.sourceType).toBe('repo-skill');
      expect(resolved!.version).toBe('1.0.0');
      expect(resolved!.author).toBe('integration-test');
      expect(resolved!.filePath).toContain('test-resolver-skill/SKILL.md');
      expect(resolved!.commitSha).toBeDefined();
      expect(resolved!.commitSha).toHaveLength(40);
    });

    it('should resolve a skill that openskills reads with matching content', async () => {
      if (!openskillsOk) return;

      // Create a more complex skill with reference files
      const skillContent = `---
name: api-tester
description: Test API endpoints
version: 2.5.0
author: qa-team
---

# API Tester

Send HTTP requests and validate responses.

## Steps
1. Parse endpoint configuration
2. Send request
3. Validate response schema
`;
      commitFile(tmpDir, '.claude/skills/api-tester/SKILL.md', skillContent);
      // Add a reference file (openskills supports this)
      writeFile(
        tmpDir,
        '.claude/skills/api-tester/references/openapi-spec.md',
        '# OpenAPI Spec Reference\n\nDetails here.',
      );
      execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'add reference'], { cwd: tmpDir, stdio: 'pipe' });

      // Verify both openskills and our resolver see it
      const readOutput = execSync('npx openskills@latest read api-tester', {
        cwd: tmpDir,
        encoding: 'utf-8',
        timeout: 15_000,
      });
      expect(readOutput).toContain('API Tester');

      const chain = createSkillVersionResolverChain();
      const resolved = await chain.resolve({
        skillName: 'api-tester',
        cwd: tmpDir,
      });

      expect(resolved).not.toBeNull();
      expect(resolved!.sourceType).toBe('repo-skill');
      expect(resolved!.version).toBe('2.5.0');
    });

    it('should match openskills list count with resolver results', async () => {
      if (!openskillsOk) return;

      // Create multiple skills
      const skills = [
        { name: 'skill-alpha', version: '1.0.0' },
        { name: 'skill-beta', version: '2.0.0' },
        { name: 'skill-gamma', version: '3.0.0' },
      ];

      for (const skill of skills) {
        commitFile(
          tmpDir,
          `.claude/skills/${skill.name}/SKILL.md`,
          `---\nname: ${skill.name}\nversion: ${skill.version}\n---\n\n# ${skill.name}\n`,
        );
      }

      // Get openskills list (project-level only)
      const listOutput = execSync('npx openskills@latest list', {
        cwd: tmpDir,
        encoding: 'utf-8',
        timeout: 15_000,
      });

      // All three should be listed
      for (const skill of skills) {
        expect(listOutput).toContain(skill.name);
      }

      // Our resolver should find each one
      const chain = createSkillVersionResolverChain();
      for (const skill of skills) {
        const resolved = await chain.resolve({
          skillName: skill.name,
          cwd: tmpDir,
        });
        expect(resolved).not.toBeNull();
        expect(resolved!.version).toBe(skill.version);
        expect(resolved!.sourceType).toBe('repo-skill');
      }
    });

    it('openskills flat file layout (name.md) — resolver should find it', async () => {
      if (!openskillsOk) return;

      // openskills also supports flat file layout
      commitFile(
        tmpDir,
        '.claude/skills/quick-check.md',
        `---
name: quick-check
description: Quick code review
version: 0.1.0
---

# Quick Check
`,
      );

      // openskills won't list flat files (it expects directories), but our resolver should
      const chain = createSkillVersionResolverChain();
      const resolved = await chain.resolve({
        skillName: 'quick-check',
        cwd: tmpDir,
      });

      expect(resolved).not.toBeNull();
      expect(resolved!.sourceType).toBe('repo-skill');
      expect(resolved!.version).toBe('0.1.0');
    });
  });

  // ==========================================================================
  // Full lifecycle pipeline with openskills-style skills
  // ==========================================================================

  describe('Full lifecycle pipeline — openskills-style skills', () => {
    let openskillsOk: boolean;

    beforeAll(() => {
      openskillsOk = openskillsAvailable();
    });

    it('should resolve version through full lifecycle dispatch', async () => {
      if (!openskillsOk) return;

      // Create skill in openskills format
      const sha = commitFile(
        tmpDir,
        '.claude/skills/deploy/SKILL.md',
        `---
name: deploy
description: Deploy to production
version: 3.0.0
author: devops
---

# Deploy Skill

## Steps
1. Build artifacts
2. Push to registry
3. Update deployment
`,
      );

      // Verify openskills sees it
      const listOutput = execSync('npx openskills@latest list', {
        cwd: tmpDir,
        encoding: 'utf-8',
        timeout: 15_000,
      });
      expect(listOutput).toContain('deploy');

      // Run full lifecycle pipeline
      const sessionsDir = path.join(tmpDir, '.git', 'sessionlog-sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });
      const sessionStore = createSessionStore(tmpDir, sessionsDir);
      const checkpointStore = createCheckpointStore(tmpDir);
      const lifecycle = createLifecycleHandler({
        sessionStore,
        checkpointStore,
        cwd: tmpDir,
      });
      const agent = createClaudeCodeAgent();

      // Start session
      await lifecycle.dispatch(agent, makeEvent({ type: EventType.SessionStart }));

      // Dispatch skill use
      const hookStdin = JSON.stringify({
        session_id: 'live-version-session',
        transcript_path: '/path/to/transcript.jsonl',
        tool_use_id: 'toolu_live_1',
        tool_input: { skill: 'deploy', args: '--env production' },
        tool_response: 'Deployed successfully',
      });
      const event = agent.parseHookEvent('post-skill', hookStdin);
      expect(event).not.toBeNull();
      await lifecycle.dispatch(agent, event!);

      // Verify session state has resolved version info
      const state = await sessionStore.load('live-version-session');
      expect(state).not.toBeNull();
      expect(state!.skillsUsed).toHaveLength(1);

      const skill = state!.skillsUsed![0] as TrackedSkill;
      expect(skill.name).toBe('deploy');
      expect(skill.args).toBe('--env production');
      expect(skill.sourceType).toBe('repo-skill');
      expect(skill.version).toBe('3.0.0');
      expect(skill.commitSha).toBe(sha);
      expect(skill.filePath).toBe('.claude/skills/deploy/SKILL.md');

      console.log('Live lifecycle result:', JSON.stringify(skill, null, 2));
    });
  });

  // ==========================================================================
  // Global user skills (~/.claude/skills/)
  // ==========================================================================

  describe('Global user skills — ~/.claude/skills/', () => {
    it('should resolve real globally-installed skills from ~/.claude/skills/', async () => {
      const globalSkillsDir = path.join(os.homedir(), '.claude', 'skills');
      if (!fs.existsSync(globalSkillsDir)) {
        console.warn('No ~/.claude/skills/ directory — skipping');
        return;
      }

      // List what's actually installed globally
      const entries = fs
        .readdirSync(globalSkillsDir, { withFileTypes: true })
        .filter((e) => e.isDirectory() || e.name.endsWith('.md'));

      if (entries.length === 0) {
        console.warn('No global skills found — skipping');
        return;
      }

      console.log(
        'Found global skills:',
        entries.map((e) => e.name),
      );

      // Try to resolve each one
      const resolver = new UserSkillResolver();
      for (const entry of entries) {
        const skillName = entry.name.replace(/\.md$/, '');
        const resolved = await resolver.resolve({
          skillName,
          cwd: tmpDir,
        });

        if (resolved) {
          console.log(
            `  ${skillName}: sourceType=${resolved.sourceType}, version=${resolved.version ?? 'none'}, author=${resolved.author ?? 'none'}`,
          );
          expect(resolved.sourceType).toBe('user-skill');
          expect(resolved.filePath).toBeDefined();
        } else {
          console.log(`  ${skillName}: not resolved (no matching file pattern)`);
        }
      }
    });

    it('should resolve session-start-hook skill if installed globally', async () => {
      const skillPath = path.join(
        os.homedir(),
        '.claude',
        'skills',
        'session-start-hook',
        'SKILL.md',
      );
      if (!fs.existsSync(skillPath)) {
        console.warn('session-start-hook not installed globally — skipping');
        return;
      }

      // Read the actual content
      const content = fs.readFileSync(skillPath, 'utf-8');
      console.log('session-start-hook frontmatter preview:', content.slice(0, 300));

      // Resolve via UserSkillResolver
      const resolver = new UserSkillResolver();
      const resolved = await resolver.resolve({
        skillName: 'session-start-hook',
        cwd: tmpDir,
      });

      expect(resolved).not.toBeNull();
      expect(resolved!.sourceType).toBe('user-skill');
      expect(resolved!.filePath).toContain('session-start-hook');

      // Also test via the full chain — should fall through repo → skilltree → user
      const chain = createSkillVersionResolverChain();
      const chainResult = await chain.resolve({
        skillName: 'session-start-hook',
        cwd: tmpDir,
      });

      // Should be found by user-skill resolver (not repo-skill, since it's in ~ not project)
      expect(chainResult).not.toBeNull();
      expect(chainResult!.sourceType).toBe('user-skill');
    });
  });

  // ==========================================================================
  // Cross-validation: openskills list vs resolver chain
  // ==========================================================================

  describe('Cross-validation — openskills list vs resolver', () => {
    let openskillsOk: boolean;

    beforeAll(() => {
      openskillsOk = openskillsAvailable();
    });

    it('every skill openskills lists as "project" should be resolvable by our chain', async () => {
      if (!openskillsOk) return;

      // Create a set of skills
      const skillNames = ['alpha', 'beta', 'gamma'];
      for (const name of skillNames) {
        commitFile(
          tmpDir,
          `.claude/skills/${name}/SKILL.md`,
          `---\nname: ${name}\nversion: 1.0.0\n---\n\n# ${name}\n`,
        );
      }

      // Parse openskills list output for project skills
      const listOutput = execSync('npx openskills@latest list', {
        cwd: tmpDir,
        encoding: 'utf-8',
        timeout: 15_000,
      });

      // Extract project skill names from output
      const projectSkills: string[] = [];
      let inProject = false;
      for (const line of listOutput.split('\n')) {
        if (line.includes('(project)')) {
          const match = line.match(/^\s+(\S+)/);
          if (match) projectSkills.push(match[1]);
          inProject = true;
        } else if (inProject && line.trim() === '') {
          inProject = false;
        }
      }

      console.log('openskills project skills:', projectSkills);
      expect(projectSkills.length).toBeGreaterThanOrEqual(skillNames.length);

      // Every project skill should be resolvable
      const chain = createSkillVersionResolverChain();
      const mismatches: string[] = [];

      for (const name of projectSkills) {
        const resolved = await chain.resolve({ skillName: name, cwd: tmpDir });
        if (!resolved) {
          mismatches.push(name);
        }
      }

      if (mismatches.length > 0) {
        console.error('Skills listed by openskills but NOT resolved:', mismatches);
      }
      expect(mismatches).toEqual([]);
    });
  });

  // ==========================================================================
  // Resolver handles real-world skill formats
  // ==========================================================================

  describe('Real-world skill format compatibility', () => {
    it('should handle openskills-style skill with scripts/ and references/ dirs', async () => {
      // Full openskills skill layout
      commitFile(
        tmpDir,
        '.claude/skills/pdf/SKILL.md',
        `---
name: pdf
description: Comprehensive PDF manipulation toolkit for extracting text and tables, creating new PDFs, merging/splitting documents, and handling forms.
version: 1.2.0
---

# PDF Skill Instructions

When the user asks you to work with PDFs, follow these steps:
1. Install dependencies
2. Use the appropriate script
`,
      );
      writeFile(
        tmpDir,
        '.claude/skills/pdf/scripts/extract_text.py',
        '#!/usr/bin/env python3\nimport sys\nprint("extract")\n',
      );
      writeFile(tmpDir, '.claude/skills/pdf/references/pypdf2-api.md', '# PyPDF2 API Reference\n');
      execFileSync('git', ['add', '.'], { cwd: tmpDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'add pdf extras'], { cwd: tmpDir, stdio: 'pipe' });

      const chain = createSkillVersionResolverChain();
      const resolved = await chain.resolve({ skillName: 'pdf', cwd: tmpDir });

      expect(resolved).not.toBeNull();
      expect(resolved!.sourceType).toBe('repo-skill');
      expect(resolved!.version).toBe('1.2.0');
      // Description is in frontmatter but we only extract version/author/status
    });

    it('should handle skill with no version in frontmatter (description-only)', async () => {
      // Some openskills skills only have name + description, no version
      const sha = commitFile(
        tmpDir,
        '.claude/skills/code-review/SKILL.md',
        `---
name: code-review
description: Review code for quality and security issues
---

# Code Review

Review the code carefully.
`,
      );

      const chain = createSkillVersionResolverChain();
      const resolved = await chain.resolve({ skillName: 'code-review', cwd: tmpDir });

      expect(resolved).not.toBeNull();
      expect(resolved!.sourceType).toBe('repo-skill');
      expect(resolved!.version).toBeUndefined();
      // Still has git SHA even without version
      expect(resolved!.commitSha).toBe(sha);
    });

    it('should handle skill with only description frontmatter (openskills minimal)', async () => {
      // Absolute minimum openskills format
      commitFile(
        tmpDir,
        '.claude/skills/minimal/SKILL.md',
        `---
description: Does something
---

Instructions here.
`,
      );

      const chain = createSkillVersionResolverChain();
      const resolved = await chain.resolve({ skillName: 'minimal', cwd: tmpDir });

      expect(resolved).not.toBeNull();
      expect(resolved!.sourceType).toBe('repo-skill');
      expect(resolved!.version).toBeUndefined();
      expect(resolved!.commitSha).toBeDefined();
    });
  });
});

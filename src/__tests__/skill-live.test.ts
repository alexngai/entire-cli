/**
 * Live Agent Tests for Skill Usage Tracking
 *
 * Tests the full skill tracking pipeline with real Claude Code sessions
 * and deterministic CLI binary dispatch.
 *
 * Gated behind LIVE_AGENT=1 environment variable:
 *   LIVE_AGENT=1 npx vitest run src/__tests__/skill-live.test.ts
 *
 * Prerequisites:
 *   - `claude` CLI installed and authenticated (Claude Max or API key)
 *   - `npm run build` has been run (dist/ exists)
 *   - `npm link` has been run (sessionlog available in PATH)
 */

import { describe, it, expect, beforeAll, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync, execSync } from 'node:child_process';

const LIVE = process.env.LIVE_AGENT === '1';

// ============================================================================
// Helpers
// ============================================================================

function initRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test Project\n\nA simple test project.');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial commit'], { cwd: dir, stdio: 'pipe' });
}

function enableSessionlog(dir: string): void {
  execFileSync('sessionlog', ['enable', '--force', '--agent', 'claude-code'], {
    cwd: dir,
    stdio: 'pipe',
  });
}

function readSessionStates(dir: string): Record<string, unknown>[] {
  const sessionsDir = path.join(dir, '.git', 'sessionlog-sessions');
  if (!fs.existsSync(sessionsDir)) return [];

  return fs
    .readdirSync(sessionsDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
      } catch {
        return null;
      }
    })
    .filter(Boolean) as Record<string, unknown>[];
}

function runClaude(
  dir: string,
  prompt: string,
  opts?: {
    allowedTools?: string[];
    systemPrompt?: string;
    timeoutMs?: number;
    model?: string;
  },
): string {
  const args = ['-p', '--dangerously-skip-permissions'];

  if (opts?.model) {
    args.push('--model', opts.model);
  } else {
    args.push('--model', 'sonnet');
  }

  if (opts?.allowedTools?.length) {
    args.push('--allowedTools', opts.allowedTools.join(','));
  }

  if (opts?.systemPrompt) {
    args.push('--system-prompt', opts.systemPrompt);
  }

  args.push('--', prompt);

  const cmd = ['claude', ...args].map((a) => `'${a.replace(/'/g, "'\\''")}'`).join(' ');

  const result = execSync(cmd, {
    cwd: dir,
    timeout: opts?.timeoutMs ?? 120_000,
    encoding: 'utf-8',
    env: {
      ...process.env,
      CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1',
    },
  });

  return result;
}

// ============================================================================
// Live Agent Tests — Skill Usage
// ============================================================================

describe.skipIf(!LIVE)('Live Agent — Skill Usage', () => {
  let tmpDir: string;

  beforeAll(() => {
    try {
      execFileSync('which', ['sessionlog'], { stdio: 'pipe' });
    } catch {
      throw new Error('sessionlog not found in PATH. Run: npm run build && npm link');
    }
    try {
      execFileSync('which', ['claude'], { stdio: 'pipe' });
    } catch {
      throw new Error('claude CLI not found in PATH');
    }
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionlog-skill-live-'));
    initRepo(tmpDir);
    enableSessionlog(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Skill use via real Claude session', () => {
    it('should capture skill usage when Claude invokes /simplify', async () => {
      // Create a file with some code that can be "simplified"
      const srcDir = path.join(tmpDir, 'src');
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, 'utils.ts'),
        [
          'export function add(a: number, b: number): number {',
          '  const result = a + b;',
          '  return result;',
          '}',
          '',
        ].join('\n'),
      );
      execFileSync('git', ['add', 'src/utils.ts'], { cwd: tmpDir, stdio: 'pipe' });
      execFileSync('git', ['commit', '-m', 'add utils'], { cwd: tmpDir, stdio: 'pipe' });

      // Make a small change so /simplify has something to review
      fs.writeFileSync(
        path.join(srcDir, 'utils.ts'),
        [
          'export function add(a: number, b: number): number {',
          '  const result = a + b;',
          '  return result;',
          '}',
          '',
          'export function multiply(a: number, b: number): number {',
          '  const x = a;',
          '  const y = b;',
          '  const result = x * y;',
          '  return result;',
          '}',
          '',
        ].join('\n'),
      );

      const output = runClaude(
        tmpDir,
        [
          'Use the /simplify skill to review the changed code in this project.',
          'You MUST invoke the Skill tool with skill name "simplify".',
          'Do not do anything else.',
        ].join(' '),
        {
          timeoutMs: 120_000,
        },
      );

      console.log('Claude output:', output.slice(0, 500));

      // Wait for hooks to flush
      await new Promise((r) => setTimeout(r, 2000));

      // Debug: show session state
      const sessions = readSessionStates(tmpDir);
      console.log('Sessions found:', sessions.length);

      expect(sessions.length).toBeGreaterThan(0);

      for (const s of sessions) {
        const skills = s.skillsUsed as Array<Record<string, unknown>> | undefined;
        console.log(
          `Session ${(s.sessionID as string).slice(0, 12)}:`,
          JSON.stringify({ phase: s.phase, skillsUsed: skills }, null, 2),
        );
      }

      // Find session with skills
      const sessionWithSkills = sessions.find(
        (s) => Array.isArray(s.skillsUsed) && (s.skillsUsed as unknown[]).length > 0,
      );

      if (sessionWithSkills) {
        const skills = sessionWithSkills.skillsUsed as Array<{
          name: string;
          args?: string;
          usedAt: string;
        }>;
        expect(skills.length).toBeGreaterThanOrEqual(1);
        expect(skills[0].name).toBe('simplify');
        expect(skills[0].usedAt).toBeDefined();
        console.log('Skills captured:', JSON.stringify(skills, null, 2));
      } else {
        // Claude may not have used the Skill tool despite being asked.
        // This is a soft failure — log it but don't fail the test hard.
        console.warn(
          'WARNING: No skillsUsed found in session state.',
          'Claude may not have invoked the Skill tool as requested.',
        );
        // Soft assertion: we at least verified the pipeline doesn't error
        expect.soft(sessionWithSkills, 'Expected skillsUsed to be populated').toBeDefined();
      }
    }, 180_000);
  });
});

// ============================================================================
// CLI stdin pipe tests — deterministic, no live agent needed
// ============================================================================

describe.skipIf(!LIVE)('CLI stdin dispatch — Skill tracking via binary', () => {
  let tmpDir: string;

  beforeAll(() => {
    try {
      execFileSync('which', ['sessionlog'], { stdio: 'pipe' });
    } catch {
      throw new Error('sessionlog not found in PATH. Run: npm run build && npm link');
    }
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionlog-skill-cli-'));
    initRepo(tmpDir);
    enableSessionlog(tmpDir);

    // Pre-create a session state file so hooks have something to update
    const sessionsDir = path.join(tmpDir, '.git', 'sessionlog-sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sessionState = {
      sessionID: 'cli-skill-session',
      baseCommit: 'abc123',
      startedAt: new Date().toISOString(),
      phase: 'active',
      turnCheckpointIDs: [],
      stepCount: 0,
      checkpointTranscriptStart: 0,
      untrackedFilesAtStart: [],
      filesTouched: [],
      agentType: 'Claude Code',
    };
    fs.writeFileSync(
      path.join(sessionsDir, 'cli-skill-session.json'),
      JSON.stringify(sessionState, null, 2),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should dispatch post-skill through the real CLI binary', () => {
    const hookPayload = JSON.stringify({
      session_id: 'cli-skill-session',
      transcript_path: '/path/to/transcript.jsonl',
      tool_use_id: 'toolu_01SKL',
      tool_input: {
        skill: 'commit',
        args: '-m "Add feature"',
      },
      tool_response: 'Skill executed successfully',
    });

    execSync(`echo ${JSON.stringify(hookPayload)} | sessionlog hooks claude-code post-skill`, {
      cwd: tmpDir,
      timeout: 10_000,
      stdio: 'pipe',
    });

    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', 'cli-skill-session.json');
    const state = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

    expect(state.skillsUsed).toBeDefined();
    expect(state.skillsUsed).toHaveLength(1);
    expect(state.skillsUsed[0].name).toBe('commit');
    expect(state.skillsUsed[0].args).toBe('-m "Add feature"');
    expect(state.skillsUsed[0].usedAt).toBeDefined();
  });

  it('should dispatch multiple skills through the real CLI binary', () => {
    // First skill
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-skill-session',
          transcript_path: '/path/to/transcript.jsonl',
          tool_use_id: 'toolu_01',
          tool_input: { skill: 'commit', args: '-m "Initial"' },
        }),
      )} | sessionlog hooks claude-code post-skill`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // Second skill
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-skill-session',
          transcript_path: '/path/to/transcript.jsonl',
          tool_use_id: 'toolu_02',
          tool_input: { skill: 'simplify' },
        }),
      )} | sessionlog hooks claude-code post-skill`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // Third skill
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-skill-session',
          transcript_path: '/path/to/transcript.jsonl',
          tool_use_id: 'toolu_03',
          tool_input: { skill: 'frontend-design:frontend-design' },
        }),
      )} | sessionlog hooks claude-code post-skill`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', 'cli-skill-session.json');
    const state = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

    expect(state.skillsUsed).toHaveLength(3);
    expect(state.skillsUsed[0].name).toBe('commit');
    expect(state.skillsUsed[0].args).toBe('-m "Initial"');
    expect(state.skillsUsed[1].name).toBe('simplify');
    expect(state.skillsUsed[1].args).toBeUndefined();
    expect(state.skillsUsed[2].name).toBe('frontend-design:frontend-design');
  });

  it('should track skills alongside tasks and plan mode through CLI binary', () => {
    // 1. Use a skill
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-skill-session',
          transcript_path: '/path/to/transcript.jsonl',
          tool_use_id: 'toolu_01',
          tool_input: { skill: 'find-skills', args: 'database' },
        }),
      )} | sessionlog hooks claude-code post-skill`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // 2. Enter plan mode
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-skill-session',
          transcript_path: '/path/to/transcript.jsonl',
        }),
      )} | sessionlog hooks claude-code post-plan-enter`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // 3. Exit plan mode
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-skill-session',
          transcript_path: '/path/to/transcript.jsonl',
          tool_input: {},
        }),
      )} | sessionlog hooks claude-code post-plan-exit`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // 4. Create a task
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-skill-session',
          transcript_path: '/path/to/transcript.jsonl',
          tool_use_id: 'toolu_02',
          tool_input: { subject: 'Implement feature', description: 'Build the thing' },
          tool_response: { taskId: '1' },
        }),
      )} | sessionlog hooks claude-code post-task-create`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // 5. Use another skill
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-skill-session',
          transcript_path: '/path/to/transcript.jsonl',
          tool_use_id: 'toolu_03',
          tool_input: { skill: 'commit' },
        }),
      )} | sessionlog hooks claude-code post-skill`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // Verify final state
    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', 'cli-skill-session.json');
    const state = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

    // Skills
    expect(state.skillsUsed).toHaveLength(2);
    expect(state.skillsUsed[0].name).toBe('find-skills');
    expect(state.skillsUsed[0].args).toBe('database');
    expect(state.skillsUsed[1].name).toBe('commit');

    // Plan mode
    expect(state.inPlanMode).toBe(false);
    expect(state.planModeEntries).toBe(1);

    // Tasks
    expect(Object.keys(state.tasks)).toHaveLength(1);
    expect(state.tasks['1'].subject).toBe('Implement feature');
  });

  it('should handle skill with no args gracefully', () => {
    const hookPayload = JSON.stringify({
      session_id: 'cli-skill-session',
      transcript_path: '/path/to/transcript.jsonl',
      tool_use_id: 'toolu_01',
      tool_input: {
        skill: 'simplify',
      },
    });

    execSync(`echo ${JSON.stringify(hookPayload)} | sessionlog hooks claude-code post-skill`, {
      cwd: tmpDir,
      timeout: 10_000,
      stdio: 'pipe',
    });

    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', 'cli-skill-session.json');
    const state = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

    expect(state.skillsUsed).toHaveLength(1);
    expect(state.skillsUsed[0].name).toBe('simplify');
    expect(state.skillsUsed[0].args).toBeUndefined();
  });
});

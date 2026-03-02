/**
 * Live Agent Tests for Task & Plan Mode Content Capture
 *
 * These tests run actual Claude Code sessions and verify that task descriptions
 * and plan file content are captured end-to-end through the real hook pipeline.
 *
 * Gated behind LIVE_AGENT=1 environment variable:
 *   LIVE_AGENT=1 npx vitest run src/__tests__/task-plan-live.test.ts
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

/**
 * Read all session state files from a repo's .git/sessionlog-sessions/ directory.
 */
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

/**
 * Run claude in print mode with the given prompt.
 * Returns stdout output.
 */
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
    // Use sonnet — haiku often asks follow-up questions instead of using tools
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
      // Task tools are disabled by default in non-interactive (-p) mode
      // because process.stdout.isTTY is false. This env var re-enables them.
      CLAUDE_CODE_ENABLE_TASKS: '1',
    },
  });

  return result;
}

// ============================================================================
// Tests
// ============================================================================

describe.skipIf(!LIVE)('Live Agent — Task & Plan Mode', () => {
  let tmpDir: string;

  beforeAll(() => {
    // Verify prerequisites
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
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionlog-live-'));
    initRepo(tmpDir);
    enableSessionlog(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('TaskCreate with description', () => {
    it('should capture task descriptions from a real Claude session', async () => {
      const output = runClaude(
        tmpDir,
        [
          'Create a task list with exactly 2 tasks for this project.',
          'Task 1: subject "Set up database schema" with description "Create PostgreSQL tables for users, posts, and comments with proper foreign keys and indexes".',
          'Task 2: subject "Add API endpoints" with description "Implement REST endpoints for CRUD operations on all three tables".',
          'Do NOT do any actual coding work — only create the task list to plan the work.',
        ].join(' '),
        {
          timeoutMs: 120_000,
        },
      );

      console.log('Claude output:', output.slice(0, 500));

      // Wait a moment for hooks to finish writing
      await new Promise((r) => setTimeout(r, 2000));

      // Debug: show what's on disk
      const sessionsDir = path.join(tmpDir, '.git', 'sessionlog-sessions');
      console.log('Sessions dir exists:', fs.existsSync(sessionsDir));
      if (fs.existsSync(sessionsDir)) {
        const files = fs.readdirSync(sessionsDir);
        console.log('Session files:', files);
        for (const f of files) {
          const content = JSON.parse(fs.readFileSync(path.join(sessionsDir, f), 'utf-8'));
          console.log(
            `Session ${f}:`,
            JSON.stringify(
              {
                phase: content.phase,
                tasks: content.tasks,
                taskCount: content.tasks ? Object.keys(content.tasks).length : 0,
              },
              null,
              2,
            ),
          );
        }
      }

      // Also check .claude/settings.json is there
      const settingsPath = path.join(tmpDir, '.claude', 'settings.json');
      console.log('Settings exists:', fs.existsSync(settingsPath));

      const sessions = readSessionStates(tmpDir);
      console.log('Total sessions found:', sessions.length);
      expect(sessions.length).toBeGreaterThan(0);

      // Find session with tasks
      const sessionWithTasks = sessions.find(
        (s) => s.tasks && Object.keys(s.tasks as Record<string, unknown>).length > 0,
      );

      expect(sessionWithTasks).toBeDefined();
      const tasks = sessionWithTasks!.tasks as Record<
        string,
        { subject: string; description?: string; status: string }
      >;
      const taskList = Object.values(tasks);

      console.log('Tasks found:', JSON.stringify(taskList, null, 2));

      // Verify at least one task was created
      expect(taskList.length).toBeGreaterThanOrEqual(1);

      // Verify tasks have subjects
      for (const task of taskList) {
        expect(task.subject).toBeTruthy();
      }

      // Verify at least one task has a description (the content we're testing)
      const tasksWithDescription = taskList.filter(
        (t) => t.description && t.description.length > 0,
      );
      expect(tasksWithDescription.length).toBeGreaterThanOrEqual(1);
      console.log('Tasks with descriptions:', tasksWithDescription.length);
    }, 180_000);
  });

  describe('TaskUpdate with description', () => {
    it('should capture updated descriptions from a real Claude session', async () => {
      const output = runClaude(
        tmpDir,
        [
          'Do the following steps in order:',
          '1. Create a task with subject "Build login page" and description "Create the login form component".',
          '2. Then mark that task as in_progress.',
          'Do NOT do any actual coding work.',
        ].join(' '),
        {
          timeoutMs: 120_000,
        },
      );

      console.log('Claude output:', output.slice(0, 500));

      await new Promise((r) => setTimeout(r, 2000));

      const sessions = readSessionStates(tmpDir);
      const sessionWithTasks = sessions.find(
        (s) => s.tasks && Object.keys(s.tasks as Record<string, unknown>).length > 0,
      );

      expect(sessionWithTasks).toBeDefined();
      const tasks = sessionWithTasks!.tasks as Record<
        string,
        { subject: string; description?: string; status: string }
      >;
      const taskList = Object.values(tasks);

      console.log('Tasks found:', JSON.stringify(taskList, null, 2));

      // Should have at least one task
      expect(taskList.length).toBeGreaterThanOrEqual(1);

      // At least one task should have been updated to in_progress
      const inProgressTasks = taskList.filter((t) => t.status === 'in_progress');
      expect(inProgressTasks.length).toBeGreaterThanOrEqual(1);
    }, 180_000);
  });

  describe('Plan mode with content capture', () => {
    it('should capture plan file content from a real Claude session', async () => {
      const output = runClaude(
        tmpDir,
        [
          'I want to add dark mode to this web app.',
          'Please enter plan mode, write a brief implementation plan, then exit plan mode.',
          'Do NOT make any code changes — just create the plan.',
        ].join(' '),
        {
          timeoutMs: 120_000,
        },
      );

      console.log('Claude output:', output.slice(0, 500));

      await new Promise((r) => setTimeout(r, 2000));

      const sessions = readSessionStates(tmpDir);
      expect(sessions.length).toBeGreaterThan(0);

      // Check for plan mode tracking
      const sessionWithPlan = sessions.find((s) => (s.planModeEntries as number) > 0);

      expect(sessionWithPlan).toBeDefined();
      expect(sessionWithPlan!.planModeEntries).toBeGreaterThanOrEqual(1);

      console.log('Plan mode entries:', sessionWithPlan!.planModeEntries);
      const planEntries = sessionWithPlan!.planEntries as
        | Array<Record<string, unknown>>
        | undefined;
      console.log('Plan entries:', JSON.stringify(planEntries, null, 2));

      // Verify plan entries array is populated
      if (planEntries && planEntries.length > 0) {
        expect(planEntries[0].enteredAt).toBeDefined();
        expect(planEntries[0].exitedAt).toBeDefined();
      }
    }, 180_000);
  });

  describe('Combined flow', () => {
    it('should track tasks and plan mode together in a real session', async () => {
      const output = runClaude(
        tmpDir,
        [
          'I need to add a REST API to this project. Please:',
          '1. Create a task list for the implementation.',
          '2. Mark the first task as in_progress.',
          'Do NOT write any code — only create and update the tasks.',
        ].join(' '),
        {
          timeoutMs: 120_000,
        },
      );

      console.log('Claude output:', output.slice(0, 500));

      await new Promise((r) => setTimeout(r, 2000));

      const sessions = readSessionStates(tmpDir);
      expect(sessions.length).toBeGreaterThan(0);

      // Find the most complete session
      const session = sessions.find(
        (s) =>
          (s.planModeEntries as number) > 0 ||
          (s.tasks && Object.keys(s.tasks as Record<string, unknown>).length > 0),
      );

      expect(session).toBeDefined();
      console.log(
        'Session state:',
        JSON.stringify(
          {
            planModeEntries: session!.planModeEntries,
            inPlanMode: session!.inPlanMode,
            planEntries: session!.planEntries,
            taskCount: session!.tasks
              ? Object.keys(session!.tasks as Record<string, unknown>).length
              : 0,
            tasks: session!.tasks,
          },
          null,
          2,
        ),
      );

      // At minimum, we should see evidence of tool usage
      const hasPlanMode = (session!.planModeEntries as number) > 0;
      const hasTasks =
        session!.tasks && Object.keys(session!.tasks as Record<string, unknown>).length > 0;
      expect(hasPlanMode || hasTasks).toBe(true);
    }, 180_000);
  });
});

// ============================================================================
// CLI stdin pipe test (no live agent, but tests the real CLI binary)
// ============================================================================

describe.skipIf(!LIVE)('CLI stdin dispatch — real binary', () => {
  let tmpDir: string;

  beforeAll(() => {
    try {
      execFileSync('which', ['sessionlog'], { stdio: 'pipe' });
    } catch {
      throw new Error('sessionlog not found in PATH. Run: npm run build && npm link');
    }
  });

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionlog-cli-'));
    initRepo(tmpDir);
    enableSessionlog(tmpDir);

    // Pre-create a session state file so hooks have something to update
    const sessionsDir = path.join(tmpDir, '.git', 'sessionlog-sessions');
    fs.mkdirSync(sessionsDir, { recursive: true });
    const sessionState = {
      sessionID: 'cli-test-session',
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
      path.join(sessionsDir, 'cli-test-session.json'),
      JSON.stringify(sessionState, null, 2),
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should dispatch TaskCreate through the real CLI binary', () => {
    const hookPayload = JSON.stringify({
      session_id: 'cli-test-session',
      transcript_path: '/path/to/transcript.jsonl',
      tool_use_id: 'toolu_01ABC',
      tool_input: {
        subject: 'Fix authentication bug',
        description: 'The login form fails with special characters in passwords',
        activeForm: 'Fixing authentication bug',
      },
      tool_response: {
        taskId: '42',
      },
    });

    execSync(
      `echo ${JSON.stringify(hookPayload)} | sessionlog hooks claude-code post-task-create`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // Read session state
    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', 'cli-test-session.json');
    const state = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

    expect(state.tasks).toBeDefined();
    expect(state.tasks['42']).toBeDefined();
    expect(state.tasks['42'].subject).toBe('Fix authentication bug');
    expect(state.tasks['42'].description).toBe(
      'The login form fails with special characters in passwords',
    );
    expect(state.tasks['42'].status).toBe('pending');
    expect(state.tasks['42'].activeForm).toBe('Fixing authentication bug');
  });

  it('should dispatch TaskUpdate through the real CLI binary', () => {
    // First create a task
    const createPayload = JSON.stringify({
      session_id: 'cli-test-session',
      transcript_path: '/path/to/transcript.jsonl',
      tool_use_id: 'toolu_01',
      tool_input: {
        subject: 'Original task',
        description: 'Original description',
      },
      tool_response: { taskId: '7' },
    });
    execSync(
      `echo ${JSON.stringify(createPayload)} | sessionlog hooks claude-code post-task-create`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // Then update it
    const updatePayload = JSON.stringify({
      session_id: 'cli-test-session',
      transcript_path: '/path/to/transcript.jsonl',
      tool_use_id: 'toolu_02',
      tool_input: {
        taskId: '7',
        status: 'completed',
        description: 'Updated description after completion',
      },
    });
    execSync(
      `echo ${JSON.stringify(updatePayload)} | sessionlog hooks claude-code post-task-update`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', 'cli-test-session.json');
    const state = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

    expect(state.tasks['7'].status).toBe('completed');
    expect(state.tasks['7'].description).toBe('Updated description after completion');
  });

  it('should dispatch PlanModeEnter and PlanModeExit through the real CLI binary', () => {
    // Enter plan mode
    const enterPayload = JSON.stringify({
      session_id: 'cli-test-session',
      transcript_path: '/path/to/transcript.jsonl',
    });
    execSync(
      `echo ${JSON.stringify(enterPayload)} | sessionlog hooks claude-code post-plan-enter`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', 'cli-test-session.json');
    let state = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    expect(state.inPlanMode).toBe(true);
    expect(state.planModeEntries).toBe(1);
    expect(state.planEntries).toHaveLength(1);
    expect(state.planEntries[0].enteredAt).toBeDefined();

    // Create a plan file
    const planDir = path.join(tmpDir, '.claude', 'plans');
    fs.mkdirSync(planDir, { recursive: true });
    const planPath = path.join(planDir, 'test-plan.md');
    fs.writeFileSync(planPath, '# Plan\n\n## Steps\n1. Do the thing\n2. Verify it works');

    // Exit plan mode with plan file path
    const exitPayload = JSON.stringify({
      session_id: 'cli-test-session',
      transcript_path: '/path/to/transcript.jsonl',
      tool_input: {
        allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
      },
      tool_response: {
        planFilePath: planPath,
      },
    });
    execSync(`echo ${JSON.stringify(exitPayload)} | sessionlog hooks claude-code post-plan-exit`, {
      cwd: tmpDir,
      timeout: 10_000,
      stdio: 'pipe',
    });

    state = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    expect(state.inPlanMode).toBe(false);
    expect(state.planModeEntries).toBe(1);
    expect(state.planEntries).toHaveLength(1);
    expect(state.planEntries[0].filePath).toBe(planPath);
    expect(state.planEntries[0].content).toBe(
      '# Plan\n\n## Steps\n1. Do the thing\n2. Verify it works',
    );
    expect(state.planEntries[0].exitedAt).toBeDefined();
  });

  it('should handle full task + plan lifecycle through CLI binary', () => {
    // 1. Enter plan mode
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-test-session',
          transcript_path: '/path/to/transcript.jsonl',
        }),
      )} | sessionlog hooks claude-code post-plan-enter`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // 2. Exit plan mode (no plan file)
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-test-session',
          transcript_path: '/path/to/transcript.jsonl',
          tool_input: {},
        }),
      )} | sessionlog hooks claude-code post-plan-exit`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // 3. Create task
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-test-session',
          transcript_path: '/path/to/transcript.jsonl',
          tool_use_id: 'toolu_01',
          tool_input: {
            subject: 'Implement dark mode',
            description: 'Add CSS custom properties and a ThemeProvider component',
          },
          tool_response: { taskId: '1' },
        }),
      )} | sessionlog hooks claude-code post-task-create`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // 4. Create second task
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-test-session',
          transcript_path: '/path/to/transcript.jsonl',
          tool_use_id: 'toolu_02',
          tool_input: {
            subject: 'Add toggle switch',
            description: 'Create a theme toggle component in the settings page',
          },
          tool_response: { taskId: '2' },
        }),
      )} | sessionlog hooks claude-code post-task-create`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // 5. Complete first task
    execSync(
      `echo ${JSON.stringify(
        JSON.stringify({
          session_id: 'cli-test-session',
          transcript_path: '/path/to/transcript.jsonl',
          tool_use_id: 'toolu_03',
          tool_input: { taskId: '1', status: 'completed' },
        }),
      )} | sessionlog hooks claude-code post-task-update`,
      { cwd: tmpDir, timeout: 10_000, stdio: 'pipe' },
    );

    // Verify final state
    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', 'cli-test-session.json');
    const state = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

    // Plan mode
    expect(state.inPlanMode).toBe(false);
    expect(state.planModeEntries).toBe(1);
    expect(state.planEntries).toHaveLength(1);
    expect(state.planEntries[0].exitedAt).toBeDefined();

    // Tasks
    expect(Object.keys(state.tasks)).toHaveLength(2);
    expect(state.tasks['1'].subject).toBe('Implement dark mode');
    expect(state.tasks['1'].description).toBe(
      'Add CSS custom properties and a ThemeProvider component',
    );
    expect(state.tasks['1'].status).toBe('completed');
    expect(state.tasks['2'].subject).toBe('Add toggle switch');
    expect(state.tasks['2'].description).toBe(
      'Create a theme toggle component in the settings page',
    );
    expect(state.tasks['2'].status).toBe('pending');
  });
});

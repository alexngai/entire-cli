/**
 * Tests for Agent Hook Dispatch (CLI `sessionlog hooks <agent-name> <hook-name>`)
 *
 * Validates the missing functionality: agent lifecycle hooks were installed
 * by each agent's installHooks() but the CLI had no handler for
 * `sessionlog hooks <agent-name>` — only `sessionlog hooks git` was implemented.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execSync } from 'node:child_process';
import { createLifecycleHandler } from '../hooks/lifecycle.js';
import { createSessionStore } from '../store/session-store.js';
import { createCheckpointStore } from '../store/checkpoint-store.js';
import { getAgent } from '../agent/registry.js';
import { hasHookSupport } from '../agent/types.js';
import { EventType } from '../types.js';

// Ensure agents are registered
import '../agent/agents/claude-code.js';
import '../agent/agents/cursor.js';
import '../agent/agents/gemini-cli.js';
import '../agent/agents/opencode.js';

// ============================================================================
// Helpers
// ============================================================================

function initRepo(dir: string): void {
  execSync('git init', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.email "test@test.com"', { cwd: dir, stdio: 'pipe' });
  execSync('git config user.name "Test"', { cwd: dir, stdio: 'pipe' });
  // Need an initial commit for getHead() to work
  fs.writeFileSync(path.join(dir, 'README.md'), '# test');
  execSync('git add . && git commit -m "init"', { cwd: dir, stdio: 'pipe' });
}

function enableSessionlog(dir: string): void {
  const slDir = path.join(dir, '.sessionlog');
  fs.mkdirSync(slDir, { recursive: true });
  fs.writeFileSync(path.join(slDir, 'settings.json'), JSON.stringify({ enabled: true }));
}

/** Run the CLI as a subprocess and return stdout/stderr/exit code */
function runCLI(
  args: string[],
  opts: { cwd: string; stdin?: string },
): { stdout: string; stderr: string; exitCode: number } {
  const cliPath = path.resolve(__dirname, '../../dist/cli.js');
  try {
    const result = execSync(`node ${cliPath} ${args.join(' ')}`, {
      cwd: opts.cwd,
      input: opts.stdin,
      encoding: 'utf-8',
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    return { stdout: result, stderr: '', exitCode: 0 };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; status?: number };
    return {
      stdout: String(e.stdout ?? ''),
      stderr: String(e.stderr ?? ''),
      exitCode: e.status ?? 1,
    };
  }
}

// ============================================================================
// Unit Tests: parseHookEvent
// ============================================================================

describe('Agent parseHookEvent', () => {
  it('claude-code should parse session-start event', () => {
    const agent = getAgent('claude-code');
    expect(agent).not.toBeNull();
    expect(hasHookSupport(agent!)).toBe(true);
    if (!hasHookSupport(agent!)) return;

    const event = agent.parseHookEvent(
      'session-start',
      JSON.stringify({ session_id: 'abc-123', transcript_path: '/tmp/transcript.jsonl' }),
    );

    expect(event).not.toBeNull();
    expect(event!.type).toBe(EventType.SessionStart);
    expect(event!.sessionID).toBe('abc-123');
    expect(event!.sessionRef).toBe('/tmp/transcript.jsonl');
  });

  it('claude-code should parse user-prompt-submit event', () => {
    const agent = getAgent('claude-code');
    if (!hasHookSupport(agent!)) return;

    const event = agent!.parseHookEvent(
      'user-prompt-submit',
      JSON.stringify({
        session_id: 'abc-123',
        transcript_path: '/tmp/transcript.jsonl',
        prompt: 'fix the login bug',
      }),
    );

    expect(event).not.toBeNull();
    expect(event!.type).toBe(EventType.TurnStart);
    expect((event as { prompt?: string }).prompt).toBe('fix the login bug');
  });

  it('claude-code should parse stop event', () => {
    const agent = getAgent('claude-code');
    if (!hasHookSupport(agent!)) return;

    const event = agent!.parseHookEvent(
      'stop',
      JSON.stringify({ session_id: 'abc-123', transcript_path: '/tmp/transcript.jsonl' }),
    );

    expect(event).not.toBeNull();
    expect(event!.type).toBe(EventType.TurnEnd);
  });

  it('claude-code should parse session-end event', () => {
    const agent = getAgent('claude-code');
    if (!hasHookSupport(agent!)) return;

    const event = agent!.parseHookEvent(
      'session-end',
      JSON.stringify({ session_id: 'abc-123', transcript_path: '/tmp/transcript.jsonl' }),
    );

    expect(event).not.toBeNull();
    expect(event!.type).toBe(EventType.SessionEnd);
  });

  it('claude-code should parse pre-task (subagent start) event', () => {
    const agent = getAgent('claude-code');
    if (!hasHookSupport(agent!)) return;

    const event = agent!.parseHookEvent(
      'pre-task',
      JSON.stringify({
        session_id: 'abc-123',
        transcript_path: '/tmp/transcript.jsonl',
        tool_use_id: 'tool-xyz',
        tool_input: { prompt: 'research something' },
      }),
    );

    expect(event).not.toBeNull();
    expect(event!.type).toBe(EventType.SubagentStart);
  });

  it('claude-code should parse post-task (subagent end) event', () => {
    const agent = getAgent('claude-code');
    if (!hasHookSupport(agent!)) return;

    const event = agent!.parseHookEvent(
      'post-task',
      JSON.stringify({
        session_id: 'abc-123',
        transcript_path: '/tmp/transcript.jsonl',
        tool_use_id: 'tool-xyz',
        tool_response: { agentId: 'sub-agent-1' },
      }),
    );

    expect(event).not.toBeNull();
    expect(event!.type).toBe(EventType.SubagentEnd);
  });

  it('claude-code should return null for unknown hook name', () => {
    const agent = getAgent('claude-code');
    if (!hasHookSupport(agent!)) return;

    const event = agent!.parseHookEvent('bogus-hook', JSON.stringify({ session_id: 'abc' }));
    expect(event).toBeNull();
  });

  it('claude-code should return null for invalid JSON', () => {
    const agent = getAgent('claude-code');
    if (!hasHookSupport(agent!)) return;

    const event = agent!.parseHookEvent('session-start', 'not json');
    expect(event).toBeNull();
  });
});

// ============================================================================
// Unit Tests: Lifecycle Handler Dispatch
// ============================================================================

describe('Lifecycle Handler with Agent Events', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-hooks-'));
    initRepo(tmpDir);
    enableSessionlog(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should create a session on SessionStart dispatch', async () => {
    const sessionStore = createSessionStore(tmpDir);
    const checkpointStore = createCheckpointStore(tmpDir);
    const handler = createLifecycleHandler({ sessionStore, checkpointStore, cwd: tmpDir });

    const agent = getAgent('claude-code')!;
    await handler.dispatch(agent, {
      type: EventType.SessionStart,
      sessionID: 'test-session-1',
      sessionRef: '/tmp/test-transcript.jsonl',
      timestamp: new Date(),
    });

    const session = await sessionStore.load('test-session-1');
    expect(session).not.toBeNull();
    expect(session!.sessionID).toBe('test-session-1');
    expect(session!.phase).toBe('idle');
    expect(session!.agentType).toBe('Claude Code');
  });

  it('should transition to active on TurnStart dispatch', async () => {
    const sessionStore = createSessionStore(tmpDir);
    const checkpointStore = createCheckpointStore(tmpDir);
    const handler = createLifecycleHandler({ sessionStore, checkpointStore, cwd: tmpDir });
    const agent = getAgent('claude-code')!;

    // Start session
    await handler.dispatch(agent, {
      type: EventType.SessionStart,
      sessionID: 'test-session-2',
      sessionRef: '/tmp/transcript.jsonl',
      timestamp: new Date(),
    });

    // Start turn
    await handler.dispatch(agent, {
      type: EventType.TurnStart,
      sessionID: 'test-session-2',
      sessionRef: '/tmp/transcript.jsonl',
      prompt: 'hello world',
      timestamp: new Date(),
    });

    const session = await sessionStore.load('test-session-2');
    expect(session!.phase).toBe('active');
    expect(session!.firstPrompt).toBe('hello world');
  });

  it('should transition to idle on TurnEnd dispatch', async () => {
    const sessionStore = createSessionStore(tmpDir);
    const checkpointStore = createCheckpointStore(tmpDir);
    const handler = createLifecycleHandler({ sessionStore, checkpointStore, cwd: tmpDir });
    const agent = getAgent('claude-code')!;

    // Start session + turn
    await handler.dispatch(agent, {
      type: EventType.SessionStart,
      sessionID: 'test-session-3',
      sessionRef: '/tmp/transcript.jsonl',
      timestamp: new Date(),
    });
    await handler.dispatch(agent, {
      type: EventType.TurnStart,
      sessionID: 'test-session-3',
      sessionRef: '/tmp/transcript.jsonl',
      prompt: 'do something',
      timestamp: new Date(),
    });

    // End turn
    await handler.dispatch(agent, {
      type: EventType.TurnEnd,
      sessionID: 'test-session-3',
      sessionRef: '/tmp/transcript.jsonl',
      timestamp: new Date(),
    });

    const session = await sessionStore.load('test-session-3');
    expect(session!.phase).toBe('idle');
  });

  it('should transition to ended on SessionEnd dispatch', async () => {
    const sessionStore = createSessionStore(tmpDir);
    const checkpointStore = createCheckpointStore(tmpDir);
    const handler = createLifecycleHandler({ sessionStore, checkpointStore, cwd: tmpDir });
    const agent = getAgent('claude-code')!;

    await handler.dispatch(agent, {
      type: EventType.SessionStart,
      sessionID: 'test-session-4',
      sessionRef: '/tmp/transcript.jsonl',
      timestamp: new Date(),
    });

    await handler.dispatch(agent, {
      type: EventType.SessionEnd,
      sessionID: 'test-session-4',
      sessionRef: '/tmp/transcript.jsonl',
      timestamp: new Date(),
    });

    const session = await sessionStore.load('test-session-4');
    expect(session!.phase).toBe('ended');
    expect(session!.endedAt).toBeDefined();
  });

  it('should create shadow branch on TurnEnd when files were modified', async () => {
    const sessionStore = createSessionStore(tmpDir);
    const checkpointStore = createCheckpointStore(tmpDir);
    const handler = createLifecycleHandler({ sessionStore, checkpointStore, cwd: tmpDir });
    const agent = getAgent('claude-code')!;

    // Create an empty transcript file (TurnStart records the current position)
    const transcriptPath = path.join(tmpDir, 'transcript.jsonl');
    fs.writeFileSync(transcriptPath, '');

    // Dispatch SessionStart → TurnStart
    await handler.dispatch(agent, {
      type: EventType.SessionStart,
      sessionID: 'shadow-test',
      sessionRef: transcriptPath,
      timestamp: new Date(),
    });
    await handler.dispatch(agent, {
      type: EventType.TurnStart,
      sessionID: 'shadow-test',
      sessionRef: transcriptPath,
      prompt: 'create hello',
      timestamp: new Date(),
    });

    // Simulate agent writing a file (transcript updated DURING the turn)
    const transcriptLine = JSON.stringify({
      type: 'assistant',
      message: {
        content: [
          {
            type: 'tool_use',
            name: 'Write',
            input: { file_path: 'src/hello.ts' },
          },
        ],
      },
    });
    fs.writeFileSync(transcriptPath, transcriptLine + '\n');

    // TurnEnd extracts files from transcript and creates shadow branch
    await handler.dispatch(agent, {
      type: EventType.TurnEnd,
      sessionID: 'shadow-test',
      sessionRef: transcriptPath,
      timestamp: new Date(),
    });

    const session = await sessionStore.load('shadow-test');
    expect(session).not.toBeNull();
    expect(session!.filesTouched).toContain('src/hello.ts');
    expect(session!.stepCount).toBe(1);

    // Verify shadow branch was created
    const shadowBranch = checkpointStore.getShadowBranchName(
      session!.baseCommit,
      session!.worktreeID,
    );
    const branchList = execSync(`git branch --list "${shadowBranch}"`, {
      cwd: tmpDir,
      encoding: 'utf-8',
    });
    expect(branchList.trim()).toContain(shadowBranch);
  });

  it('should auto-create session on TurnStart if session does not exist', async () => {
    const sessionStore = createSessionStore(tmpDir);
    const checkpointStore = createCheckpointStore(tmpDir);
    const handler = createLifecycleHandler({ sessionStore, checkpointStore, cwd: tmpDir });
    const agent = getAgent('claude-code')!;

    // Dispatch TurnStart without prior SessionStart
    await handler.dispatch(agent, {
      type: EventType.TurnStart,
      sessionID: 'auto-created-session',
      sessionRef: '/tmp/transcript.jsonl',
      prompt: 'first prompt',
      timestamp: new Date(),
    });

    const session = await sessionStore.load('auto-created-session');
    expect(session).not.toBeNull();
    expect(session!.phase).toBe('active');
    expect(session!.firstPrompt).toBe('first prompt');
  });
});

// ============================================================================
// CLI Integration Tests
// ============================================================================

describe('CLI hooks agent dispatch', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cli-agent-hooks-'));
    initRepo(tmpDir);
    enableSessionlog(tmpDir);
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should handle `hooks claude-code session-start` via CLI', () => {
    const result = runCLI(['hooks', 'claude-code', 'session-start'], {
      cwd: tmpDir,
      stdin: JSON.stringify({ session_id: 'cli-test-1', transcript_path: '/tmp/t.jsonl' }),
    });

    expect(result.exitCode).toBe(0);

    // Verify session was created
    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', 'cli-test-1.json');
    expect(fs.existsSync(sessionFile)).toBe(true);

    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    expect(session.sessionID).toBe('cli-test-1');
    expect(session.phase).toBe('idle');
    expect(session.agentType).toBe('Claude Code');
  });

  it('should handle `hooks claude-code user-prompt-submit` via CLI', () => {
    // First create the session
    runCLI(['hooks', 'claude-code', 'session-start'], {
      cwd: tmpDir,
      stdin: JSON.stringify({ session_id: 'cli-test-2', transcript_path: '/tmp/t.jsonl' }),
    });

    // Then send a prompt
    const result = runCLI(['hooks', 'claude-code', 'user-prompt-submit'], {
      cwd: tmpDir,
      stdin: JSON.stringify({
        session_id: 'cli-test-2',
        transcript_path: '/tmp/t.jsonl',
        prompt: 'implement feature X',
      }),
    });

    expect(result.exitCode).toBe(0);

    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', 'cli-test-2.json');
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    expect(session.phase).toBe('active');
    expect(session.firstPrompt).toBe('implement feature X');
  });

  it('should handle `hooks claude-code session-end` via CLI', () => {
    // Create and end session
    runCLI(['hooks', 'claude-code', 'session-start'], {
      cwd: tmpDir,
      stdin: JSON.stringify({ session_id: 'cli-test-3', transcript_path: '/tmp/t.jsonl' }),
    });

    const result = runCLI(['hooks', 'claude-code', 'session-end'], {
      cwd: tmpDir,
      stdin: JSON.stringify({ session_id: 'cli-test-3', transcript_path: '/tmp/t.jsonl' }),
    });

    expect(result.exitCode).toBe(0);

    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', 'cli-test-3.json');
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
    expect(session.phase).toBe('ended');
  });

  it('should exit 0 silently with no stdin', () => {
    const result = runCLI(['hooks', 'claude-code', 'session-start'], {
      cwd: tmpDir,
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('should exit 0 silently with empty stdin', () => {
    const result = runCLI(['hooks', 'claude-code', 'session-start'], {
      cwd: tmpDir,
      stdin: '',
    });

    expect(result.exitCode).toBe(0);
  });

  it('should exit 0 silently with invalid JSON stdin', () => {
    const result = runCLI(['hooks', 'claude-code', 'session-start'], {
      cwd: tmpDir,
      stdin: 'not json at all',
    });

    expect(result.exitCode).toBe(0);
    expect(result.stderr).toBe('');
  });

  it('should exit 1 for unknown agent name', () => {
    const result = runCLI(['hooks', 'nonexistent-agent', 'session-start'], {
      cwd: tmpDir,
      stdin: JSON.stringify({ session_id: 'test' }),
    });

    expect(result.exitCode).toBe(1);
    expect(result.stderr).toContain('Unknown hooks subcommand');
  });

  it('should exit 0 silently when sessionlog is disabled', () => {
    // Overwrite settings to disable
    const settingsPath = path.join(tmpDir, '.sessionlog', 'settings.json');
    fs.writeFileSync(settingsPath, JSON.stringify({ enabled: false }));

    const result = runCLI(['hooks', 'claude-code', 'session-start'], {
      cwd: tmpDir,
      stdin: JSON.stringify({ session_id: 'disabled-test', transcript_path: '/tmp/t.jsonl' }),
    });

    expect(result.exitCode).toBe(0);

    // Session should NOT be created
    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', 'disabled-test.json');
    expect(fs.existsSync(sessionFile)).toBe(false);
  });

  it('should handle full session lifecycle via CLI', () => {
    const sid = 'lifecycle-test';
    const stdin = (extra: Record<string, unknown> = {}) =>
      JSON.stringify({ session_id: sid, transcript_path: '/tmp/t.jsonl', ...extra });

    // 1. Session start
    runCLI(['hooks', 'claude-code', 'session-start'], { cwd: tmpDir, stdin: stdin() });

    // 2. User prompt
    runCLI(['hooks', 'claude-code', 'user-prompt-submit'], {
      cwd: tmpDir,
      stdin: stdin({ prompt: 'build a REST API' }),
    });

    // 3. Agent stop (turn end)
    runCLI(['hooks', 'claude-code', 'stop'], { cwd: tmpDir, stdin: stdin() });

    // 4. Another prompt
    runCLI(['hooks', 'claude-code', 'user-prompt-submit'], {
      cwd: tmpDir,
      stdin: stdin({ prompt: 'add tests' }),
    });

    // 5. Agent stop again
    runCLI(['hooks', 'claude-code', 'stop'], { cwd: tmpDir, stdin: stdin() });

    // 6. Session end
    runCLI(['hooks', 'claude-code', 'session-end'], { cwd: tmpDir, stdin: stdin() });

    const sessionFile = path.join(tmpDir, '.git', 'sessionlog-sessions', `${sid}.json`);
    const session = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));

    expect(session.phase).toBe('ended');
    expect(session.endedAt).toBeDefined();
    // First prompt should be preserved (not overwritten by second)
    expect(session.firstPrompt).toBe('build a REST API');
  });
});

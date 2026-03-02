/**
 * End-to-end tests for Task & Plan Mode content capture
 *
 * Tests the full pipeline: hook event parsing → lifecycle dispatch → session state on disk.
 * Uses a real git repo and real session/checkpoint stores.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { execFileSync } from 'node:child_process';
import { createClaudeCodeAgent } from '../agent/agents/claude-code.js';
import { createLifecycleHandler } from '../hooks/lifecycle.js';
import { createSessionStore } from '../store/session-store.js';
import { createCheckpointStore } from '../store/checkpoint-store.js';
import { EventType, type Event } from '../types.js';

// ============================================================================
// Helpers
// ============================================================================

function initRepo(dir: string): void {
  execFileSync('git', ['init'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.email', 'test@test.com'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['config', 'user.name', 'Test'], { cwd: dir, stdio: 'pipe' });
  fs.writeFileSync(path.join(dir, 'README.md'), '# Test');
  execFileSync('git', ['add', '.'], { cwd: dir, stdio: 'pipe' });
  execFileSync('git', ['commit', '-m', 'initial'], { cwd: dir, stdio: 'pipe' });
}

function makeEvent(overrides: Partial<Event> & { type: EventType }): Event {
  return {
    sessionID: 'e2e-session',
    sessionRef: '/path/to/transcript.jsonl',
    timestamp: new Date(),
    ...overrides,
  };
}

// ============================================================================
// Tests
// ============================================================================

describe('Task & Plan Mode — E2E', () => {
  let tmpDir: string;
  let agent: ReturnType<typeof createClaudeCodeAgent>;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionlog-e2e-'));
    initRepo(tmpDir);
    agent = createClaudeCodeAgent();
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('Full task lifecycle with content', () => {
    it('should persist task description through create → update → session state on disk', async () => {
      const sessionsDir = path.join(tmpDir, '.git', 'sessionlog-sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const sessionStore = createSessionStore(tmpDir, sessionsDir);
      const checkpointStore = createCheckpointStore(tmpDir);
      const lifecycle = createLifecycleHandler({
        sessionStore,
        checkpointStore,
        cwd: tmpDir,
      });

      // 1. Start a session
      await lifecycle.dispatch(
        agent,
        makeEvent({
          type: EventType.SessionStart,
        }),
      );

      // Verify session exists
      let state = await sessionStore.load('e2e-session');
      expect(state).not.toBeNull();
      expect(state!.phase).toBe('idle');

      // 2. Create a task with description
      const taskCreateStdin = JSON.stringify({
        session_id: 'e2e-session',
        transcript_path: '/path/to/transcript.jsonl',
        tool_use_id: 'tu-create-1',
        tool_input: {
          subject: 'Implement OAuth login flow',
          description:
            'Add OAuth2 support with Google and GitHub providers. Include token refresh logic and session management.',
          activeForm: 'Implementing OAuth login flow',
        },
        tool_response: {
          taskId: '42',
        },
      });

      const createEvent = agent.parseHookEvent('post-task-create', taskCreateStdin);
      expect(createEvent).not.toBeNull();
      await lifecycle.dispatch(agent, createEvent!);

      // Verify task with description persisted
      state = await sessionStore.load('e2e-session');
      expect(state!.tasks).toBeDefined();
      expect(state!.tasks!['42']).toBeDefined();
      expect(state!.tasks!['42'].subject).toBe('Implement OAuth login flow');
      expect(state!.tasks!['42'].description).toBe(
        'Add OAuth2 support with Google and GitHub providers. Include token refresh logic and session management.',
      );
      expect(state!.tasks!['42'].status).toBe('pending');
      expect(state!.tasks!['42'].activeForm).toBe('Implementing OAuth login flow');

      // 3. Update the task to in_progress
      const taskUpdateStdin = JSON.stringify({
        session_id: 'e2e-session',
        transcript_path: '/path/to/transcript.jsonl',
        tool_use_id: 'tu-update-1',
        tool_input: {
          taskId: '42',
          status: 'in_progress',
        },
      });

      const updateEvent = agent.parseHookEvent('post-task-update', taskUpdateStdin);
      expect(updateEvent).not.toBeNull();
      await lifecycle.dispatch(agent, updateEvent!);

      state = await sessionStore.load('e2e-session');
      expect(state!.tasks!['42'].status).toBe('in_progress');
      // Description should be preserved from create
      expect(state!.tasks!['42'].description).toBe(
        'Add OAuth2 support with Google and GitHub providers. Include token refresh logic and session management.',
      );

      // 4. Complete the task with updated description
      const taskCompleteStdin = JSON.stringify({
        session_id: 'e2e-session',
        transcript_path: '/path/to/transcript.jsonl',
        tool_use_id: 'tu-update-2',
        tool_input: {
          taskId: '42',
          status: 'completed',
          description:
            'Implemented OAuth2 with Google and GitHub. Added token refresh and session management. Tests passing.',
        },
      });

      const completeEvent = agent.parseHookEvent('post-task-update', taskCompleteStdin);
      await lifecycle.dispatch(agent, completeEvent!);

      state = await sessionStore.load('e2e-session');
      expect(state!.tasks!['42'].status).toBe('completed');
      expect(state!.tasks!['42'].description).toBe(
        'Implemented OAuth2 with Google and GitHub. Added token refresh and session management. Tests passing.',
      );

      // 5. Verify the data is actually on disk by reading the JSON file directly
      const sessionFile = path.join(sessionsDir, 'e2e-session.json');
      expect(fs.existsSync(sessionFile)).toBe(true);
      const rawJSON = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      expect(rawJSON.tasks['42'].description).toBe(
        'Implemented OAuth2 with Google and GitHub. Added token refresh and session management. Tests passing.',
      );
    });
  });

  describe('Full plan mode lifecycle with content', () => {
    it('should persist plan file content through enter → exit → session state on disk', async () => {
      const sessionsDir = path.join(tmpDir, '.git', 'sessionlog-sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const sessionStore = createSessionStore(tmpDir, sessionsDir);
      const checkpointStore = createCheckpointStore(tmpDir);
      const lifecycle = createLifecycleHandler({
        sessionStore,
        checkpointStore,
        cwd: tmpDir,
      });

      // 1. Start a session
      await lifecycle.dispatch(
        agent,
        makeEvent({
          type: EventType.SessionStart,
        }),
      );

      // 2. Enter plan mode
      const enterStdin = JSON.stringify({
        session_id: 'e2e-session',
        transcript_path: '/path/to/transcript.jsonl',
      });
      const enterEvent = agent.parseHookEvent('post-plan-enter', enterStdin);
      expect(enterEvent).not.toBeNull();
      await lifecycle.dispatch(agent, enterEvent!);

      let state = await sessionStore.load('e2e-session');
      expect(state!.inPlanMode).toBe(true);
      expect(state!.planModeEntries).toBe(1);

      // 3. Create a real plan file on disk
      const planDir = path.join(tmpDir, '.claude', 'plans');
      fs.mkdirSync(planDir, { recursive: true });
      const planFilePath = path.join(planDir, 'my-feature-plan.md');
      const planContent = `# Feature Plan: Add Dark Mode

## Context
Users have requested a dark mode theme for the application.

## Changes
1. Add CSS custom properties for theming
2. Create ThemeProvider component
3. Add toggle in settings

## Verification
- Visual regression tests pass
- Toggle persists across sessions
`;
      fs.writeFileSync(planFilePath, planContent);

      // 4. Exit plan mode with the plan file path in tool_response
      const exitStdin = JSON.stringify({
        session_id: 'e2e-session',
        transcript_path: '/path/to/transcript.jsonl',
        tool_input: {
          allowedPrompts: [{ tool: 'Bash', prompt: 'run tests' }],
        },
        tool_response: {
          planFilePath: planFilePath,
        },
      });
      const exitEvent = agent.parseHookEvent('post-plan-exit', exitStdin);
      expect(exitEvent).not.toBeNull();
      expect(exitEvent!.planFilePath).toBe(planFilePath);

      await lifecycle.dispatch(agent, exitEvent!);

      // 5. Verify session state has plan content
      state = await sessionStore.load('e2e-session');
      expect(state!.inPlanMode).toBe(false);
      expect(state!.planModeEntries).toBe(1);
      expect(state!.planEntries).toHaveLength(1);
      // Path is normalized to CWD-relative since plan file is inside tmpDir
      const expectedRelPath = path.relative(tmpDir, planFilePath);
      expect(state!.planEntries![0].filePath).toBe(expectedRelPath);
      expect(state!.planEntries![0].content).toBe(planContent);
      expect(state!.planEntries![0].exitedAt).toBeDefined();

      // 6. Verify it's actually on disk
      const sessionFile = path.join(sessionsDir, 'e2e-session.json');
      const rawJSON = JSON.parse(fs.readFileSync(sessionFile, 'utf-8'));
      expect(rawJSON.planEntries).toHaveLength(1);
      expect(rawJSON.planEntries[0].filePath).toBe(expectedRelPath);
      expect(rawJSON.planEntries[0].content).toBe(planContent);
    });

    it('should handle plan file path from string response message', async () => {
      const sessionsDir = path.join(tmpDir, '.git', 'sessionlog-sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const sessionStore = createSessionStore(tmpDir, sessionsDir);
      const checkpointStore = createCheckpointStore(tmpDir);
      const lifecycle = createLifecycleHandler({
        sessionStore,
        checkpointStore,
        cwd: tmpDir,
      });

      await lifecycle.dispatch(
        agent,
        makeEvent({
          type: EventType.SessionStart,
        }),
      );

      await lifecycle.dispatch(
        agent,
        makeEvent({
          type: EventType.PlanModeEnter,
        }),
      );

      // Create a plan file
      const planDir = path.join(tmpDir, '.claude', 'plans');
      fs.mkdirSync(planDir, { recursive: true });
      const planFilePath = path.join(planDir, 'string-response-plan.md');
      fs.writeFileSync(planFilePath, '# Simple plan\nDo the thing.');

      // tool_response is a string message (not an object)
      const exitStdin = JSON.stringify({
        session_id: 'e2e-session',
        transcript_path: '/path/to/transcript.jsonl',
        tool_input: {},
        tool_response: `Your plan has been saved to: ${planFilePath}`,
      });
      const exitEvent = agent.parseHookEvent('post-plan-exit', exitStdin);
      expect(exitEvent!.planFilePath).toBe(planFilePath);

      await lifecycle.dispatch(agent, exitEvent!);

      const state = await sessionStore.load('e2e-session');
      // Path normalized to CWD-relative since plan file is inside tmpDir
      expect(state!.planEntries![0].filePath).toBe(path.relative(tmpDir, planFilePath));
      expect(state!.planEntries![0].content).toBe('# Simple plan\nDo the thing.');
    });

    it('should gracefully handle missing plan file', async () => {
      const sessionsDir = path.join(tmpDir, '.git', 'sessionlog-sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const sessionStore = createSessionStore(tmpDir, sessionsDir);
      const checkpointStore = createCheckpointStore(tmpDir);
      const lifecycle = createLifecycleHandler({
        sessionStore,
        checkpointStore,
        cwd: tmpDir,
      });

      await lifecycle.dispatch(
        agent,
        makeEvent({
          type: EventType.SessionStart,
        }),
      );

      await lifecycle.dispatch(
        agent,
        makeEvent({
          type: EventType.PlanModeEnter,
        }),
      );

      // Exit with a plan file path that doesn't exist
      const exitStdin = JSON.stringify({
        session_id: 'e2e-session',
        transcript_path: '/path/to/transcript.jsonl',
        tool_input: {},
        tool_response: {
          planFilePath: '/nonexistent/plan.md',
        },
      });
      const exitEvent = agent.parseHookEvent('post-plan-exit', exitStdin);
      await lifecycle.dispatch(agent, exitEvent!);

      const state = await sessionStore.load('e2e-session');
      expect(state!.inPlanMode).toBe(false);
      expect(state!.planEntries![0].filePath).toBe('/nonexistent/plan.md');
      expect(state!.planEntries![0].content).toBeUndefined();
    });
  });

  describe('Combined task + plan mode flow', () => {
    it('should track tasks and plan mode together in the same session', async () => {
      const sessionsDir = path.join(tmpDir, '.git', 'sessionlog-sessions');
      fs.mkdirSync(sessionsDir, { recursive: true });

      const sessionStore = createSessionStore(tmpDir, sessionsDir);
      const checkpointStore = createCheckpointStore(tmpDir);
      const lifecycle = createLifecycleHandler({
        sessionStore,
        checkpointStore,
        cwd: tmpDir,
      });

      // Start session
      await lifecycle.dispatch(agent, makeEvent({ type: EventType.SessionStart }));

      // Enter plan mode
      await lifecycle.dispatch(agent, makeEvent({ type: EventType.PlanModeEnter }));

      // Exit plan mode (no plan file for simplicity)
      await lifecycle.dispatch(agent, makeEvent({ type: EventType.PlanModeExit }));

      // Create multiple tasks
      for (const [id, subject, desc] of [
        ['1', 'Set up project structure', 'Create directories and config files'],
        ['2', 'Implement core logic', 'Write the main business logic module'],
        ['3', 'Add tests', 'Write unit and integration tests'],
      ] as const) {
        const stdin = JSON.stringify({
          session_id: 'e2e-session',
          transcript_path: '/path/to/transcript.jsonl',
          tool_use_id: `tu-${id}`,
          tool_input: { subject, description: desc },
          tool_response: { taskId: id },
        });
        const event = agent.parseHookEvent('post-task-create', stdin);
        await lifecycle.dispatch(agent, event!);
      }

      // Update task 1 to completed
      const updateStdin = JSON.stringify({
        session_id: 'e2e-session',
        transcript_path: '/path/to/transcript.jsonl',
        tool_use_id: 'tu-update',
        tool_input: { taskId: '1', status: 'completed' },
      });
      const updateEvent = agent.parseHookEvent('post-task-update', updateStdin);
      await lifecycle.dispatch(agent, updateEvent!);

      // Verify final state
      const state = await sessionStore.load('e2e-session');

      // Plan mode tracking
      expect(state!.inPlanMode).toBe(false);
      expect(state!.planModeEntries).toBe(1);

      // Task tracking with descriptions
      expect(Object.keys(state!.tasks!)).toHaveLength(3);
      expect(state!.tasks!['1'].status).toBe('completed');
      expect(state!.tasks!['1'].description).toBe('Create directories and config files');
      expect(state!.tasks!['2'].status).toBe('pending');
      expect(state!.tasks!['2'].description).toBe('Write the main business logic module');
      expect(state!.tasks!['3'].status).toBe('pending');
      expect(state!.tasks!['3'].description).toBe('Write unit and integration tests');
    });
  });

  describe('CLI stdin parsing → lifecycle dispatch', () => {
    it('should parse real Claude Code hook JSON and produce correct events', () => {
      // Simulate exactly what Claude Code sends via PostToolUse hook for TaskCreate
      const hookPayload = {
        session_id: 'abc-123-def',
        transcript_path: '/Users/user/.claude/projects/proj/transcript.jsonl',
        tool_use_id: 'toolu_01ABC',
        tool_input: {
          subject: 'Fix authentication bug in login flow',
          description:
            'The login form fails when passwords contain special characters like & and <. Need to properly escape user input before sending to the auth API.',
          activeForm: 'Fixing authentication bug',
        },
        tool_response: {
          taskId: '7',
        },
      };

      const event = agent.parseHookEvent('post-task-create', JSON.stringify(hookPayload));
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.TaskCreate);
      expect(event!.sessionID).toBe('abc-123-def');
      expect(event!.taskID).toBe('7');
      expect(event!.taskSubject).toBe('Fix authentication bug in login flow');
      expect(event!.taskDescription).toBe(
        'The login form fails when passwords contain special characters like & and <. Need to properly escape user input before sending to the auth API.',
      );
      expect(event!.taskActiveForm).toBe('Fixing authentication bug');
      expect(event!.toolUseID).toBe('toolu_01ABC');
    });

    it('should parse real Claude Code hook JSON for ExitPlanMode with plan file', () => {
      const hookPayload = {
        session_id: 'abc-123-def',
        transcript_path: '/Users/user/.claude/projects/proj/transcript.jsonl',
        tool_use_id: 'toolu_02XYZ',
        tool_input: {
          allowedPrompts: [
            { tool: 'Bash', prompt: 'run tests' },
            { tool: 'Bash', prompt: 'install dependencies' },
          ],
        },
        tool_response: {
          planFilePath: '/Users/user/.claude/plans/my-feature.md',
        },
      };

      const event = agent.parseHookEvent('post-plan-exit', JSON.stringify(hookPayload));
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.PlanModeExit);
      expect(event!.planFilePath).toBe('/Users/user/.claude/plans/my-feature.md');
      expect(event!.planAllowedPrompts).toHaveLength(2);
    });
  });
});

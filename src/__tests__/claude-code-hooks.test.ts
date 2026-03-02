/**
 * Tests for Claude Code Agent hook parsing — task and plan mode events
 */

import { describe, it, expect } from 'vitest';
import { createClaudeCodeAgent } from '../agent/agents/claude-code.js';
import { EventType } from '../types.js';

describe('Claude Code Agent - Task & Plan Mode Hooks', () => {
  const agent = createClaudeCodeAgent();

  describe('parseHookEvent — post-task-create', () => {
    it('should parse task create event with tool_input and tool_response', () => {
      const stdin = JSON.stringify({
        session_id: 'sess-123',
        transcript_path: '/path/to/transcript.jsonl',
        tool_use_id: 'tu-abc',
        tool_input: {
          subject: 'Fix authentication bug',
          description: 'Detailed description of the bug fix',
          activeForm: 'Fixing authentication bug',
        },
        tool_response: {
          taskId: '42',
        },
      });

      const event = agent.parseHookEvent('post-task-create', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.TaskCreate);
      expect(event!.sessionID).toBe('sess-123');
      expect(event!.taskID).toBe('42');
      expect(event!.taskSubject).toBe('Fix authentication bug');
      expect(event!.taskActiveForm).toBe('Fixing authentication bug');
      expect(event!.taskDescription).toBe('Detailed description of the bug fix');
      expect(event!.toolUseID).toBe('tu-abc');
    });

    it('should handle missing tool_response gracefully', () => {
      const stdin = JSON.stringify({
        session_id: 'sess-123',
        transcript_path: '/path/to/transcript.jsonl',
        tool_use_id: 'tu-abc',
        tool_input: {
          subject: 'Add tests',
        },
      });

      const event = agent.parseHookEvent('post-task-create', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.TaskCreate);
      expect(event!.taskID).toBe('');
      expect(event!.taskSubject).toBe('Add tests');
    });

    it('should handle malformed JSON', () => {
      const event = agent.parseHookEvent('post-task-create', 'not json');
      expect(event).toBeNull();
    });
  });

  describe('parseHookEvent — post-task-update', () => {
    it('should parse task update event', () => {
      const stdin = JSON.stringify({
        session_id: 'sess-123',
        transcript_path: '/path/to/transcript.jsonl',
        tool_use_id: 'tu-def',
        tool_input: {
          taskId: '42',
          status: 'completed',
          subject: 'Fix authentication bug',
        },
      });

      const event = agent.parseHookEvent('post-task-update', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.TaskUpdate);
      expect(event!.taskID).toBe('42');
      expect(event!.taskStatus).toBe('completed');
      expect(event!.taskSubject).toBe('Fix authentication bug');
    });

    it('should handle status-only update', () => {
      const stdin = JSON.stringify({
        session_id: 'sess-123',
        transcript_path: '/path/to/transcript.jsonl',
        tool_use_id: 'tu-ghi',
        tool_input: {
          taskId: '7',
          status: 'in_progress',
        },
      });

      const event = agent.parseHookEvent('post-task-update', stdin);
      expect(event).not.toBeNull();
      expect(event!.taskID).toBe('7');
      expect(event!.taskStatus).toBe('in_progress');
      expect(event!.taskSubject).toBeUndefined();
    });

    it('should handle malformed JSON', () => {
      const event = agent.parseHookEvent('post-task-update', '{invalid');
      expect(event).toBeNull();
    });
  });

  describe('parseHookEvent — post-plan-enter', () => {
    it('should parse plan mode enter event', () => {
      const stdin = JSON.stringify({
        session_id: 'sess-456',
        transcript_path: '/path/to/transcript.jsonl',
      });

      const event = agent.parseHookEvent('post-plan-enter', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.PlanModeEnter);
      expect(event!.sessionID).toBe('sess-456');
    });

    it('should handle malformed JSON', () => {
      const event = agent.parseHookEvent('post-plan-enter', '');
      expect(event).toBeNull();
    });
  });

  describe('parseHookEvent — post-plan-exit', () => {
    it('should parse plan mode exit event with allowed prompts', () => {
      const stdin = JSON.stringify({
        session_id: 'sess-456',
        transcript_path: '/path/to/transcript.jsonl',
        tool_input: {
          allowedPrompts: [
            { tool: 'Bash', prompt: 'run tests' },
            { tool: 'Bash', prompt: 'install dependencies' },
          ],
        },
      });

      const event = agent.parseHookEvent('post-plan-exit', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.PlanModeExit);
      expect(event!.sessionID).toBe('sess-456');
      expect(event!.planAllowedPrompts).toHaveLength(2);
      expect(event!.planAllowedPrompts![0]).toEqual({ tool: 'Bash', prompt: 'run tests' });
    });

    it('should handle exit without allowed prompts', () => {
      const stdin = JSON.stringify({
        session_id: 'sess-456',
        transcript_path: '/path/to/transcript.jsonl',
        tool_input: {},
      });

      const event = agent.parseHookEvent('post-plan-exit', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.PlanModeExit);
      expect(event!.planAllowedPrompts).toBeUndefined();
    });

    it('should extract planFilePath from tool_response object', () => {
      const stdin = JSON.stringify({
        session_id: 'sess-456',
        transcript_path: '/path/to/transcript.jsonl',
        tool_input: {},
        tool_response: {
          planFilePath: '/home/user/.claude/plans/my-plan.md',
        },
      });

      const event = agent.parseHookEvent('post-plan-exit', stdin);
      expect(event).not.toBeNull();
      expect(event!.planFilePath).toBe('/home/user/.claude/plans/my-plan.md');
    });

    it('should extract planFilePath from tool_response string message', () => {
      const stdin = JSON.stringify({
        session_id: 'sess-456',
        transcript_path: '/path/to/transcript.jsonl',
        tool_input: {},
        tool_response: 'Your plan has been saved to: /home/user/.claude/plans/my-plan.md',
      });

      const event = agent.parseHookEvent('post-plan-exit', stdin);
      expect(event).not.toBeNull();
      expect(event!.planFilePath).toBe('/home/user/.claude/plans/my-plan.md');
    });

    it('should extract planFilePath from tool_response content field', () => {
      const stdin = JSON.stringify({
        session_id: 'sess-456',
        transcript_path: '/path/to/transcript.jsonl',
        tool_input: {},
        tool_response: {
          content: 'Your plan has been saved to: /home/user/.claude/plans/my-plan.md',
        },
      });

      const event = agent.parseHookEvent('post-plan-exit', stdin);
      expect(event).not.toBeNull();
      expect(event!.planFilePath).toBe('/home/user/.claude/plans/my-plan.md');
    });

    it('should handle missing tool_response for planFilePath', () => {
      const stdin = JSON.stringify({
        session_id: 'sess-456',
        transcript_path: '/path/to/transcript.jsonl',
        tool_input: {},
      });

      const event = agent.parseHookEvent('post-plan-exit', stdin);
      expect(event).not.toBeNull();
      expect(event!.planFilePath).toBeUndefined();
    });
  });

  describe('hookNames', () => {
    it('should include new hook names', () => {
      const names = agent.hookNames();
      expect(names).toContain('post-task-create');
      expect(names).toContain('post-task-update');
      expect(names).toContain('post-plan-enter');
      expect(names).toContain('post-plan-exit');
    });
  });
});

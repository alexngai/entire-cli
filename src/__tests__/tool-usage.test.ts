/**
 * Tests for Tool Usage Tracking
 *
 * Tests the expanded usage tracking system including:
 * - ToolUsageStats type helpers
 * - Claude Code agent hook event parsing for tool use / skill invoke
 * - Transcript-based tool usage extraction
 * - Lifecycle handler processing of new event types
 */

import { describe, it, expect } from 'vitest';
import { emptyToolUsageStats, EventType } from '../types.js';
import {
  extractToolUsageFromTranscript,
  type TranscriptLine,
} from '../agent/agents/claude-code.js';
import { createClaudeCodeAgent } from '../agent/agents/claude-code.js';

describe('Tool Usage Tracking', () => {
  describe('emptyToolUsageStats', () => {
    it('should create empty tool usage stats', () => {
      const stats = emptyToolUsageStats();
      expect(stats.toolCounts).toEqual({});
      expect(stats.totalToolUses).toBe(0);
      expect(stats.skillUses).toEqual([]);
      expect(stats.taskSummaries).toEqual([]);
    });
  });

  describe('Claude Code Agent - parseHookEvent', () => {
    const agent = createClaudeCodeAgent();

    it('should parse post-tool-use as ToolUse event', () => {
      const stdin = JSON.stringify({
        session_id: 'test-session',
        transcript_path: '/tmp/transcript.jsonl',
        tool_name: 'Edit',
        tool_use_id: 'tu_123',
        tool_input: { file_path: '/foo/bar.ts', old_string: 'a', new_string: 'b' },
      });

      const event = agent.parseHookEvent('post-tool-use', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.ToolUse);
      expect(event!.toolName).toBe('Edit');
      expect(event!.sessionID).toBe('test-session');
      expect(event!.toolUseID).toBe('tu_123');
    });

    it('should parse Skill tool use as SkillInvoke event', () => {
      const stdin = JSON.stringify({
        session_id: 'test-session',
        transcript_path: '/tmp/transcript.jsonl',
        tool_name: 'Skill',
        tool_use_id: 'tu_456',
        tool_input: { skill: 'commit', args: '-m "fix bug"' },
      });

      const event = agent.parseHookEvent('post-tool-use', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.SkillInvoke);
      expect(event!.toolName).toBe('Skill');
      expect(event!.skillName).toBe('commit');
      expect(event!.skillArgs).toBe('-m "fix bug"');
    });

    it('should parse Skill tool without args', () => {
      const stdin = JSON.stringify({
        session_id: 'test-session',
        transcript_path: '/tmp/transcript.jsonl',
        tool_name: 'Skill',
        tool_use_id: 'tu_789',
        tool_input: { skill: 'review-pr' },
      });

      const event = agent.parseHookEvent('post-tool-use', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.SkillInvoke);
      expect(event!.skillName).toBe('review-pr');
      expect(event!.skillArgs).toBeUndefined();
    });

    it('should handle various tool names', () => {
      const tools = [
        'Read',
        'Write',
        'Edit',
        'Bash',
        'Grep',
        'Glob',
        'WebFetch',
        'TodoWrite',
        'NotebookEdit',
      ];

      for (const toolName of tools) {
        const stdin = JSON.stringify({
          session_id: 'test-session',
          transcript_path: '/tmp/t.jsonl',
          tool_name: toolName,
          tool_use_id: 'tu_abc',
        });

        const event = agent.parseHookEvent('post-tool-use', stdin);
        expect(event).not.toBeNull();
        expect(event!.type).toBe(EventType.ToolUse);
        expect(event!.toolName).toBe(toolName);
      }
    });

    it('should return null for invalid JSON', () => {
      const event = agent.parseHookEvent('post-tool-use', 'not json');
      expect(event).toBeNull();
    });

    it('should still parse existing hook events correctly', () => {
      const sessionStart = agent.parseHookEvent(
        'session-start',
        JSON.stringify({ session_id: 's1', transcript_path: '/t.jsonl' }),
      );
      expect(sessionStart?.type).toBe(EventType.SessionStart);

      const turnStart = agent.parseHookEvent(
        'user-prompt-submit',
        JSON.stringify({ session_id: 's1', transcript_path: '/t.jsonl', prompt: 'hello' }),
      );
      expect(turnStart?.type).toBe(EventType.TurnStart);

      const turnEnd = agent.parseHookEvent(
        'stop',
        JSON.stringify({ session_id: 's1', transcript_path: '/t.jsonl' }),
      );
      expect(turnEnd?.type).toBe(EventType.TurnEnd);
    });
  });

  describe('extractToolUsageFromTranscript', () => {
    it('should extract tool usage counts from transcript', () => {
      const lines: TranscriptLine[] = [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/foo.ts' } }],
          },
        },
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/foo.ts' } }],
          },
        },
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/bar.ts' } }],
          },
        },
      ];

      const usage = extractToolUsageFromTranscript(lines);
      expect(usage.totalToolUses).toBe(3);
      expect(usage.toolCounts['Read']).toBe(2);
      expect(usage.toolCounts['Edit']).toBe(1);
    });

    it('should detect Skill invocations', () => {
      const lines: TranscriptLine[] = [
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Skill', input: { skill: 'commit', args: '-m "test"' } },
            ],
          },
        },
      ];

      const usage = extractToolUsageFromTranscript(lines);
      expect(usage.totalToolUses).toBe(1);
      expect(usage.toolCounts['Skill']).toBe(1);
      expect(usage.skillUses).toHaveLength(1);
      expect(usage.skillUses[0].skillName).toBe('commit');
      expect(usage.skillUses[0].args).toBe('-m "test"');
    });

    it('should detect Task invocations', () => {
      const lines: TranscriptLine[] = [
        {
          type: 'assistant',
          message: {
            content: [
              {
                type: 'tool_use',
                name: 'Task',
                id: 'tu_abc',
                input: {
                  description: 'Search codebase',
                  subagent_type: 'Explore',
                },
              },
            ],
          },
        },
      ];

      const usage = extractToolUsageFromTranscript(lines);
      expect(usage.totalToolUses).toBe(1);
      expect(usage.toolCounts['Task']).toBe(1);
      expect(usage.taskSummaries).toHaveLength(1);
      expect(usage.taskSummaries[0].description).toBe('Search codebase');
      expect(usage.taskSummaries[0].subagentType).toBe('Explore');
      expect(usage.taskSummaries[0].toolUseID).toBe('tu_abc');
    });

    it('should ignore user messages', () => {
      const lines: TranscriptLine[] = [
        { type: 'user', message: 'hello' },
        {
          type: 'assistant',
          message: {
            content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } }],
          },
        },
      ];

      const usage = extractToolUsageFromTranscript(lines);
      expect(usage.totalToolUses).toBe(1);
    });

    it('should handle empty transcript', () => {
      const usage = extractToolUsageFromTranscript([]);
      expect(usage.totalToolUses).toBe(0);
      expect(usage.toolCounts).toEqual({});
      expect(usage.skillUses).toEqual([]);
      expect(usage.taskSummaries).toEqual([]);
    });

    it('should handle transcript with no tool uses', () => {
      const lines: TranscriptLine[] = [
        {
          type: 'assistant',
          message: {
            content: [{ type: 'text', text: 'Hello, how can I help?' }],
          },
        },
      ];

      const usage = extractToolUsageFromTranscript(lines);
      expect(usage.totalToolUses).toBe(0);
    });

    it('should handle multiple tool uses in a single message', () => {
      const lines: TranscriptLine[] = [
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } },
              { type: 'text', text: 'Looking at this file...' },
              { type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts' } },
            ],
          },
        },
      ];

      const usage = extractToolUsageFromTranscript(lines);
      expect(usage.totalToolUses).toBe(2);
      expect(usage.toolCounts['Read']).toBe(1);
      expect(usage.toolCounts['Edit']).toBe(1);
    });
  });
});

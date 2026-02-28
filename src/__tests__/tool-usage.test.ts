/**
 * Tests for Tool Usage Tracking
 *
 * Tests the transcript-based usage tracking system including:
 * - ToolUsageStats type helpers
 * - Transcript-based tool usage extraction (extractToolUsageFromTranscript)
 * - Agent-level ToolUsageExtractor (extractToolUsage from Buffer)
 * - Existing hook events remain unaffected
 */

import { describe, it, expect } from 'vitest';
import { emptyToolUsageStats, EventType } from '../types.js';
import {
  extractToolUsageFromTranscript,
  createClaudeCodeAgent,
  type TranscriptLine,
} from '../agent/agents/claude-code.js';

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

  describe('Claude Code Agent - existing hooks unaffected', () => {
    const agent = createClaudeCodeAgent();

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

    it('should return null for unknown hook names', () => {
      const event = agent.parseHookEvent(
        'post-tool-use',
        JSON.stringify({ session_id: 's1', tool_name: 'Edit' }),
      );
      expect(event).toBeNull();
    });
  });

  describe('Claude Code Agent - extractToolUsage (ToolUsageExtractor)', () => {
    const agent = createClaudeCodeAgent();

    it('should extract tool usage from JSONL buffer', () => {
      const lines = [
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/a.ts' } }] },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Edit', input: { file_path: '/a.ts' } }] },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Read', input: { file_path: '/b.ts' } }] },
        }),
      ];
      const buf = Buffer.from(lines.join('\n'));

      const usage = agent.extractToolUsage(buf, 0);
      expect(usage.totalToolUses).toBe(3);
      expect(usage.toolCounts['Read']).toBe(2);
      expect(usage.toolCounts['Edit']).toBe(1);
    });

    it('should respect fromOffset', () => {
      const lines = [
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Read', input: {} }] },
        }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'tool_use', name: 'Edit', input: {} }] },
        }),
      ];
      const buf = Buffer.from(lines.join('\n'));

      // Skip first line
      const usage = agent.extractToolUsage(buf, 1);
      expect(usage.totalToolUses).toBe(1);
      expect(usage.toolCounts['Edit']).toBe(1);
      expect(usage.toolCounts['Read']).toBeUndefined();
    });

    it('should return empty stats for empty buffer', () => {
      const usage = agent.extractToolUsage(Buffer.from(''), 0);
      expect(usage.totalToolUses).toBe(0);
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

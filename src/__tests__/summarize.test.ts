/**
 * Tests for Summarize Module
 */

import { describe, it, expect } from 'vitest';
import {
  buildCondensedTranscript,
  buildCondensedTranscriptFromBytes,
  formatCondensedTranscript,
  buildSummarizationPrompt,
  extractJSONFromMarkdown,
  generateFromTranscript,
  type SummarizeInput,
  type SummaryGenerator,
} from '../summarize/summarize.js';
import { AGENT_TYPES } from '../types.js';
import type { TranscriptLine } from '../utils/transcript-parse.js';

describe('Summarize Module', () => {
  describe('buildCondensedTranscript (JSONL)', () => {
    it('should build entries from transcript lines', () => {
      const lines: TranscriptLine[] = [
        {
          type: 'user',
          message: { content: 'Fix the login bug' },
        },
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'text', text: 'I will look at the login module.' },
              {
                type: 'tool_use',
                name: 'Read',
                input: { file_path: 'src/login.ts' },
              },
            ],
          },
        },
      ];

      const entries = buildCondensedTranscript(lines);
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({ type: 'user', content: 'Fix the login bug' });
      expect(entries[1]).toEqual({
        type: 'assistant',
        content: 'I will look at the login module.',
      });
      expect(entries[2]).toEqual({
        type: 'tool',
        toolName: 'Read',
        toolDetail: 'src/login.ts',
      });
    });

    it('should skip skill content injections', () => {
      const lines: TranscriptLine[] = [
        {
          type: 'user',
          message: { content: 'Base directory for this skill: /some/path' },
        },
        {
          type: 'user',
          message: { content: 'Real user message' },
        },
      ];

      const entries = buildCondensedTranscript(lines);
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe('Real user message');
    });

    it('should handle empty lines', () => {
      const entries = buildCondensedTranscript([]);
      expect(entries).toHaveLength(0);
    });

    it('should extract tool details for different tools', () => {
      const lines: TranscriptLine[] = [
        {
          type: 'assistant',
          message: {
            content: [
              { type: 'tool_use', name: 'Bash', input: { command: 'npm test' } },
              { type: 'tool_use', name: 'WebFetch', input: { url: 'https://example.com' } },
              { type: 'tool_use', name: 'Skill', input: { skill: 'commit' } },
              { type: 'tool_use', name: 'Glob', input: { pattern: '**/*.ts' } },
            ],
          },
        },
      ];

      const entries = buildCondensedTranscript(lines);
      const toolEntries = entries.filter((e) => e.type === 'tool');
      expect(toolEntries).toHaveLength(4);
      expect(toolEntries[0].toolDetail).toBe('npm test');
      expect(toolEntries[1].toolDetail).toBe('https://example.com');
      expect(toolEntries[2].toolDetail).toBe('commit');
      expect(toolEntries[3].toolDetail).toBe('**/*.ts');
    });
  });

  describe('buildCondensedTranscriptFromBytes', () => {
    it('should handle Claude Code JSONL format', () => {
      const jsonl = [
        JSON.stringify({ type: 'user', message: { content: 'Hello' } }),
        JSON.stringify({
          type: 'assistant',
          message: { content: [{ type: 'text', text: 'Hi' }] },
        }),
      ].join('\n');

      const entries = buildCondensedTranscriptFromBytes(
        Buffer.from(jsonl),
        AGENT_TYPES.CLAUDE_CODE,
      );
      expect(entries).toHaveLength(2);
      expect(entries[0].type).toBe('user');
      expect(entries[1].type).toBe('assistant');
    });

    it('should handle Gemini JSON format', () => {
      const data = JSON.stringify({
        messages: [
          { type: 'user', content: 'Fix it' },
          {
            type: 'gemini',
            content: 'Fixed!',
            toolCalls: [{ name: 'edit_file', args: { path: 'app.ts' } }],
          },
        ],
      });

      const entries = buildCondensedTranscriptFromBytes(data, AGENT_TYPES.GEMINI);
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({ type: 'user', content: 'Fix it' });
      expect(entries[1]).toEqual({ type: 'assistant', content: 'Fixed!' });
      expect(entries[2].type).toBe('tool');
      expect(entries[2].toolName).toBe('edit_file');
    });

    it('should handle OpenCode JSON format', () => {
      const data = JSON.stringify({
        messages: [
          {
            info: { role: 'user' },
            parts: [{ type: 'text', text: 'Add tests' }],
          },
          {
            info: { role: 'assistant' },
            parts: [
              { type: 'text', text: 'Adding tests now.' },
              {
                type: 'tool',
                tool: 'write',
                state: { input: { filePath: 'test.ts' } },
              },
            ],
          },
        ],
      });

      const entries = buildCondensedTranscriptFromBytes(data, AGENT_TYPES.OPENCODE);
      expect(entries).toHaveLength(3);
      expect(entries[0]).toEqual({ type: 'user', content: 'Add tests' });
      expect(entries[1]).toEqual({ type: 'assistant', content: 'Adding tests now.' });
      expect(entries[2].type).toBe('tool');
      expect(entries[2].toolName).toBe('write');
    });

    it('should handle Gemini array content', () => {
      const data = JSON.stringify({
        messages: [
          {
            type: 'gemini',
            content: [{ text: 'Part 1' }, { text: 'Part 2' }],
          },
        ],
      });

      const entries = buildCondensedTranscriptFromBytes(data, AGENT_TYPES.GEMINI);
      expect(entries).toHaveLength(1);
      expect(entries[0].content).toBe('Part 1\nPart 2');
    });

    it('should handle invalid JSON gracefully for Gemini', () => {
      const entries = buildCondensedTranscriptFromBytes('not json', AGENT_TYPES.GEMINI);
      expect(entries).toHaveLength(0);
    });

    it('should handle invalid JSON gracefully for OpenCode', () => {
      const entries = buildCondensedTranscriptFromBytes('not json', AGENT_TYPES.OPENCODE);
      expect(entries).toHaveLength(0);
    });
  });

  describe('formatCondensedTranscript', () => {
    it('should format entries with correct prefixes', () => {
      const input: SummarizeInput = {
        transcript: [
          { type: 'user', content: 'Fix it' },
          { type: 'assistant', content: 'On it.' },
          { type: 'tool', toolName: 'Edit', toolDetail: 'src/app.ts' },
        ],
        filesTouched: [],
      };

      const result = formatCondensedTranscript(input);
      expect(result).toContain('[User] Fix it');
      expect(result).toContain('[Assistant] On it.');
      expect(result).toContain('[Tool] Edit: src/app.ts');
    });

    it('should format tool without detail', () => {
      const input: SummarizeInput = {
        transcript: [{ type: 'tool', toolName: 'Bash' }],
        filesTouched: [],
      };

      const result = formatCondensedTranscript(input);
      expect(result).toContain('[Tool] Bash');
      expect(result).not.toContain(':');
    });

    it('should include files modified section', () => {
      const input: SummarizeInput = {
        transcript: [{ type: 'user', content: 'Hello' }],
        filesTouched: ['src/app.ts', 'src/utils.ts'],
      };

      const result = formatCondensedTranscript(input);
      expect(result).toContain('[Files Modified]');
      expect(result).toContain('- src/app.ts');
      expect(result).toContain('- src/utils.ts');
    });

    it('should not include files section when empty', () => {
      const input: SummarizeInput = {
        transcript: [{ type: 'user', content: 'Hello' }],
        filesTouched: [],
      };

      const result = formatCondensedTranscript(input);
      expect(result).not.toContain('[Files Modified]');
    });
  });

  describe('buildSummarizationPrompt', () => {
    it('should embed transcript text', () => {
      const prompt = buildSummarizationPrompt('Hello world');
      expect(prompt).toContain('<transcript>');
      expect(prompt).toContain('Hello world');
      expect(prompt).toContain('</transcript>');
      expect(prompt).toContain('intent');
      expect(prompt).toContain('outcome');
    });
  });

  describe('extractJSONFromMarkdown', () => {
    it('should extract JSON from ```json block', () => {
      const input = '```json\n{"key": "value"}\n```';
      expect(extractJSONFromMarkdown(input)).toBe('{"key": "value"}');
    });

    it('should extract JSON from ``` block', () => {
      const input = '```\n{"key": "value"}\n```';
      expect(extractJSONFromMarkdown(input)).toBe('{"key": "value"}');
    });

    it('should return raw JSON when no code block', () => {
      const input = '{"key": "value"}';
      expect(extractJSONFromMarkdown(input)).toBe('{"key": "value"}');
    });

    it('should handle whitespace', () => {
      const input = '  \n```json\n{"key": "value"}\n```  \n';
      expect(extractJSONFromMarkdown(input)).toBe('{"key": "value"}');
    });
  });

  describe('generateFromTranscript', () => {
    it('should throw for empty transcript', async () => {
      const generator: SummaryGenerator = {
        generate: async () => ({
          intent: '',
          outcome: '',
          learnings: { repo: [], code: [], workflow: [] },
          friction: [],
          openItems: [],
        }),
      };

      await expect(
        generateFromTranscript('', [], AGENT_TYPES.CLAUDE_CODE, generator),
      ).rejects.toThrow('empty transcript');
    });

    it('should throw for transcript with no parseable content', async () => {
      const generator: SummaryGenerator = {
        generate: async () => ({
          intent: '',
          outcome: '',
          learnings: { repo: [], code: [], workflow: [] },
          friction: [],
          openItems: [],
        }),
      };

      // JSONL with no valid lines
      await expect(
        generateFromTranscript('invalid json\n', [], AGENT_TYPES.CLAUDE_CODE, generator),
      ).rejects.toThrow('no content');
    });

    it('should call generator with condensed transcript', async () => {
      let capturedInput: SummarizeInput | null = null;
      const generator: SummaryGenerator = {
        generate: async (input) => {
          capturedInput = input;
          return {
            intent: 'Test intent',
            outcome: 'Test outcome',
            learnings: { repo: [], code: [], workflow: [] },
            friction: [],
            openItems: [],
          };
        },
      };

      const jsonl = JSON.stringify({
        type: 'user',
        message: { content: 'Fix the bug' },
      });

      const result = await generateFromTranscript(
        jsonl,
        ['src/app.ts'],
        AGENT_TYPES.CLAUDE_CODE,
        generator,
      );

      expect(result.intent).toBe('Test intent');
      expect(capturedInput).not.toBeNull();
      expect(capturedInput!.transcript.length).toBeGreaterThan(0);
      expect(capturedInput!.filesTouched).toEqual(['src/app.ts']);
    });
  });
});

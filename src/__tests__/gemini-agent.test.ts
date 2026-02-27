/**
 * Tests for Gemini CLI Agent
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createGeminiCLIAgent, parseGeminiTranscript } from '../agent/agents/gemini-cli.js';
import { EventType } from '../types.js';

describe('Gemini CLI Agent', () => {
  const agent = createGeminiCLIAgent();

  describe('basic properties', () => {
    it('should have correct name and type', () => {
      expect(agent.name).toBe('gemini');
      expect(agent.type).toBe('Gemini CLI');
      expect(agent.isPreview).toBe(true);
    });

    it('should protect .gemini directory', () => {
      expect(agent.protectedDirs).toContain('.gemini');
    });
  });

  describe('detectPresence', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should detect presence when .gemini dir exists', async () => {
      fs.mkdirSync(path.join(tmpDir, '.gemini'));
      expect(await agent.detectPresence(tmpDir)).toBe(true);
    });

    it('should return false when .gemini dir does not exist', async () => {
      expect(await agent.detectPresence(tmpDir)).toBe(false);
    });
  });

  describe('formatResumeCommand', () => {
    it('should include session ID', () => {
      const cmd = agent.formatResumeCommand('sess-123');
      expect(cmd).toContain('sess-123');
      expect(cmd).toContain('gemini');
    });
  });

  describe('hookNames', () => {
    it('should return all 11 hooks', () => {
      const names = agent.hookNames();
      expect(names).toHaveLength(11);
      expect(names).toContain('session-start');
      expect(names).toContain('session-end');
      expect(names).toContain('before-agent');
      expect(names).toContain('after-agent');
      expect(names).toContain('before-model');
      expect(names).toContain('after-model');
      expect(names).toContain('pre-compress');
    });
  });

  describe('parseHookEvent', () => {
    it('should parse session-start event', () => {
      const stdin = JSON.stringify({ session_id: 'gem-123' });
      const event = agent.parseHookEvent('session-start', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.SessionStart);
      expect(event!.sessionID).toBe('gem-123');
    });

    it('should parse before-agent as TurnStart', () => {
      const stdin = JSON.stringify({
        session_id: 'gem-456',
        prompt: 'Add a function',
      });
      const event = agent.parseHookEvent('before-agent', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.TurnStart);
    });

    it('should parse after-agent as TurnEnd', () => {
      const stdin = JSON.stringify({ session_id: 'gem-789' });
      const event = agent.parseHookEvent('after-agent', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.TurnEnd);
    });

    it('should parse pre-compress as Compaction', () => {
      const stdin = JSON.stringify({ session_id: 'gem-111' });
      const event = agent.parseHookEvent('pre-compress', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.Compaction);
    });

    it('should return null for pass-through hooks', () => {
      const stdin = JSON.stringify({ session_id: 'gem-222' });
      expect(agent.parseHookEvent('before-tool', stdin)).toBeNull();
      expect(agent.parseHookEvent('after-tool', stdin)).toBeNull();
      expect(agent.parseHookEvent('before-model', stdin)).toBeNull();
      expect(agent.parseHookEvent('notification', stdin)).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      expect(agent.parseHookEvent('session-start', 'bad')).toBeNull();
    });
  });

  describe('parseGeminiTranscript', () => {
    it('should parse string content', () => {
      const data = JSON.stringify({
        messages: [
          { type: 'user', content: 'Hello' },
          { type: 'gemini', content: 'Hi there' },
        ],
      });

      const transcript = parseGeminiTranscript(data);
      expect(transcript.messages).toHaveLength(2);
      expect(transcript.messages[0].content).toBe('Hello');
      expect(transcript.messages[1].content).toBe('Hi there');
    });

    it('should parse array content (text parts)', () => {
      const data = JSON.stringify({
        messages: [
          {
            type: 'gemini',
            content: [{ text: 'Part 1' }, { text: 'Part 2' }],
          },
        ],
      });

      const transcript = parseGeminiTranscript(data);
      expect(transcript.messages[0].content).toBe('Part 1\nPart 2');
    });

    it('should handle empty messages array', () => {
      const data = JSON.stringify({ messages: [] });
      const transcript = parseGeminiTranscript(data);
      expect(transcript.messages).toHaveLength(0);
    });

    it('should preserve tool calls', () => {
      const data = JSON.stringify({
        messages: [
          {
            type: 'gemini',
            content: 'Working on it...',
            toolCalls: [{ id: 'tc1', name: 'edit_file', args: { path: 'foo.ts' } }],
          },
        ],
      });

      const transcript = parseGeminiTranscript(data);
      expect(transcript.messages[0].toolCalls).toHaveLength(1);
      expect(transcript.messages[0].toolCalls![0].name).toBe('edit_file');
    });
  });

  describe('hook installation', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-hooks-'));
      fs.mkdirSync(path.join(tmpDir, '.gemini'), { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should install hooks to .gemini/settings.json', async () => {
      const count = await agent.installHooks(tmpDir);
      expect(count).toBe(12);

      const settingsPath = path.join(tmpDir, '.gemini', 'settings.json');
      const settings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'));
      expect(settings.hooksConfig.enabled).toBe(true);
      expect(settings.hooks).toBeDefined();
    });

    it('should be idempotent', async () => {
      await agent.installHooks(tmpDir);
      const count = await agent.installHooks(tmpDir);
      expect(count).toBe(0);
    });

    it('should report hooks as installed', async () => {
      expect(await agent.areHooksInstalled(tmpDir)).toBe(false);
      await agent.installHooks(tmpDir);
      expect(await agent.areHooksInstalled(tmpDir)).toBe(true);
    });

    it('should uninstall hooks', async () => {
      await agent.installHooks(tmpDir);
      await agent.uninstallHooks(tmpDir);
      expect(await agent.areHooksInstalled(tmpDir)).toBe(false);
    });
  });

  describe('TranscriptAnalyzer', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gemini-transcript-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should get transcript position', async () => {
      const transcriptPath = path.join(tmpDir, 'session.json');
      fs.writeFileSync(
        transcriptPath,
        JSON.stringify({
          messages: [
            { type: 'user', content: 'Hello' },
            { type: 'gemini', content: 'Hi' },
            { type: 'user', content: 'Thanks' },
          ],
        }),
      );

      const pos = await agent.getTranscriptPosition(transcriptPath);
      expect(pos).toBe(3);
    });

    it('should extract modified files from offset', async () => {
      const transcriptPath = path.join(tmpDir, 'session.json');
      fs.writeFileSync(
        transcriptPath,
        JSON.stringify({
          messages: [
            { type: 'user', content: 'Fix the file' },
            {
              type: 'gemini',
              content: 'Done',
              toolCalls: [
                { id: 'tc1', name: 'edit_file', args: { file_path: 'src/app.ts' } },
                { id: 'tc2', name: 'write_file', args: { path: 'src/utils.ts' } },
              ],
            },
          ],
        }),
      );

      const result = await agent.extractModifiedFilesFromOffset(transcriptPath, 0);
      expect(result.files).toContain('src/app.ts');
      expect(result.files).toContain('src/utils.ts');
      expect(result.currentPosition).toBe(2);
    });

    it('should extract prompts from offset', async () => {
      const transcriptPath = path.join(tmpDir, 'session.json');
      fs.writeFileSync(
        transcriptPath,
        JSON.stringify({
          messages: [
            { type: 'user', content: 'First prompt' },
            { type: 'gemini', content: 'Response' },
            { type: 'user', content: 'Second prompt' },
          ],
        }),
      );

      const prompts = await agent.extractPrompts(transcriptPath, 0);
      expect(prompts).toEqual(['First prompt', 'Second prompt']);
    });

    it('should extract prompts from specific offset', async () => {
      const transcriptPath = path.join(tmpDir, 'session.json');
      fs.writeFileSync(
        transcriptPath,
        JSON.stringify({
          messages: [
            { type: 'user', content: 'Old prompt' },
            { type: 'gemini', content: 'Response' },
            { type: 'user', content: 'New prompt' },
          ],
        }),
      );

      const prompts = await agent.extractPrompts(transcriptPath, 2);
      expect(prompts).toEqual(['New prompt']);
    });

    it('should extract last assistant response as summary', async () => {
      const transcriptPath = path.join(tmpDir, 'session.json');
      fs.writeFileSync(
        transcriptPath,
        JSON.stringify({
          messages: [
            { type: 'user', content: 'Do something' },
            { type: 'gemini', content: 'First response' },
            { type: 'user', content: 'More' },
            { type: 'gemini', content: 'Final response' },
          ],
        }),
      );

      const summary = await agent.extractSummary(transcriptPath);
      expect(summary).toBe('Final response');
    });
  });

  describe('TokenCalculator', () => {
    it('should calculate token usage from transcript', async () => {
      const data = Buffer.from(
        JSON.stringify({
          messages: [
            { type: 'user', content: 'Hello' },
            { type: 'gemini', content: 'Hi', tokens: { input: 100, output: 50, cached: 10 } },
            { type: 'user', content: 'More' },
            { type: 'gemini', content: 'Done', tokens: { input: 200, output: 100, cached: 20 } },
          ],
        }),
      );

      const usage = await agent.calculateTokenUsage(data, 0);
      expect(usage.inputTokens).toBe(300);
      expect(usage.outputTokens).toBe(150);
      expect(usage.cacheReadTokens).toBe(30);
      expect(usage.apiCallCount).toBe(2);
    });

    it('should calculate from offset', async () => {
      const data = Buffer.from(
        JSON.stringify({
          messages: [
            { type: 'gemini', content: 'Old', tokens: { input: 100, output: 50, cached: 0 } },
            { type: 'gemini', content: 'New', tokens: { input: 200, output: 100, cached: 0 } },
          ],
        }),
      );

      const usage = await agent.calculateTokenUsage(data, 1);
      expect(usage.inputTokens).toBe(200);
      expect(usage.outputTokens).toBe(100);
      expect(usage.apiCallCount).toBe(1);
    });
  });

  describe('TranscriptChunker', () => {
    it('should chunk large transcripts', async () => {
      const messages = Array.from({ length: 50 }, (_, i) => ({
        type: i % 2 === 0 ? 'user' : 'gemini',
        content: 'x'.repeat(100),
      }));
      const content = Buffer.from(JSON.stringify({ messages }));
      const chunks = await agent.chunkTranscript(content, 500);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should reassemble chunks back', async () => {
      const messages = [
        { type: 'user', content: 'Hello' },
        { type: 'gemini', content: 'World' },
      ];
      const content = Buffer.from(JSON.stringify({ messages }));
      const chunks = await agent.chunkTranscript(content, 50);
      const reassembled = await agent.reassembleTranscript(chunks);
      const parsed = JSON.parse(reassembled.toString('utf-8'));
      expect(parsed.messages).toHaveLength(2);
    });
  });
});

/**
 * Tests for Cursor Agent
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createCursorAgent } from '../agent/agents/cursor.js';
import { EventType } from '../types.js';

describe('Cursor Agent', () => {
  const agent = createCursorAgent();

  describe('basic properties', () => {
    it('should have correct name and type', () => {
      expect(agent.name).toBe('cursor');
      expect(agent.type).toBe('Cursor IDE');
      expect(agent.isPreview).toBe(true);
    });

    it('should protect .cursor directory', () => {
      expect(agent.protectedDirs).toContain('.cursor');
    });
  });

  describe('detectPresence', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should detect presence when .cursor dir exists', async () => {
      fs.mkdirSync(path.join(tmpDir, '.cursor'));
      expect(await agent.detectPresence(tmpDir)).toBe(true);
    });

    it('should return false when .cursor dir does not exist', async () => {
      expect(await agent.detectPresence(tmpDir)).toBe(false);
    });
  });

  describe('resolveSessionFile', () => {
    it('should resolve to JSONL file', () => {
      const result = agent.resolveSessionFile('/sessions', 'abc123');
      expect(result).toBe(path.join('/sessions', 'abc123.jsonl'));
    });
  });

  describe('formatResumeCommand', () => {
    it('should return Cursor-specific message', () => {
      const cmd = agent.formatResumeCommand('test-session');
      expect(cmd).toContain('Cursor');
    });
  });

  describe('hookNames', () => {
    it('should return all expected hooks', () => {
      const names = agent.hookNames();
      expect(names).toContain('session-start');
      expect(names).toContain('session-end');
      expect(names).toContain('before-submit-prompt');
      expect(names).toContain('stop');
      expect(names).toContain('pre-compact');
      expect(names).toContain('subagent-start');
      expect(names).toContain('subagent-stop');
      expect(names).toHaveLength(7);
    });
  });

  describe('parseHookEvent', () => {
    it('should parse session-start event', () => {
      const stdin = JSON.stringify({
        conversation_id: 'conv-123',
        transcript_path: '/path/to/transcript',
      });

      const event = agent.parseHookEvent('session-start', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.SessionStart);
      expect(event!.sessionID).toBe('conv-123');
      expect(event!.sessionRef).toBe('/path/to/transcript');
    });

    it('should parse before-submit-prompt event with prompt', () => {
      const stdin = JSON.stringify({
        conversation_id: 'conv-123',
        prompt: 'Fix the bug',
      });

      const event = agent.parseHookEvent('before-submit-prompt', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.TurnStart);
      expect((event as any).prompt).toBe('Fix the bug');
    });

    it('should parse stop as TurnEnd', () => {
      const stdin = JSON.stringify({ conversation_id: 'conv-456' });
      const event = agent.parseHookEvent('stop', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.TurnEnd);
    });

    it('should parse session-end event', () => {
      const stdin = JSON.stringify({ conversation_id: 'conv-789' });
      const event = agent.parseHookEvent('session-end', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.SessionEnd);
    });

    it('should parse pre-compact as Compaction', () => {
      const stdin = JSON.stringify({ conversation_id: 'conv-111' });
      const event = agent.parseHookEvent('pre-compact', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.Compaction);
    });

    it('should parse subagent-start event', () => {
      const stdin = JSON.stringify({
        conversation_id: 'conv-222',
        subagent_id: 'sub-1',
        subagent_type: 'researcher',
        task: 'Search codebase',
      });

      const event = agent.parseHookEvent('subagent-start', stdin);
      expect(event).not.toBeNull();
      expect(event!.type).toBe(EventType.SubagentStart);
    });

    it('should return null for subagent-start without task', () => {
      const stdin = JSON.stringify({ conversation_id: 'conv-333' });
      const event = agent.parseHookEvent('subagent-start', stdin);
      expect(event).toBeNull();
    });

    it('should return null for unknown hook', () => {
      const event = agent.parseHookEvent('unknown-hook', '{}');
      expect(event).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      const event = agent.parseHookEvent('session-start', 'not-json');
      expect(event).toBeNull();
    });
  });

  describe('hook installation', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cursor-hooks-'));
      fs.mkdirSync(path.join(tmpDir, '.cursor'), { recursive: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should install hooks to .cursor/hooks.json', async () => {
      const count = await agent.installHooks(tmpDir);
      expect(count).toBe(7);

      const hooksPath = path.join(tmpDir, '.cursor', 'hooks.json');
      const content = JSON.parse(fs.readFileSync(hooksPath, 'utf-8'));
      expect(content.version).toBe(1);
      expect(content.hooks).toBeDefined();
    });

    it('should be idempotent (no reinstall)', async () => {
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

  describe('chunkTranscript', () => {
    it('should return single chunk when under max size', async () => {
      const content = Buffer.from('{"line":1}\n{"line":2}\n');
      const chunks = await agent.chunkTranscript(content, 1000);
      expect(chunks).toHaveLength(1);
    });

    it('should split large content into chunks', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 100; i++) {
        lines.push(JSON.stringify({ line: i, data: 'x'.repeat(50) }));
      }
      const content = Buffer.from(lines.join('\n') + '\n');
      const chunks = await agent.chunkTranscript(content, 500);
      expect(chunks.length).toBeGreaterThan(1);
    });

    it('should reassemble chunks back to original', async () => {
      const lines: string[] = [];
      for (let i = 0; i < 10; i++) {
        lines.push(JSON.stringify({ line: i }));
      }
      const content = Buffer.from(lines.join('\n') + '\n');
      const chunks = await agent.chunkTranscript(content, 100);
      const reassembled = await agent.reassembleTranscript(chunks);
      // The reassembled result should contain all original lines
      expect(reassembled.toString('utf-8')).toContain('"line":0');
      expect(reassembled.toString('utf-8')).toContain('"line":9');
    });
  });
});

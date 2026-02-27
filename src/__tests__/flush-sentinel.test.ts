/**
 * Tests for prepareTranscript flush sentinel (Claude Code agent)
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { createClaudeCodeAgent } from '../agent/agents/claude-code.js';
import { hasTranscriptPreparer } from '../agent/types.js';

describe('Claude Code prepareTranscript', () => {
  let tmpDir: string;
  const agent = createClaudeCodeAgent();

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flush-sentinel-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('should implement TranscriptPreparer', () => {
    expect(hasTranscriptPreparer(agent)).toBe(true);
  });

  it('should resolve quickly when sentinel is present', async () => {
    const transcriptPath = path.join(tmpDir, 'session.jsonl');
    const now = new Date().toISOString();

    // Write a transcript with the stop hook sentinel
    const lines = [
      JSON.stringify({ type: 'user', message: { content: 'hello' }, timestamp: now }),
      JSON.stringify({
        type: 'assistant',
        message: { content: [{ type: 'text', text: 'hi' }] },
        timestamp: now,
      }),
      JSON.stringify({ type: 'hook_progress', message: 'hooks claude-code stop', timestamp: now }),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const start = Date.now();
    await agent.prepareTranscript(transcriptPath);
    const elapsed = Date.now() - start;

    // Should find sentinel quickly (well under the 3s timeout)
    expect(elapsed).toBeLessThan(1000);
  });

  it('should timeout gracefully when sentinel is missing', async () => {
    const transcriptPath = path.join(tmpDir, 'session.jsonl');

    // Write transcript WITHOUT sentinel
    const lines = [
      JSON.stringify({
        type: 'user',
        message: { content: 'hello' },
        timestamp: new Date().toISOString(),
      }),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const start = Date.now();
    await agent.prepareTranscript(transcriptPath);
    const elapsed = Date.now() - start;

    // Should wait up to ~3s then proceed
    expect(elapsed).toBeGreaterThanOrEqual(2500);
    expect(elapsed).toBeLessThan(5000);
  }, 10000);

  it('should timeout gracefully when file does not exist', async () => {
    const start = Date.now();
    await agent.prepareTranscript(path.join(tmpDir, 'nonexistent.jsonl'));
    const elapsed = Date.now() - start;

    // Should wait up to ~3s then proceed
    expect(elapsed).toBeGreaterThanOrEqual(2500);
    expect(elapsed).toBeLessThan(5000);
  }, 10000);

  it('should ignore sentinel with old timestamp', async () => {
    const transcriptPath = path.join(tmpDir, 'session.jsonl');

    // Write a sentinel with a very old timestamp
    const oldTimestamp = new Date(Date.now() - 60_000).toISOString();
    const lines = [
      JSON.stringify({
        type: 'hook_progress',
        message: 'hooks claude-code stop',
        timestamp: oldTimestamp,
      }),
    ];
    fs.writeFileSync(transcriptPath, lines.join('\n') + '\n');

    const start = Date.now();
    await agent.prepareTranscript(transcriptPath);
    const elapsed = Date.now() - start;

    // Old sentinel should be ignored, so we should timeout
    expect(elapsed).toBeGreaterThanOrEqual(2500);
  }, 10000);
});

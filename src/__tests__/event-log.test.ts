/**
 * Tests for the event log module (JSONL checkpoint event log).
 *
 * Covers:
 * - appendCheckpointEvent writes valid JSONL
 * - readCheckpointEvents returns events in order
 * - Pruning with maxEvents keeps only the last N
 * - Missing file returns empty array
 * - Exports from the main index
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  appendCheckpointEvent,
  readCheckpointEvents,
  type CheckpointEvent,
} from '../events/event-log.js';
import { SESSIONLOG_EVENTS_FILE } from '../types.js';

// Also verify re-exports from main index
import {
  appendCheckpointEvent as indexAppend,
  readCheckpointEvents as indexRead,
  SESSIONLOG_EVENTS_FILE as indexEventsFile,
} from '../index.js';

describe('event-log', () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sessionlog-events-'));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  function makeEvent(id: string, overrides?: Partial<CheckpointEvent>): CheckpointEvent {
    return {
      type: 'checkpoint_committed',
      timestamp: new Date().toISOString(),
      checkpointID: id,
      sessionID: 'sess-1',
      agent: 'Claude Code',
      filesTouched: ['src/app.ts'],
      checkpointsCount: 1,
      ...overrides,
    };
  }

  function eventsFilePath(): string {
    return path.join(tmpDir, SESSIONLOG_EVENTS_FILE);
  }

  describe('appendCheckpointEvent', () => {
    it('should create the events file and write a JSONL line', async () => {
      const event = makeEvent('cp-001');
      await appendCheckpointEvent(tmpDir, event);

      const raw = fs.readFileSync(eventsFilePath(), 'utf-8');
      const lines = raw.trim().split('\n');
      expect(lines).toHaveLength(1);

      const parsed = JSON.parse(lines[0]);
      expect(parsed.type).toBe('checkpoint_committed');
      expect(parsed.checkpointID).toBe('cp-001');
      expect(parsed.agent).toBe('Claude Code');
    });

    it('should append multiple events as separate lines', async () => {
      await appendCheckpointEvent(tmpDir, makeEvent('cp-001'));
      await appendCheckpointEvent(tmpDir, makeEvent('cp-002'));
      await appendCheckpointEvent(tmpDir, makeEvent('cp-003'));

      const raw = fs.readFileSync(eventsFilePath(), 'utf-8');
      const lines = raw.trim().split('\n');
      expect(lines).toHaveLength(3);
      expect(JSON.parse(lines[0]).checkpointID).toBe('cp-001');
      expect(JSON.parse(lines[2]).checkpointID).toBe('cp-003');
    });

    it('should include optional fields when present', async () => {
      const event = makeEvent('cp-001', {
        branch: 'feature/auth',
        tokenUsage: {
          inputTokens: 5000,
          outputTokens: 1200,
          cacheCreationTokens: 0,
          cacheReadTokens: 3000,
          apiCallCount: 8,
        },
      });
      await appendCheckpointEvent(tmpDir, event);

      const events = readCheckpointEvents(tmpDir);
      expect(events[0].branch).toBe('feature/auth');
      expect(events[0].tokenUsage?.inputTokens).toBe(5000);
    });
  });

  describe('readCheckpointEvents', () => {
    it('should return empty array for missing file', () => {
      const events = readCheckpointEvents(tmpDir);
      expect(events).toEqual([]);
    });

    it('should return events in chronological order', async () => {
      await appendCheckpointEvent(tmpDir, makeEvent('cp-001'));
      await appendCheckpointEvent(tmpDir, makeEvent('cp-002'));

      const events = readCheckpointEvents(tmpDir);
      expect(events).toHaveLength(2);
      expect(events[0].checkpointID).toBe('cp-001');
      expect(events[1].checkpointID).toBe('cp-002');
    });

    it('should skip malformed lines', async () => {
      // Write a valid line, a bad line, and another valid line
      const filePath = eventsFilePath();
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify(makeEvent('cp-001')) +
          '\n' +
          'not valid json\n' +
          JSON.stringify(makeEvent('cp-002')) +
          '\n',
      );

      const events = readCheckpointEvents(tmpDir);
      expect(events).toHaveLength(2);
      expect(events[0].checkpointID).toBe('cp-001');
      expect(events[1].checkpointID).toBe('cp-002');
    });
  });

  describe('pruning with maxEvents', () => {
    it('should keep only the last N events', async () => {
      for (let i = 1; i <= 5; i++) {
        await appendCheckpointEvent(tmpDir, makeEvent(`cp-${String(i).padStart(3, '0')}`), {
          maxEvents: 3,
        });
      }

      const events = readCheckpointEvents(tmpDir);
      expect(events).toHaveLength(3);
      expect(events[0].checkpointID).toBe('cp-003');
      expect(events[1].checkpointID).toBe('cp-004');
      expect(events[2].checkpointID).toBe('cp-005');
    });

    it('should not prune when maxEvents is 0', async () => {
      for (let i = 1; i <= 5; i++) {
        await appendCheckpointEvent(tmpDir, makeEvent(`cp-${String(i).padStart(3, '0')}`), {
          maxEvents: 0,
        });
      }

      const events = readCheckpointEvents(tmpDir);
      expect(events).toHaveLength(5);
    });

    it('should not prune when maxEvents is undefined', async () => {
      for (let i = 1; i <= 5; i++) {
        await appendCheckpointEvent(tmpDir, makeEvent(`cp-${String(i).padStart(3, '0')}`));
      }

      const events = readCheckpointEvents(tmpDir);
      expect(events).toHaveLength(5);
    });
  });

  describe('exports', () => {
    it('should export from main index', () => {
      expect(indexAppend).toBe(appendCheckpointEvent);
      expect(indexRead).toBe(readCheckpointEvents);
      expect(indexEventsFile).toBe(SESSIONLOG_EVENTS_FILE);
    });
  });
});

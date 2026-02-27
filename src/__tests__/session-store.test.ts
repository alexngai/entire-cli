/**
 * Tests for Session Store Normalization
 */

import { describe, it, expect } from 'vitest';
import { normalizeSessionState } from '../store/session-store.js';

describe('Session Store', () => {
  describe('normalizeSessionState', () => {
    it('should normalize standard fields', () => {
      const state = normalizeSessionState('test-id', {
        sessionID: 'test-id',
        baseCommit: 'abc123',
        startedAt: '2026-02-13T12:00:00Z',
        phase: 'active',
        agentType: 'Claude Code',
        filesTouched: ['src/app.ts'],
        stepCount: 3,
      });

      expect(state.sessionID).toBe('test-id');
      expect(state.baseCommit).toBe('abc123');
      expect(state.phase).toBe('active');
      expect(state.agentType).toBe('Claude Code');
      expect(state.filesTouched).toEqual(['src/app.ts']);
      expect(state.stepCount).toBe(3);
    });

    it('should handle alternative field names', () => {
      const state = normalizeSessionState('alt-id', {
        session_id: 'alt-id',
        base_commit: 'def456',
        started_at: '2026-02-13T12:00:00Z',
        state: 'ACTIVE',
        agent: 'Cursor IDE',
      });

      expect(state.sessionID).toBe('alt-id');
      expect(state.phase).toBe('active');
      expect(state.agentType).toBe('Cursor IDE');
    });

    it('should normalize phase values', () => {
      expect(normalizeSessionState('id', { phase: 'ACTIVE' }).phase).toBe('active');
      expect(normalizeSessionState('id', { phase: 'IDLE' }).phase).toBe('idle');
      expect(normalizeSessionState('id', { phase: 'ENDED' }).phase).toBe('ended');
      expect(normalizeSessionState('id', { phase: 'unknown' }).phase).toBe('idle');
      expect(normalizeSessionState('id', {}).phase).toBe('idle');
    });

    it('should default missing arrays to empty', () => {
      const state = normalizeSessionState('id', {});
      expect(state.filesTouched).toEqual([]);
      expect(state.turnCheckpointIDs).toEqual([]);
      expect(state.untrackedFilesAtStart).toEqual([]);
    });

    it('should default missing numbers to 0', () => {
      const state = normalizeSessionState('id', {});
      expect(state.stepCount).toBe(0);
      expect(state.checkpointTranscriptStart).toBe(0);
    });

    it('should use id parameter as fallback for sessionID', () => {
      const state = normalizeSessionState('fallback-id', {});
      expect(state.sessionID).toBe('fallback-id');
    });

    it('should preserve optional fields when present', () => {
      const state = normalizeSessionState('id', {
        firstPrompt: 'Build a REST API',
        transcriptPath: '/path/to/transcript.jsonl',
        endedAt: '2026-02-13T13:00:00Z',
        worktreeID: 'main',
      });

      expect(state.firstPrompt).toBe('Build a REST API');
      expect(state.transcriptPath).toBe('/path/to/transcript.jsonl');
      expect(state.endedAt).toBe('2026-02-13T13:00:00Z');
      expect(state.worktreeID).toBe('main');
    });
  });
});

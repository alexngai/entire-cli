/**
 * Tests for CheckpointCommittedEvent type and exports.
 *
 * Verifies that the event type is correctly exported and that the callback
 * contract works as expected for MAP session sync integration.
 */

import { describe, it, expect } from 'vitest';
import type { CheckpointCommittedEvent, ManualCommitStrategyConfig } from '../strategy/manual-commit.js';

// Also verify it's re-exported from the main index
import type { CheckpointCommittedEvent as IndexExport } from '../index.js';

describe('CheckpointCommittedEvent', () => {
  it('should be constructable with all required fields', () => {
    const event: CheckpointCommittedEvent = {
      checkpointID: 'a1b2c3d4e5f6',
      sessionID: 'sess-abc',
      agent: 'Claude Code',
      filesTouched: ['src/auth.ts', 'src/middleware.ts'],
      checkpointsCount: 3,
    };

    expect(event.checkpointID).toBe('a1b2c3d4e5f6');
    expect(event.sessionID).toBe('sess-abc');
    expect(event.agent).toBe('Claude Code');
    expect(event.filesTouched).toHaveLength(2);
    expect(event.checkpointsCount).toBe(3);
  });

  it('should accept optional fields', () => {
    const event: CheckpointCommittedEvent = {
      checkpointID: 'a1b2c3d4e5f6',
      sessionID: 'sess-abc',
      agent: 'Claude Code',
      filesTouched: [],
      checkpointsCount: 1,
      branch: 'feature/auth',
      tokenUsage: {
        inputTokens: 50000,
        outputTokens: 12000,
        cacheCreationTokens: 0,
        cacheReadTokens: 30000,
        apiCallCount: 8,
      },
      summary: {
        intent: 'Add JWT auth',
        outcome: 'Implemented auth middleware',
        learnings: { repo: ['uses Express'], code: [], workflow: [] },
        friction: [],
        openItems: [],
      },
      initialAttribution: {
        calculatedAt: '2026-03-01T12:00:00Z',
        agentLines: 100,
        humanAdded: 10,
        humanModified: 5,
        humanRemoved: 2,
        totalCommitted: 110,
        agentPercentage: 90.9,
      },
    };

    expect(event.branch).toBe('feature/auth');
    expect(event.tokenUsage?.inputTokens).toBe(50000);
    expect(event.summary?.intent).toBe('Add JWT auth');
    expect(event.initialAttribution?.agentPercentage).toBe(90.9);
  });

  it('should be accepted as onCheckpointCommitted callback parameter', () => {
    const receivedEvents: CheckpointCommittedEvent[] = [];

    // Verify the config type accepts the callback
    const config: Pick<ManualCommitStrategyConfig, 'onCheckpointCommitted'> = {
      onCheckpointCommitted: (event) => {
        receivedEvents.push(event);
      },
    };

    // Simulate the callback being called
    config.onCheckpointCommitted!({
      checkpointID: 'test-cp',
      sessionID: 'test-sess',
      agent: 'Cursor IDE',
      filesTouched: ['README.md'],
      checkpointsCount: 1,
    });

    expect(receivedEvents).toHaveLength(1);
    expect(receivedEvents[0].checkpointID).toBe('test-cp');
    expect(receivedEvents[0].agent).toBe('Cursor IDE');
  });

  it('should be the same type when imported from index', () => {
    // TypeScript compilation of this test verifies the re-export works.
    // At runtime, verify an object satisfies both import paths.
    const event: IndexExport = {
      checkpointID: 'abc',
      sessionID: 'sess',
      agent: 'Test',
      filesTouched: [],
      checkpointsCount: 0,
    };

    const sameEvent: CheckpointCommittedEvent = event;
    expect(sameEvent.checkpointID).toBe('abc');
  });
});

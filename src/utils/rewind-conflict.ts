/**
 * Rewind Conflict Detection
 *
 * Utilities for detecting timestamp conflicts when restoring session logs
 * from checkpoints. Prevents silent overwrites of newer local transcripts.
 *
 * Ported from Go: strategy/manual_commit_rewind.go
 */

// ============================================================================
// Types
// ============================================================================

export const enum SessionRestoreStatus {
  /** Local file doesn't exist */
  New = 0,
  /** Local and checkpoint are the same */
  Unchanged = 1,
  /** Checkpoint has newer entries */
  CheckpointNewer = 2,
  /** Local has newer entries (conflict) */
  LocalNewer = 3,
}

export interface SessionRestoreInfo {
  sessionID: string;
  prompt: string;
  status: SessionRestoreStatus;
  localTime: Date;
  checkpointTime: Date;
}

// ============================================================================
// Classification
// ============================================================================

/**
 * Determine the restore status based on local and checkpoint timestamps.
 */
export function classifyTimestamps(
  localTime: Date | null,
  checkpointTime: Date | null,
): SessionRestoreStatus {
  // Local file doesn't exist
  if (!localTime || localTime.getTime() === 0) {
    return SessionRestoreStatus.New;
  }

  // Can't determine checkpoint time
  if (!checkpointTime || checkpointTime.getTime() === 0) {
    return SessionRestoreStatus.New;
  }

  if (localTime.getTime() > checkpointTime.getTime()) {
    return SessionRestoreStatus.LocalNewer;
  }
  if (checkpointTime.getTime() > localTime.getTime()) {
    return SessionRestoreStatus.CheckpointNewer;
  }
  return SessionRestoreStatus.Unchanged;
}

/**
 * Returns a human-readable status string.
 */
export function statusToText(status: SessionRestoreStatus): string {
  switch (status) {
    case SessionRestoreStatus.New:
      return '(new)';
    case SessionRestoreStatus.Unchanged:
      return '(unchanged)';
    case SessionRestoreStatus.CheckpointNewer:
      return '(checkpoint is newer)';
    case SessionRestoreStatus.LocalNewer:
      return '(local is newer)';
    default:
      return '';
  }
}

/**
 * Check if any sessions have conflicts (local is newer than checkpoint).
 */
export function hasConflicts(sessions: SessionRestoreInfo[]): boolean {
  return sessions.some((s) => s.status === SessionRestoreStatus.LocalNewer);
}

/**
 * Separate sessions into conflicting and non-conflicting lists.
 */
export function partitionConflicts(sessions: SessionRestoreInfo[]): {
  conflicting: SessionRestoreInfo[];
  nonConflicting: SessionRestoreInfo[];
} {
  const conflicting: SessionRestoreInfo[] = [];
  const nonConflicting: SessionRestoreInfo[] = [];
  for (const s of sessions) {
    if (s.status === SessionRestoreStatus.LocalNewer) {
      conflicting.push(s);
    } else {
      nonConflicting.push(s);
    }
  }
  return { conflicting, nonConflicting };
}

// ============================================================================
// Agent Resolution
// ============================================================================

import type { Agent } from '../agent/types.js';
import { getAgentByType } from '../agent/registry.js';
import type { AgentType } from '../types.js';

/**
 * Resolve the agent from checkpoint metadata agent type string.
 * Returns null if the agent type is not registered.
 */
export function resolveAgentForRewind(agentType: AgentType): Agent | null {
  return getAgentByType(agentType);
}

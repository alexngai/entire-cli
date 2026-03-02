/**
 * Event Log
 *
 * Appends checkpoint events to a JSONL file (.sessionlog/events.jsonl)
 * for consumption by external systems (e.g., MAP session sync).
 *
 * Sessionlog runs as standalone git hooks (separate processes), so
 * in-process callbacks don't work across process boundaries. This
 * file-based event log bridges that gap.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { SESSIONLOG_EVENTS_FILE } from '../types.js';
import type { TokenUsage } from '../types.js';
import { atomicWriteFile } from '../git-operations.js';

// ============================================================================
// Types
// ============================================================================

/** Event written to the JSONL log after a checkpoint is committed. */
export interface CheckpointEvent {
  type: 'checkpoint_committed';
  timestamp: string;
  checkpointID: string;
  sessionID: string;
  agent: string;
  branch?: string;
  filesTouched: string[];
  checkpointsCount: number;
  tokenUsage?: TokenUsage;
}

export interface EventLogOptions {
  /** Keep only the last N events. 0 or undefined means keep all. */
  maxEvents?: number;
}

// ============================================================================
// Write
// ============================================================================

/**
 * Append a checkpoint event to the event log file and optionally prune.
 *
 * @param cwd - Repository root directory
 * @param event - The checkpoint event to record
 * @param opts - Optional retention settings
 */
export async function appendCheckpointEvent(
  cwd: string,
  event: CheckpointEvent,
  opts?: EventLogOptions,
): Promise<void> {
  const filePath = path.join(cwd, SESSIONLOG_EVENTS_FILE);
  const line = JSON.stringify(event) + '\n';

  // Ensure directory exists
  const dir = path.dirname(filePath);
  await fs.promises.mkdir(dir, { recursive: true });

  // Append the new event
  await fs.promises.appendFile(filePath, line, 'utf-8');

  // Prune if maxEvents is configured
  const maxEvents = opts?.maxEvents;
  if (maxEvents && maxEvents > 0) {
    await pruneEventLog(filePath, maxEvents);
  }
}

// ============================================================================
// Read
// ============================================================================

/**
 * Read all checkpoint events from the event log file.
 *
 * @param cwd - Repository root directory
 * @returns Array of events in chronological order (oldest first)
 */
export function readCheckpointEvents(cwd: string): CheckpointEvent[] {
  const filePath = path.join(cwd, SESSIONLOG_EVENTS_FILE);

  let content: string;
  try {
    content = fs.readFileSync(filePath, 'utf-8');
  } catch {
    return [];
  }

  const events: CheckpointEvent[] = [];
  for (const line of content.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      events.push(JSON.parse(trimmed) as CheckpointEvent);
    } catch {
      // Skip malformed lines
    }
  }
  return events;
}

// ============================================================================
// Prune
// ============================================================================

/**
 * Trim the event log to the last N entries.
 */
async function pruneEventLog(filePath: string, maxEvents: number): Promise<void> {
  let content: string;
  try {
    content = await fs.promises.readFile(filePath, 'utf-8');
  } catch {
    return;
  }

  const lines = content.split('\n').filter((l) => l.trim().length > 0);
  if (lines.length <= maxEvents) return;

  const kept = lines.slice(-maxEvents);
  await atomicWriteFile(filePath, kept.join('\n') + '\n');
}

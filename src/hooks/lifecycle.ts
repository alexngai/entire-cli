/**
 * Lifecycle Management
 *
 * Dispatches normalized agent events through the session state machine.
 * This is the orchestration layer between agent hooks and checkpoint operations.
 */

import * as crypto from 'node:crypto';
import type { Event, SessionState, ToolUsageStats } from '../types.js';
import { EventType, addTokenUsage, emptyToolUsageStats } from '../types.js';
import type { SessionStore } from '../store/session-store.js';
import type { CheckpointStore } from '../store/checkpoint-store.js';
import type { Agent } from '../agent/types.js';
import {
  hasTranscriptAnalyzer,
  hasTokenCalculator,
  hasToolUsageExtractor,
} from '../agent/types.js';
import { getHead, getCurrentBranch, getUntrackedFiles } from '../git-operations.js';

// ============================================================================
// Types
// ============================================================================

export interface LifecycleConfig {
  sessionStore: SessionStore;
  checkpointStore: CheckpointStore;
  cwd?: string;
}

export interface LifecycleHandler {
  /** Dispatch an event through the lifecycle state machine */
  dispatch(agent: Agent, event: Event): Promise<void>;
}

// ============================================================================
// Implementation
// ============================================================================

export function createLifecycleHandler(config: LifecycleConfig): LifecycleHandler {
  const { sessionStore, cwd } = config;

  return {
    async dispatch(agent: Agent, event: Event): Promise<void> {
      switch (event.type) {
        case EventType.SessionStart:
          await handleSessionStart(agent, event);
          break;
        case EventType.TurnStart:
          await handleTurnStart(agent, event);
          break;
        case EventType.TurnEnd:
          await handleTurnEnd(agent, event);
          break;
        case EventType.SessionEnd:
          await handleSessionEnd(agent, event);
          break;
        case EventType.Compaction:
          await handleCompaction(agent, event);
          break;
        case EventType.SubagentStart:
          await handleSubagentStart(agent, event);
          break;
        case EventType.SubagentEnd:
          await handleSubagentEnd(agent, event);
          break;
      }
    },
  };

  async function handleSessionStart(agent: Agent, event: Event): Promise<void> {
    // Check if session already exists
    const existing = await sessionStore.load(event.sessionID);
    if (existing && existing.phase !== 'ended') {
      // Session already active, update interaction time
      existing.lastInteractionTime = new Date().toISOString();
      await sessionStore.save(existing);
      return;
    }

    // Create new session state
    const head = await getHead(cwd);
    const _branch = await getCurrentBranch(cwd);
    const untrackedFiles = await getUntrackedFiles(cwd);

    const state: SessionState = {
      sessionID: event.sessionID,
      baseCommit: head,
      attributionBaseCommit: head,
      startedAt: new Date().toISOString(),
      phase: 'idle',
      turnCheckpointIDs: [],
      stepCount: 0,
      checkpointTranscriptStart: 0,
      untrackedFilesAtStart: untrackedFiles,
      filesTouched: [],
      agentType: agent.type,
      transcriptPath: event.sessionRef,
      worktreePath: cwd,
    };

    await sessionStore.save(state);
  }

  async function handleTurnStart(agent: Agent, event: Event): Promise<void> {
    let state = await sessionStore.load(event.sessionID);

    if (!state) {
      // Auto-create session on first turn
      await handleSessionStart(agent, {
        ...event,
        type: EventType.SessionStart,
      });
      state = await sessionStore.load(event.sessionID);
      if (!state) return;
    }

    // Generate a new turn ID
    state.turnID = crypto.randomUUID().slice(0, 8);
    state.phase = 'active';
    state.lastInteractionTime = new Date().toISOString();
    state.transcriptPath = event.sessionRef;

    if (event.prompt && !state.firstPrompt) {
      state.firstPrompt = event.prompt.slice(0, 500);
    }

    // Capture pre-prompt transcript position
    if (hasTranscriptAnalyzer(agent) && event.sessionRef) {
      try {
        state.checkpointTranscriptStart = await agent.getTranscriptPosition(event.sessionRef);
        state.transcriptIdentifierAtStart = event.sessionRef;
      } catch {
        // Ignore transcript position errors
      }
    }

    await sessionStore.save(state);
  }

  async function handleTurnEnd(agent: Agent, event: Event): Promise<void> {
    const state = await sessionStore.load(event.sessionID);
    if (!state) return;

    state.lastInteractionTime = new Date().toISOString();

    // Extract modified files from transcript
    if (hasTranscriptAnalyzer(agent) && state.transcriptPath) {
      try {
        const { files } = await agent.extractModifiedFilesFromOffset(
          state.transcriptPath,
          state.checkpointTranscriptStart,
        );

        // Merge new files into filesTouched
        const fileSet = new Set(state.filesTouched);
        for (const file of files) fileSet.add(file);
        state.filesTouched = Array.from(fileSet);
      } catch {
        // Ignore extraction errors
      }
    }

    // Calculate token usage
    if (hasTokenCalculator(agent) && state.transcriptPath) {
      try {
        const transcript = await agent.readTranscript(state.transcriptPath);
        const usage = await agent.calculateTokenUsage(transcript, state.checkpointTranscriptStart);
        state.tokenUsage = state.tokenUsage ? addTokenUsage(state.tokenUsage, usage) : usage;
      } catch {
        // Ignore token calculation errors
      }
    }

    // Extract tool usage from transcript (post-process, no runtime overhead)
    if (hasToolUsageExtractor(agent) && state.transcriptPath) {
      try {
        const transcript = await agent.readTranscript(state.transcriptPath);
        const turnUsage = agent.extractToolUsage(transcript, state.checkpointTranscriptStart);
        state.toolUsage = mergeToolUsage(state.toolUsage, turnUsage);
      } catch {
        // Ignore extraction errors
      }
    }

    // Transition to idle
    state.phase = 'idle';
    await sessionStore.save(state);
  }

  async function handleSessionEnd(agent: Agent, event: Event): Promise<void> {
    const state = await sessionStore.load(event.sessionID);
    if (!state) return;

    state.phase = 'ended';
    state.endedAt = new Date().toISOString();
    state.lastInteractionTime = new Date().toISOString();

    await sessionStore.save(state);
  }

  async function handleCompaction(agent: Agent, event: Event): Promise<void> {
    const state = await sessionStore.load(event.sessionID);
    if (!state) return;

    // Update transcript offset for next checkpoint
    if (hasTranscriptAnalyzer(agent) && state.transcriptPath) {
      try {
        state.checkpointTranscriptStart = await agent.getTranscriptPosition(state.transcriptPath);
      } catch {
        // Ignore
      }
    }

    state.lastInteractionTime = new Date().toISOString();
    await sessionStore.save(state);
  }

  async function handleSubagentStart(_agent: Agent, event: Event): Promise<void> {
    const state = await sessionStore.load(event.sessionID);
    if (!state) return;

    state.lastInteractionTime = new Date().toISOString();

    // Record task summary
    const usage = ensureToolUsage(state);
    const taskInput = event.toolInput as Record<string, unknown> | undefined;
    usage.taskSummaries.push({
      toolUseID: event.toolUseID ?? '',
      description: taskInput?.description ? String(taskInput.description) : event.taskDescription,
      subagentType: taskInput?.subagent_type ? String(taskInput.subagent_type) : event.subagentType,
      startedAt: event.timestamp.toISOString(),
    });

    await sessionStore.save(state);
  }

  async function handleSubagentEnd(_agent: Agent, event: Event): Promise<void> {
    const state = await sessionStore.load(event.sessionID);
    if (!state) return;

    state.lastInteractionTime = new Date().toISOString();

    // Update the matching task summary with end time
    if (state.toolUsage && event.toolUseID) {
      const task = state.toolUsage.taskSummaries.find((t) => t.toolUseID === event.toolUseID);
      if (task) {
        task.endedAt = event.timestamp.toISOString();
      }
    }

    await sessionStore.save(state);
  }

  // ==========================================================================
  // Helpers
  // ==========================================================================

  function ensureToolUsage(state: SessionState): ToolUsageStats {
    if (!state.toolUsage) {
      state.toolUsage = emptyToolUsageStats();
    }
    return state.toolUsage;
  }
}

/**
 * Merge new tool usage stats into existing accumulated stats.
 * Tool counts and totals are additive; skill/task lists are appended.
 */
function mergeToolUsage(
  existing: ToolUsageStats | undefined,
  incoming: ToolUsageStats,
): ToolUsageStats {
  if (!existing) return incoming;

  const merged = { ...existing };
  merged.totalToolUses += incoming.totalToolUses;
  merged.toolCounts = { ...existing.toolCounts };
  for (const [tool, count] of Object.entries(incoming.toolCounts)) {
    merged.toolCounts[tool] = (merged.toolCounts[tool] ?? 0) + count;
  }
  merged.skillUses = [...existing.skillUses, ...incoming.skillUses];
  // Don't merge taskSummaries here — those come from SubagentStart/End hooks
  merged.taskSummaries = existing.taskSummaries;

  return merged;
}

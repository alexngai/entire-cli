/**
 * Strategy Engine Types
 *
 * Core types for the manual-commit strategy that orchestrates
 * checkpoint creation, condensation, attribution, and commit hooks.
 */

import type { AgentType, CheckpointID, InitialAttribution, Summary, TokenUsage } from '../types.js';

// ============================================================================
// Strategy Constants
// ============================================================================

export const STRATEGY_NAME_MANUAL_COMMIT = 'manual-commit';
export const MAX_COMMIT_TRAVERSAL_DEPTH = 1000;
export const LOGS_ONLY_SCAN_LIMIT = 500;
export const PROMPT_TRUNCATE_LENGTH = 500;
export const STALE_SESSION_THRESHOLD_MS = 60 * 60 * 1000; // 1 hour

// ============================================================================
// Strategy Interface
// ============================================================================

export interface Strategy {
  readonly name: string;

  // Git hooks
  prepareCommitMsg(commitMsgFile: string, source: string, sha: string): Promise<void>;
  commitMsg(commitMsgFile: string): Promise<void>;
  postCommit(): Promise<void>;
  prePush(remote: string): Promise<void>;

  // Session management
  saveStep(step: StepContext): Promise<void>;
  saveTaskStep(step: TaskStepContext): Promise<void>;

  // Rewind
  getRewindPoints(limit: number): Promise<RewindPoint[]>;
  rewind(point: RewindPoint): Promise<void>;
  canRewind(): Promise<[boolean, string]>;

  // Condensation
  condense(sessionID: string): Promise<CondensationResult>;

  // Validation & Cleanup
  validateRepository(): Promise<void>;
  listOrphanedItems(): Promise<OrphanedItem[]>;
}

// ============================================================================
// Step Context (checkpoint creation input)
// ============================================================================

export interface StepContext {
  metadataDir: string;
  metadataDirAbs: string;
  commitMessage: string;
  modifiedFiles: string[];
  newFiles: string[];
  deletedFiles: string[];
  authorName: string;
  authorEmail: string;
  agentType: AgentType;
  tokenUsage?: TokenUsage;
  stepTranscriptIdentifier?: string;
}

export interface TaskStepContext {
  sessionID: string;
  toolUseID: string;
  agentID?: string;
  checkpointUUID: string;
  modifiedFiles: string[];
  newFiles: string[];
  deletedFiles: string[];
  transcriptPath?: string;
  subagentTranscriptPath?: string;
  commitMessage: string;
  authorName: string;
  authorEmail: string;
  agentType: AgentType;
  subagentType?: string;
  taskDescription?: string;
  todoContent?: string;
  isIncremental: boolean;
  incrementalSequence: number;
  incrementalType?: string;
  incrementalData?: Buffer;
}

// ============================================================================
// Session State (strategy-level, extends base SessionState)
// ============================================================================

export interface StrategySessionState {
  sessionID: string;
  cliVersion?: string;
  baseCommit: string;
  attributionBaseCommit: string;
  worktreePath: string;
  worktreeID: string;
  startedAt: Date;
  lastInteractionTime?: Date;
  turnID: string;
  stepCount: number;
  untrackedFilesAtStart: string[];
  filesTouched: string[];
  agentType: AgentType;
  transcriptPath?: string;
  firstPrompt?: string;
  lastCheckpointID?: CheckpointID;
  tokenUsage?: TokenUsage;
  transcriptIdentifierAtStart?: string;
  promptAttributions: PromptAttribution[];
  pendingPromptAttribution?: PromptAttribution;
  phase: 'idle' | 'active' | 'ended';
}

// ============================================================================
// Prompt Attribution (per-checkpoint user edit tracking)
// ============================================================================

export interface PromptAttribution {
  checkpointNumber: number;
  userLinesAdded: number;
  userLinesRemoved: number;
  agentLinesAdded: number;
  agentLinesRemoved: number;
  userAddedPerFile: Record<string, number>;
}

// ============================================================================
// Rewind Types
// ============================================================================

export interface RewindPoint {
  id: string;
  message: string;
  metadataDir?: string;
  date: Date;
  isTaskCheckpoint: boolean;
  isLogsOnly: boolean;
  checkpointID?: CheckpointID;
  agent?: AgentType;
  sessionID?: string;
  sessionPrompt?: string;
  sessionCount: number;
  sessionIDs: string[];
  sessionPrompts?: string[];
  toolUseID?: string;
}

export interface RewindPreview {
  filesToRestore: string[];
  filesToDelete: string[];
}

// ============================================================================
// Condensation Result
// ============================================================================

export interface CondensationResult {
  checkpointID: CheckpointID;
  sessionsCondensed: number;
  checkpointsCount: number;
  filesTouched: string[];
  tokenUsage?: TokenUsage;
  attribution?: InitialAttribution;
  summary?: Summary;
}

// ============================================================================
// Checkpoint Info (from committed checkpoints)
// ============================================================================

export interface CheckpointInfo {
  checkpointID: CheckpointID;
  sessionID: string;
  sessionCount: number;
  sessionIDs: string[];
  agent: AgentType;
  createdAt: Date;
}

// ============================================================================
// Session Info (for explain/resume)
// ============================================================================

export interface SessionInfo {
  sessionID: string;
  reference: string;
  commitHash?: string;
}

// ============================================================================
// Restore Types
// ============================================================================

export const enum SessionRestoreStatus {
  New = 0,
  Unchanged = 1,
  CheckpointNewer = 2,
  LocalNewer = 3,
}

export interface SessionRestoreInfo {
  sessionID: string;
  prompt: string;
  status: SessionRestoreStatus;
  localTime: Date;
  checkpointTime: Date;
}

export interface RestoredSession {
  sessionID: string;
  agent: AgentType;
  prompt: string;
  createdAt?: string;
}

// ============================================================================
// Orphaned Item (for cleanup)
// ============================================================================

export type OrphanedItemType = 'shadow-branch' | 'session-state';

export interface OrphanedItem {
  type: OrphanedItemType;
  id: string;
  reason: string;
}

// ============================================================================
// Message Formatting
// ============================================================================

export function formatSubagentEndMessage(
  subagentType: string | undefined,
  taskDescription: string | undefined,
  shortToolUseID: string,
): string {
  const parts: string[] = [];
  if (subagentType) {
    parts.push(`Task (${subagentType})`);
  } else {
    parts.push('Task');
  }
  if (taskDescription) {
    // Truncate description to 50 chars
    const desc =
      taskDescription.length > 50 ? taskDescription.slice(0, 50) + '...' : taskDescription;
    parts.push(desc);
  }
  parts.push(`[${shortToolUseID}]`);
  return parts.join(' - ');
}

export function formatIncrementalSubject(
  incrementalType: string | undefined,
  subagentType: string | undefined,
  taskDescription: string | undefined,
  todoContent: string | undefined,
  sequence: number,
  shortToolUseID: string,
): string {
  const typeLabel = incrementalType || 'update';
  const agentLabel = subagentType ? `(${subagentType})` : '';
  const seqLabel = `#${sequence}`;

  let descLabel = '';
  if (todoContent) {
    descLabel = todoContent.length > 40 ? todoContent.slice(0, 40) + '...' : todoContent;
  } else if (taskDescription) {
    descLabel =
      taskDescription.length > 40 ? taskDescription.slice(0, 40) + '...' : taskDescription;
  }

  return `Task ${agentLabel} ${typeLabel} ${seqLabel}${descLabel ? ' - ' + descLabel : ''} [${shortToolUseID}]`.trim();
}

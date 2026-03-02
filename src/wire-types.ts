/**
 * Wire Format Types
 *
 * Snake_case types describing how sessionlog checkpoint data is formatted
 * for external consumption over wire protocols (e.g., MAP trajectory sync).
 *
 * These are the canonical wire-format definitions. External systems
 * (e.g., OpenHive hub) import these to construct properly-typed messages.
 */

/** Token usage stats for a checkpoint (wire format) */
export interface SessionSyncTokenUsage {
  input_tokens: number;
  output_tokens: number;
  cache_creation_tokens: number;
  cache_read_tokens: number;
  api_call_count: number;
}

/** AI-generated session summary (wire format) */
export interface SessionSyncSummary {
  intent: string;
  outcome: string;
  learnings?: {
    repo: string[];
    workflow: string[];
  };
  friction?: string[];
  open_items?: string[];
}

/** Attribution stats for agent vs human contributions (wire format) */
export interface SessionSyncAttribution {
  agent_lines: number;
  human_added: number;
  agent_percentage: number;
}

/** Inline checkpoint metadata for session sync notifications (wire format) */
export interface SessionSyncCheckpoint {
  /** 12-char hex checkpoint ID */
  id: string;
  /** Sessionlog session ID */
  session_id: string;
  /** Agent type (e.g., "Claude Code", "Cursor IDE") */
  agent: string;
  /** Git branch the checkpoint was created on */
  branch?: string;
  /** Files modified in this checkpoint */
  files_touched: string[];
  /** Number of temporary checkpoints before this commit */
  checkpoints_count: number;
  /** Token usage for this checkpoint */
  token_usage?: SessionSyncTokenUsage;
  /** AI-generated summary of the session */
  summary?: SessionSyncSummary;
  /** Agent vs human contribution attribution */
  attribution?: SessionSyncAttribution;
}

/**
 * Normalized Agent Session Type
 *
 * A shared, agent-agnostic representation of a coding session with typed
 * entries. This provides a uniform interface for cross-agent operations.
 *
 * Ported from Go: agent/session.go
 */

import type { AgentType } from '../types.js';

// ============================================================================
// Entry Types
// ============================================================================

export const enum EntryType {
  User = 'user',
  Assistant = 'assistant',
  Tool = 'tool',
  System = 'system',
}

export interface SessionEntry {
  type: EntryType;
  uuid?: string;
  timestamp?: string;
  text?: string;
  toolName?: string;
  toolInput?: unknown;
  toolResult?: unknown;
}

// ============================================================================
// Agent Session
// ============================================================================

export interface AgentSession {
  readonly agentType: AgentType;
  readonly sessionID: string;
  readonly entries: SessionEntry[];

  /** Get the last user prompt text */
  getLastUserPrompt(): string;

  /** Get all user prompts */
  getUserPrompts(): string[];

  /** Get the total number of entries */
  length(): number;

  /** Truncate the session at a specific UUID (for partial replay) */
  truncateAtUUID(uuid: string): AgentSession;

  /** Find the tool result entry for a given tool use UUID */
  findToolResultByUUID(uuid: string): SessionEntry | undefined;

  /** Get all entries of a specific type */
  getEntriesByType(type: EntryType): SessionEntry[];

  /** Get entries from a specific offset */
  slice(fromOffset: number): SessionEntry[];
}

// ============================================================================
// Implementation
// ============================================================================

export function createAgentSession(
  agentType: AgentType,
  sessionID: string,
  entries: SessionEntry[],
): AgentSession {
  return {
    agentType,
    sessionID,
    entries,

    getLastUserPrompt(): string {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].type === EntryType.User && entries[i].text) {
          return entries[i].text!;
        }
      }
      return '';
    },

    getUserPrompts(): string[] {
      return entries.filter((e) => e.type === EntryType.User && e.text).map((e) => e.text!);
    },

    length(): number {
      return entries.length;
    },

    truncateAtUUID(uuid: string): AgentSession {
      const idx = entries.findIndex((e) => e.uuid === uuid);
      if (idx === -1) return createAgentSession(agentType, sessionID, entries);
      return createAgentSession(agentType, sessionID, entries.slice(0, idx + 1));
    },

    findToolResultByUUID(uuid: string): SessionEntry | undefined {
      return entries.find((e) => e.type === EntryType.Tool && e.uuid === uuid);
    },

    getEntriesByType(type: EntryType): SessionEntry[] {
      return entries.filter((e) => e.type === type);
    },

    slice(fromOffset: number): SessionEntry[] {
      return entries.slice(fromOffset);
    },
  };
}

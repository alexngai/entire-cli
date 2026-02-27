/**
 * Agent Type Detection from Content
 *
 * Auto-detect agent type from transcript content format.
 *
 * Ported from Go: agent/chunking.go
 */

import { AGENT_TYPES, type AgentType } from '../types.js';

/**
 * Detect the agent type from transcript content.
 *
 * Returns the Gemini agent type if the content appears to be Gemini JSON format
 * (object with messages array). Returns empty string if detection fails.
 *
 * This is used when the agent type is unknown but we need to chunk/reassemble
 * correctly — Gemini uses JSON format while others use JSONL.
 */
export function detectAgentTypeFromContent(content: Buffer): AgentType | '' {
  const trimmed = content.toString('utf-8').trimStart();

  // Gemini JSON starts with { and has a messages array
  if (!trimmed.startsWith('{')) return '';

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (Array.isArray(parsed.messages) && parsed.messages.length > 0) {
      return AGENT_TYPES.GEMINI;
    }
  } catch {
    // Not valid JSON
  }

  return '';
}

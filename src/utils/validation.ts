/**
 * Input Validation
 *
 * Validates user-supplied IDs to prevent path traversal attacks when
 * IDs are used to construct file paths (session state, metadata, etc.).
 *
 * This module has no dependencies to avoid import cycles.
 */

/** Matches alphanumeric characters, underscores, and hyphens only. */
const pathSafeRegex = /^[a-zA-Z0-9_-]+$/;

/**
 * Validate that a session ID doesn't contain path separators.
 * Prevents path traversal when session IDs are used in file paths.
 */
export function validateSessionID(id: string): void {
  if (!id) {
    throw new Error('session ID cannot be empty');
  }
  if (id.includes('/') || id.includes('\\')) {
    throw new Error(`invalid session ID "${id}": contains path separators`);
  }
}

/**
 * Validate that a tool use ID contains only safe characters for paths.
 * Tool use IDs can be UUIDs or prefixed identifiers like "toolu_xxx".
 * Empty is allowed (optional field).
 */
export function validateToolUseID(id: string): void {
  if (!id) return;
  if (!pathSafeRegex.test(id)) {
    throw new Error(
      `invalid tool use ID "${id}": must be alphanumeric with underscores/hyphens only`,
    );
  }
}

/**
 * Validate that an agent ID contains only safe characters for paths.
 * Empty is allowed (optional field).
 */
export function validateAgentID(id: string): void {
  if (!id) return;
  if (!pathSafeRegex.test(id)) {
    throw new Error(`invalid agent ID "${id}": must be alphanumeric with underscores/hyphens only`);
  }
}

/**
 * Validate that an agent session ID contains only safe characters for paths.
 * Agent session IDs can be UUIDs (Claude Code), test identifiers, or other
 * formats depending on the agent.
 */
export function validateAgentSessionID(id: string): void {
  if (!id) {
    throw new Error('agent session ID cannot be empty');
  }
  if (!pathSafeRegex.test(id)) {
    throw new Error(
      `invalid agent session ID "${id}": must be alphanumeric with underscores/hyphens only`,
    );
  }
}

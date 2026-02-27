/**
 * Commit Message Generation
 *
 * Generates clean commit messages from user prompts by stripping
 * conversational prefixes, truncating, and capitalizing.
 */

import { truncateRunes, capitalizeFirst, collapseWhitespace } from './string-utils.js';

const DEFAULT_MESSAGE = 'AI session updates';

/**
 * Conversational prefixes that should be stripped from commit messages.
 */
const conversationalPrefixes = [
  /^can you\s+/i,
  /^could you\s+/i,
  /^would you\s+/i,
  /^please\s+/i,
  /^let's\s+/i,
  /^let us\s+/i,
  /^i want you to\s+/i,
  /^i'd like you to\s+/i,
  /^i need you to\s+/i,
  /^go ahead and\s+/i,
  /^i want to\s+/i,
  /^i'd like to\s+/i,
  /^i need to\s+/i,
  /^help me\s+/i,
  /^help us\s+/i,
];

/**
 * Generate a clean commit message from a user prompt.
 */
export function generateCommitMessage(originalPrompt: string): string {
  if (!originalPrompt || originalPrompt.trim().length === 0) {
    return DEFAULT_MESSAGE;
  }

  let cleaned = collapseWhitespace(originalPrompt);

  // Strip conversational prefixes
  for (const prefix of conversationalPrefixes) {
    cleaned = cleaned.replace(prefix, '');
  }

  // Remove trailing question mark
  cleaned = cleaned.replace(/\?$/, '');

  // Trim again
  cleaned = cleaned.trim();

  if (cleaned.length === 0) {
    return DEFAULT_MESSAGE;
  }

  // Truncate to 72 characters (rune-safe)
  cleaned = truncateRunes(cleaned, 72, '...');

  // Capitalize first letter
  cleaned = capitalizeFirst(cleaned);

  return cleaned;
}

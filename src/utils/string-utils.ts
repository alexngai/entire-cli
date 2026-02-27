/**
 * String Utilities
 *
 * Rune-safe string operations for multi-byte character handling.
 */

/**
 * Truncate a string to a maximum number of Unicode code points (runes).
 * Avoids splitting multi-byte UTF-8 characters.
 */
export function truncateRunes(s: string, maxRunes: number, suffix: string = '...'): string {
  const runes = [...s];
  if (runes.length <= maxRunes) {
    return s;
  }
  return runes.slice(0, maxRunes).join('') + suffix;
}

/**
 * Collapse all whitespace sequences (including newlines) to single spaces.
 */
export function collapseWhitespace(s: string): string {
  return s.replace(/\s+/g, ' ').trim();
}

/**
 * Capitalize the first character of a string.
 */
export function capitalizeFirst(s: string): string {
  if (s.length === 0) return s;
  return s[0].toUpperCase() + s.slice(1);
}

/**
 * Count lines in a string.
 * Empty string = 0 lines. String without newline = 1 line.
 */
export function countLines(content: string): number {
  if (content === '') return 0;
  let lines = 0;
  for (let i = 0; i < content.length; i++) {
    if (content[i] === '\n') lines++;
  }
  if (!content.endsWith('\n')) lines++;
  return lines;
}

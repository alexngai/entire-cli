/**
 * IDE Tag Stripping
 *
 * Removes IDE-injected context tags from prompt text.
 * These tags are added by IDEs (VSCode, Cursor) and system infrastructure
 * and shouldn't appear in user-facing text.
 */

// IDE context tags: <ide_opened_file>...</ide_opened_file>, <ide_selection>...</ide_selection>
const ideContextTagRegex = /<ide_[^>]*>[\s\S]*?<\/ide_[^>]*>/g;

// System-injected tags
const systemTagRegexes = [
  /<local-command-caveat[^>]*>[\s\S]*?<\/local-command-caveat>/g,
  /<system-reminder[^>]*>[\s\S]*?<\/system-reminder>/g,
  /<command-name[^>]*>[\s\S]*?<\/command-name>/g,
  /<command-message[^>]*>[\s\S]*?<\/command-message>/g,
  /<command-args[^>]*>[\s\S]*?<\/command-args>/g,
  /<local-command-stdout[^>]*>[\s\S]*?<\/local-command-stdout>/g,
  /<\/?user_query>/g, // Cursor wraps user text in <user_query> tags; strip tags but keep content
];

/**
 * Strip IDE-injected context tags from prompt text.
 */
export function stripIDEContextTags(text: string): string {
  let result = text.replace(ideContextTagRegex, '');
  for (const re of systemTagRegexes) {
    result = result.replace(re, '');
  }
  return result.trim();
}

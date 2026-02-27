/**
 * Todo Extraction
 *
 * Parses TodoWrite tool_input JSON to extract todo content for
 * incremental checkpoint commit messages.
 *
 * Ported from Go: strategy/messages.go
 */

// ============================================================================
// Types
// ============================================================================

interface TodoItem {
  content: string;
  activeForm?: string;
  status: string;
}

// ============================================================================
// Extraction Functions
// ============================================================================

/**
 * Extract the content of the last completed todo item from a todos JSON array.
 * Returns the work that was just finished (used for commit messages).
 *
 * Returns empty string if no completed items exist or JSON is invalid.
 */
export function extractLastCompletedTodo(todosJSON: string | Buffer): string {
  const todos = parseTodos(todosJSON);
  if (!todos) return '';

  let lastCompleted = '';
  for (const todo of todos) {
    if (todo.status === 'completed') {
      lastCompleted = todo.content;
    }
  }
  return lastCompleted;
}

/**
 * Return the number of todo items in the JSON array.
 * Returns 0 if the JSON is invalid or empty.
 */
export function countTodos(todosJSON: string | Buffer): number {
  const todos = parseTodos(todosJSON);
  return todos ? todos.length : 0;
}

/**
 * Extract the content of the in-progress todo item from tool_input.
 * Used for commit messages in incremental checkpoints.
 *
 * Priority order:
 *  1. in_progress item (current work)
 *  2. first pending item (next work - fallback)
 *  3. last completed item (work just finished)
 *  4. first item with unknown status (edge case)
 *  5. empty string (no items)
 */
export function extractInProgressTodo(todosJSON: string | Buffer): string {
  const todos = parseTodos(todosJSON);
  if (!todos || todos.length === 0) return '';

  // 1. in_progress item
  for (const todo of todos) {
    if (todo.status === 'in_progress') {
      return todo.content;
    }
  }

  // 2. first pending item
  for (const todo of todos) {
    if (todo.status === 'pending') {
      return todo.content;
    }
  }

  // 3. last completed item
  let lastCompleted = '';
  for (const todo of todos) {
    if (todo.status === 'completed') {
      lastCompleted = todo.content;
    }
  }
  if (lastCompleted) return lastCompleted;

  // 4. first item with content (unknown status edge case)
  if (todos[0].content) return todos[0].content;

  return '';
}

// ============================================================================
// Tool Input Wrappers
// ============================================================================

/**
 * Extract todo content from a TodoWrite tool_input object.
 * Handles unwrapping the outer { todos: [...] } structure.
 */
export function extractTodoContentFromToolInput(toolInput: unknown): string {
  const todosJSON = extractTodosArrayJSON(toolInput);
  if (!todosJSON) return '';
  return extractInProgressTodo(todosJSON);
}

/**
 * Extract last completed todo from a TodoWrite tool_input object.
 */
export function extractLastCompletedTodoFromToolInput(toolInput: unknown): string {
  const todosJSON = extractTodosArrayJSON(toolInput);
  if (!todosJSON) return '';
  return extractLastCompletedTodo(todosJSON);
}

/**
 * Count todos from a TodoWrite tool_input object.
 */
export function countTodosFromToolInput(toolInput: unknown): number {
  const todosJSON = extractTodosArrayJSON(toolInput);
  if (!todosJSON) return 0;
  return countTodos(todosJSON);
}

// ============================================================================
// Formatting
// ============================================================================

/** Maximum length for descriptions in commit messages */
const MAX_DESCRIPTION_LENGTH = 60;

/**
 * Format a commit message for an incremental checkpoint.
 * Format: "<todo-content> (<tool-use-id>)"
 * Fallback: "Checkpoint #<sequence>: <tool-use-id>"
 */
export function formatIncrementalMessage(
  todoContent: string,
  sequence: number,
  toolUseID: string,
): string {
  if (!todoContent) {
    return `Checkpoint #${sequence}: ${toolUseID}`;
  }

  const truncated = truncateDescription(todoContent, MAX_DESCRIPTION_LENGTH);
  return `${truncated} (${toolUseID})`;
}

// ============================================================================
// Internal Helpers
// ============================================================================

function parseTodos(todosJSON: string | Buffer): TodoItem[] | null {
  try {
    const str = typeof todosJSON === 'string' ? todosJSON : todosJSON.toString('utf-8');
    if (!str) return null;
    const parsed = JSON.parse(str) as unknown;
    if (!Array.isArray(parsed)) return null;
    return parsed as TodoItem[];
  } catch {
    return null;
  }
}

function extractTodosArrayJSON(toolInput: unknown): string | null {
  if (!toolInput || typeof toolInput !== 'object') return null;
  const input = toolInput as Record<string, unknown>;
  const todos = input.todos;
  if (!Array.isArray(todos)) return null;
  try {
    return JSON.stringify(todos);
  } catch {
    return null;
  }
}

function truncateDescription(s: string, maxLen: number): string {
  const runes = [...s];
  if (runes.length <= maxLen) return s;
  const suffix = '...';
  const suffixRunes = [...suffix];
  const truncateAt = Math.max(0, maxLen - suffixRunes.length);
  return runes.slice(0, truncateAt).join('') + suffix;
}

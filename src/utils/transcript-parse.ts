/**
 * Transcript Parsing
 *
 * Shared JSONL transcript parsing utilities used by agents
 * that share the same format (Claude Code, Cursor).
 */

import { stripIDEContextTags } from './ide-tags.js';

// ============================================================================
// Types
// ============================================================================

export const TYPE_USER = 'user';
export const TYPE_ASSISTANT = 'assistant';
export const CONTENT_TYPE_TEXT = 'text';
export const CONTENT_TYPE_TOOL_USE = 'tool_use';

export interface TranscriptLine {
  type: string;
  role?: string;
  uuid?: string;
  message: unknown;
}

export interface UserMessage {
  content: unknown;
}

export interface AssistantMessage {
  content: ContentBlock[];
}

export interface ContentBlock {
  type: string;
  text?: string;
  name?: string;
  input?: Record<string, unknown>;
}

export interface ToolInput {
  file_path?: string;
  notebook_path?: string;
  description?: string;
  command?: string;
  pattern?: string;
  skill?: string;
  url?: string;
  prompt?: string;
}

// ============================================================================
// Parsing
// ============================================================================

/**
 * Parse JSONL transcript content from a byte buffer.
 */
export function parseFromBytes(content: Buffer | string): TranscriptLine[] {
  const text = typeof content === 'string' ? content : content.toString('utf-8');
  const lines: TranscriptLine[] = [];

  for (const rawLine of text.split('\n')) {
    if (rawLine.trim().length === 0) continue;
    try {
      const line = JSON.parse(rawLine) as TranscriptLine;
      normalizeLineType(line);
      lines.push(line);
    } catch {
      // Skip malformed JSON lines
    }
  }

  return lines;
}

/**
 * Parse JSONL transcript from a buffer starting from a specific line.
 */
export function parseFromBytesAtLine(
  content: Buffer | string,
  startLine: number,
): TranscriptLine[] {
  const text = typeof content === 'string' ? content : content.toString('utf-8');
  const rawLines = text.split('\n');
  const lines: TranscriptLine[] = [];

  for (let i = startLine; i < rawLines.length; i++) {
    const rawLine = rawLines[i];
    if (rawLine.trim().length === 0) continue;
    try {
      const line = JSON.parse(rawLine) as TranscriptLine;
      normalizeLineType(line);
      lines.push(line);
    } catch {
      // Skip malformed
    }
  }

  return lines;
}

/**
 * Normalize line type: Cursor uses "role" while Claude Code uses "type".
 */
function normalizeLineType(line: TranscriptLine): void {
  if (!line.type && line.role) {
    line.type = line.role;
  }
}

/**
 * Return bytes starting from line N (0-indexed).
 */
export function sliceFromLine(content: Buffer, startLine: number): Buffer {
  if (content.length === 0 || startLine <= 0) {
    return content;
  }

  let lineCount = 0;
  let offset = 0;

  for (let i = 0; i < content.length; i++) {
    if (content[i] === 0x0a) {
      // '\n'
      lineCount++;
      if (lineCount === startLine) {
        offset = i + 1;
        break;
      }
    }
  }

  if (lineCount < startLine) return Buffer.alloc(0);
  if (offset >= content.length) return Buffer.alloc(0);

  return content.subarray(offset);
}

/**
 * Extract user content from a raw transcript message.
 * Handles both string and array content formats.
 * IDE-injected tags are stripped.
 */
export function extractUserContent(message: unknown): string {
  if (!message || typeof message !== 'object') return '';

  const msg = message as Record<string, unknown>;
  const content = msg.content;

  // Handle string content
  if (typeof content === 'string') {
    return stripIDEContextTags(content);
  }

  // Handle array content
  if (Array.isArray(content)) {
    const texts: string[] = [];
    for (const item of content) {
      if (
        item &&
        typeof item === 'object' &&
        (item as Record<string, unknown>).type === CONTENT_TYPE_TEXT
      ) {
        const text = (item as Record<string, unknown>).text;
        if (typeof text === 'string') {
          texts.push(text);
        }
      }
    }
    if (texts.length > 0) {
      return stripIDEContextTags(texts.join('\n\n'));
    }
  }

  return '';
}

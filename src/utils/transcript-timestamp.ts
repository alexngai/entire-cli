/**
 * JSONL Timestamp Extraction
 *
 * Utilities for extracting timestamps from JSONL transcript files.
 * Used for session staleness detection and ordering.
 */

import * as fs from 'node:fs';

/**
 * Parse a timestamp from a single JSONL line.
 * Returns null if the line is empty or doesn't contain a valid ISO timestamp.
 */
export function parseTimestampFromJSONL(line: string): Date | null {
  if (!line) return null;

  try {
    const entry = JSON.parse(line) as { timestamp?: string };
    if (!entry.timestamp) return null;

    const date = new Date(entry.timestamp);
    if (isNaN(date.getTime())) return null;

    return date;
  } catch {
    return null;
  }
}

/**
 * Extract the timestamp from the last non-empty line of JSONL content.
 * Returns null if not found.
 */
export function getLastTimestampFromBytes(data: Buffer | string): Date | null {
  const str = typeof data === 'string' ? data : data.toString('utf-8');
  const lines = str.split('\n');

  let lastLine = '';
  for (const line of lines) {
    if (line.trim()) {
      lastLine = line;
    }
  }

  return parseTimestampFromJSONL(lastLine);
}

/**
 * Read the last non-empty line from a JSONL file and extract the timestamp.
 * Returns null if file doesn't exist or no valid timestamp is found.
 */
export async function getLastTimestampFromFile(filePath: string): Promise<Date | null> {
  try {
    const content = await fs.promises.readFile(filePath, 'utf-8');
    return getLastTimestampFromBytes(content);
  } catch {
    return null;
  }
}

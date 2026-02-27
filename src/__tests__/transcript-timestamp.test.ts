/**
 * Tests for Transcript Timestamp Extraction
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import {
  parseTimestampFromJSONL,
  getLastTimestampFromBytes,
  getLastTimestampFromFile,
} from '../utils/transcript-timestamp.js';

describe('Transcript Timestamp Extraction', () => {
  describe('parseTimestampFromJSONL', () => {
    it('should parse valid ISO timestamp', () => {
      const line = JSON.stringify({ timestamp: '2025-01-15T10:30:00Z', type: 'user' });
      const result = parseTimestampFromJSONL(line);
      expect(result).not.toBeNull();
      expect(result!.toISOString()).toBe('2025-01-15T10:30:00.000Z');
    });

    it('should parse timestamp with offset', () => {
      const line = JSON.stringify({ timestamp: '2025-06-15T10:30:00+05:00' });
      const result = parseTimestampFromJSONL(line);
      expect(result).not.toBeNull();
    });

    it('should return null for empty string', () => {
      expect(parseTimestampFromJSONL('')).toBeNull();
    });

    it('should return null for invalid JSON', () => {
      expect(parseTimestampFromJSONL('not json')).toBeNull();
    });

    it('should return null for missing timestamp field', () => {
      const line = JSON.stringify({ type: 'user', message: 'hello' });
      expect(parseTimestampFromJSONL(line)).toBeNull();
    });

    it('should return null for invalid timestamp', () => {
      const line = JSON.stringify({ timestamp: 'not-a-date' });
      expect(parseTimestampFromJSONL(line)).toBeNull();
    });
  });

  describe('getLastTimestampFromBytes', () => {
    it('should get timestamp from last line', () => {
      const content = [
        JSON.stringify({ timestamp: '2025-01-15T10:00:00Z', type: 'user' }),
        JSON.stringify({ timestamp: '2025-01-15T10:05:00Z', type: 'assistant' }),
        JSON.stringify({ timestamp: '2025-01-15T10:10:00Z', type: 'user' }),
      ].join('\n');

      const result = getLastTimestampFromBytes(content);
      expect(result).not.toBeNull();
      expect(result!.toISOString()).toBe('2025-01-15T10:10:00.000Z');
    });

    it('should skip trailing empty lines', () => {
      const content = JSON.stringify({ timestamp: '2025-01-15T10:00:00Z' }) + '\n\n\n';
      const result = getLastTimestampFromBytes(content);
      expect(result).not.toBeNull();
      expect(result!.toISOString()).toBe('2025-01-15T10:00:00.000Z');
    });

    it('should return null for empty content', () => {
      expect(getLastTimestampFromBytes('')).toBeNull();
      expect(getLastTimestampFromBytes(Buffer.alloc(0))).toBeNull();
    });

    it('should handle Buffer input', () => {
      const buf = Buffer.from(JSON.stringify({ timestamp: '2025-01-15T10:00:00Z' }) + '\n');
      const result = getLastTimestampFromBytes(buf);
      expect(result).not.toBeNull();
    });

    it('should return null if no lines have timestamps', () => {
      const content = [
        JSON.stringify({ type: 'user' }),
        JSON.stringify({ type: 'assistant' }),
      ].join('\n');
      expect(getLastTimestampFromBytes(content)).toBeNull();
    });
  });

  describe('getLastTimestampFromFile', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'timestamp-test-'));
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it('should read timestamp from file', async () => {
      const filePath = path.join(tmpDir, 'transcript.jsonl');
      fs.writeFileSync(filePath, JSON.stringify({ timestamp: '2025-01-15T10:00:00Z' }) + '\n');

      const result = await getLastTimestampFromFile(filePath);
      expect(result).not.toBeNull();
      expect(result!.toISOString()).toBe('2025-01-15T10:00:00.000Z');
    });

    it('should return null for missing file', async () => {
      const result = await getLastTimestampFromFile('/nonexistent/file.jsonl');
      expect(result).toBeNull();
    });

    it('should return null for file without timestamps', async () => {
      const filePath = path.join(tmpDir, 'no-timestamps.jsonl');
      fs.writeFileSync(filePath, JSON.stringify({ type: 'user' }) + '\n');
      const result = await getLastTimestampFromFile(filePath);
      expect(result).toBeNull();
    });
  });
});

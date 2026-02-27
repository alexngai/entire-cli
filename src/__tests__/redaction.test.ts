/**
 * Tests for Secret Redaction
 */

import { describe, it, expect } from 'vitest';
import { shannonEntropy, detectSecrets, redactString, redactJSONL } from '../security/redaction.js';

describe('Secret Redaction', () => {
  describe('shannonEntropy', () => {
    it('should return 0 for empty string', () => {
      expect(shannonEntropy('')).toBe(0);
    });

    it('should return 0 for single-character string', () => {
      expect(shannonEntropy('a')).toBe(0);
    });

    it('should return low entropy for repeated characters', () => {
      expect(shannonEntropy('aaaaaaaaaa')).toBe(0);
    });

    it('should return higher entropy for varied characters', () => {
      const entropy = shannonEntropy('abcdefghij');
      expect(entropy).toBeGreaterThan(3);
    });

    it('should return high entropy for random-looking strings', () => {
      const entropy = shannonEntropy('k8sF3mR9pLzX7qNvA2wJ');
      expect(entropy).toBeGreaterThan(4);
    });
  });

  describe('detectSecrets', () => {
    it('should detect high-entropy strings', () => {
      const text = 'api_key=k8sF3mR9pLzX7qNvA2wJbTcYdEhGiKlM';
      const regions = detectSecrets(text);
      expect(regions.length).toBeGreaterThan(0);
    });

    it('should detect known API key patterns', () => {
      const text = 'token: ghp_1234567890abcdefghijklmnopqrstuvwxyz';
      const regions = detectSecrets(text);
      expect(regions.length).toBeGreaterThan(0);
    });

    it('should detect AWS access keys', () => {
      const text = 'aws_key: AKIAIOSFODNN7EXAMPLE';
      const regions = detectSecrets(text);
      expect(regions.length).toBeGreaterThan(0);
    });

    it('should not detect normal text', () => {
      const text = 'Hello world, this is a normal message.';
      const regions = detectSecrets(text);
      expect(regions).toHaveLength(0);
    });

    it('should detect Anthropic API keys', () => {
      const text = 'key: sk-ant-' + 'a'.repeat(90);
      const regions = detectSecrets(text);
      expect(regions.length).toBeGreaterThan(0);
    });
  });

  describe('redactString', () => {
    it('should redact high-entropy strings', () => {
      const text = 'password=k8sF3mR9pLzX7qNvA2wJbTcY';
      const result = redactString(text);
      expect(result).toContain('REDACTED');
      expect(result).not.toContain('k8sF3mR9');
    });

    it('should not modify normal text', () => {
      const text = 'This is perfectly normal text.';
      expect(redactString(text)).toBe(text);
    });

    it('should redact GitHub tokens', () => {
      const text = 'GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz';
      const result = redactString(text);
      expect(result).toContain('REDACTED');
    });
  });

  describe('redactJSONL', () => {
    it('should redact secrets in JSONL values', () => {
      const line = JSON.stringify({
        type: 'assistant',
        message: { content: 'The key is ghp_1234567890abcdefghijklmnopqrstuvwxyz' },
      });
      const result = redactJSONL(line);
      const parsed = JSON.parse(result);
      expect(parsed.message.content).toContain('REDACTED');
    });

    it('should preserve safe fields', () => {
      const line = JSON.stringify({
        type: 'user',
        uuid: 'abc-123',
        session_id: 'session-456',
      });
      const result = redactJSONL(line);
      const parsed = JSON.parse(result);
      expect(parsed.uuid).toBe('abc-123');
      expect(parsed.session_id).toBe('session-456');
      expect(parsed.type).toBe('user');
    });

    it('should handle multiple lines', () => {
      const lines = [
        JSON.stringify({ type: 'user', message: 'hello' }),
        JSON.stringify({ type: 'assistant', message: 'world' }),
      ].join('\n');
      const result = redactJSONL(lines);
      const parts = result.split('\n').filter(Boolean);
      expect(parts).toHaveLength(2);
    });

    it('should handle malformed JSON gracefully', () => {
      const input = 'not json {{{';
      const result = redactJSONL(input);
      expect(result).toBeDefined();
    });

    it('should skip image objects', () => {
      const line = JSON.stringify({
        type: 'assistant',
        content: [{ type: 'image', data: 'k8sF3mR9pLzX7qNvA2wJbTcY' }],
      });
      const result = redactJSONL(line);
      const parsed = JSON.parse(result);
      // Image objects should be preserved as-is
      expect(parsed.content[0].data).toBe('k8sF3mR9pLzX7qNvA2wJbTcY');
    });
  });
});

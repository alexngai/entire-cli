/**
 * Tests for Claude Generator
 *
 * Tests the module structure and options handling. Actual CLI invocation
 * is not tested (would require a real claude binary).
 */

import { describe, it, expect } from 'vitest';
import { createClaudeGenerator, DEFAULT_SUMMARIZE_MODEL } from '../summarize/claude-generator.js';

describe('Claude Generator', () => {
  describe('DEFAULT_SUMMARIZE_MODEL', () => {
    it('should be sonnet', () => {
      expect(DEFAULT_SUMMARIZE_MODEL).toBe('sonnet');
    });
  });

  describe('createClaudeGenerator', () => {
    it('should create a generator with default options', () => {
      const generator = createClaudeGenerator();
      expect(generator).toBeDefined();
      expect(typeof generator.generate).toBe('function');
    });

    it('should create a generator with custom options', () => {
      const generator = createClaudeGenerator({
        claudePath: '/usr/local/bin/claude',
        model: 'opus',
      });
      expect(generator).toBeDefined();
    });

    it('should reject when claude is not found', async () => {
      const generator = createClaudeGenerator({
        claudePath: '/nonexistent/claude-binary-that-does-not-exist',
      });

      await expect(
        generator.generate({
          transcript: [{ type: 'user', content: 'Hello' }],
          filesTouched: [],
        }),
      ).rejects.toThrow(/not found|ENOENT/);
    });
  });
});

/**
 * Tests for Input Validation
 */

import { describe, it, expect } from 'vitest';
import {
  validateSessionID,
  validateToolUseID,
  validateAgentID,
  validateAgentSessionID,
} from '../utils/validation.js';

describe('Input Validation', () => {
  describe('validateSessionID', () => {
    it('should accept valid session IDs', () => {
      expect(() => validateSessionID('abc-123')).not.toThrow();
      expect(() => validateSessionID('2025-01-01-session')).not.toThrow();
      expect(() => validateSessionID('a')).not.toThrow();
    });

    it('should reject empty session ID', () => {
      expect(() => validateSessionID('')).toThrow('cannot be empty');
    });

    it('should reject forward slash', () => {
      expect(() => validateSessionID('foo/bar')).toThrow('path separators');
    });

    it('should reject backslash', () => {
      expect(() => validateSessionID('foo\\bar')).toThrow('path separators');
    });

    it('should reject path traversal attempts', () => {
      expect(() => validateSessionID('../etc/passwd')).toThrow('path separators');
      expect(() => validateSessionID('..\\windows\\system32')).toThrow('path separators');
    });

    it('should allow dots without slashes', () => {
      expect(() => validateSessionID('session.1')).not.toThrow();
      expect(() => validateSessionID('...')).not.toThrow();
    });
  });

  describe('validateToolUseID', () => {
    it('should accept valid tool use IDs', () => {
      expect(() => validateToolUseID('toolu_abc123')).not.toThrow();
      expect(() => validateToolUseID('abc-def-123')).not.toThrow();
    });

    it('should accept empty (optional field)', () => {
      expect(() => validateToolUseID('')).not.toThrow();
    });

    it('should reject IDs with slashes', () => {
      expect(() => validateToolUseID('foo/bar')).toThrow('alphanumeric');
    });

    it('should reject IDs with spaces', () => {
      expect(() => validateToolUseID('foo bar')).toThrow('alphanumeric');
    });

    it('should reject IDs with dots', () => {
      expect(() => validateToolUseID('foo.bar')).toThrow('alphanumeric');
    });
  });

  describe('validateAgentID', () => {
    it('should accept valid agent IDs', () => {
      expect(() => validateAgentID('claude-code')).not.toThrow();
      expect(() => validateAgentID('agent_1')).not.toThrow();
    });

    it('should accept empty (optional field)', () => {
      expect(() => validateAgentID('')).not.toThrow();
    });

    it('should reject IDs with special characters', () => {
      expect(() => validateAgentID('agent@1')).toThrow('alphanumeric');
      expect(() => validateAgentID('agent:1')).toThrow('alphanumeric');
    });
  });

  describe('validateAgentSessionID', () => {
    it('should accept valid agent session IDs', () => {
      expect(() =>
        validateAgentSessionID('2025-01-01-8f76b0e8-b8f1-4a87-9186-848bdd83d62e'),
      ).not.toThrow();
      expect(() => validateAgentSessionID('session_123')).not.toThrow();
    });

    it('should reject empty agent session ID', () => {
      expect(() => validateAgentSessionID('')).toThrow('cannot be empty');
    });

    it('should reject IDs with path separators', () => {
      expect(() => validateAgentSessionID('foo/bar')).toThrow('alphanumeric');
    });

    it('should reject IDs with spaces', () => {
      expect(() => validateAgentSessionID('foo bar')).toThrow('alphanumeric');
    });
  });
});

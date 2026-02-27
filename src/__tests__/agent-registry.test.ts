/**
 * Tests for Agent Registry
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
  registerAgent,
  getAgent,
  listAgentNames,
  listAgents,
  getDefaultAgent,
  resolveAgent,
  resetRegistry,
} from '../agent/registry.js';
import { AGENT_NAMES, AGENT_TYPES } from '../types.js';
import type { Agent } from '../agent/types.js';

function createMockAgent(name: string, type: string): Agent {
  return {
    name,
    type,
    description: `Mock ${name} agent`,
    isPreview: false,
    protectedDirs: [`.${name}`],
    detectPresence: async () => false,
    getSessionDir: async () => '/mock/sessions',
    getSessionID: (input) => input.sessionID,
    resolveSessionFile: (dir, id) => `${dir}/${id}.jsonl`,
    readTranscript: async () => Buffer.from(''),
    formatResumeCommand: (id) => `mock --resume ${id}`,
  };
}

describe('Agent Registry', () => {
  beforeEach(() => {
    resetRegistry();
  });

  it('should register and retrieve an agent', () => {
    const agent = createMockAgent('test-agent', 'Test Agent');
    registerAgent('test-agent', () => agent);

    const retrieved = getAgent('test-agent');
    expect(retrieved).not.toBeNull();
    expect(retrieved!.name).toBe('test-agent');
    expect(retrieved!.type).toBe('Test Agent');
  });

  it('should return null for unknown agent', () => {
    expect(getAgent('nonexistent')).toBeNull();
  });

  it('should list registered agent names', () => {
    registerAgent('alpha', () => createMockAgent('alpha', 'Alpha'));
    registerAgent('beta', () => createMockAgent('beta', 'Beta'));

    const names = listAgentNames();
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
    // Should be sorted
    expect(names[0]).toBe('alpha');
  });

  it('should list all agents', () => {
    registerAgent('agent-a', () => createMockAgent('agent-a', 'Agent A'));
    registerAgent('agent-b', () => createMockAgent('agent-b', 'Agent B'));

    const agents = listAgents();
    expect(agents).toHaveLength(2);
  });

  it('should cache agent instances', () => {
    let callCount = 0;
    registerAgent('cached', () => {
      callCount++;
      return createMockAgent('cached', 'Cached');
    });

    getAgent('cached');
    getAgent('cached');
    getAgent('cached');

    expect(callCount).toBe(1);
  });

  it('should resolve by name', () => {
    registerAgent('test', () => createMockAgent('test', 'Test'));

    const agent = resolveAgent('test');
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe('test');
  });

  it('should resolve by type', () => {
    registerAgent('my-agent', () => createMockAgent('my-agent', 'My Agent'));

    const agent = resolveAgent('My Agent');
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe('my-agent');
  });

  it('should return null for unresolvable', () => {
    expect(resolveAgent('nonexistent')).toBeNull();
  });

  it('should return default agent when registered', () => {
    registerAgent(AGENT_NAMES.CLAUDE_CODE, () =>
      createMockAgent(AGENT_NAMES.CLAUDE_CODE, AGENT_TYPES.CLAUDE_CODE),
    );

    const agent = getDefaultAgent();
    expect(agent).not.toBeNull();
    expect(agent!.name).toBe('claude-code');
  });

  it('should return null default when not registered', () => {
    expect(getDefaultAgent()).toBeNull();
  });

  it('should reset the registry', () => {
    registerAgent('temp', () => createMockAgent('temp', 'Temp'));
    expect(listAgentNames()).toHaveLength(1);

    resetRegistry();
    expect(listAgentNames()).toHaveLength(0);
  });
});

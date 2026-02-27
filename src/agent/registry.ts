/**
 * Agent Registry
 *
 * Central registry for AI agent implementations. Agents register
 * themselves via factory functions and are discovered at runtime.
 */

import type { AgentName, AgentType } from '../types.js';
import { DEFAULT_AGENT_NAME } from '../types.js';
import type { Agent } from './types.js';

// ============================================================================
// Types
// ============================================================================

export type AgentFactory = () => Agent;

// ============================================================================
// Registry
// ============================================================================

const agents = new Map<AgentName, AgentFactory>();
let cachedInstances = new Map<AgentName, Agent>();

/**
 * Register an agent factory
 */
export function registerAgent(name: AgentName, factory: AgentFactory): void {
  agents.set(name, factory);
  cachedInstances.delete(name);
}

/**
 * Get an agent by name
 */
export function getAgent(name: AgentName): Agent | null {
  const cached = cachedInstances.get(name);
  if (cached) return cached;

  const factory = agents.get(name);
  if (!factory) return null;

  const instance = factory();
  cachedInstances.set(name, instance);
  return instance;
}

/**
 * List all registered agent names (sorted)
 */
export function listAgentNames(): AgentName[] {
  return Array.from(agents.keys()).sort();
}

/**
 * Get all registered agents
 */
export function listAgents(): Agent[] {
  return listAgentNames().map((name) => getAgent(name)!);
}

/**
 * Detect which agents are present in the current environment
 */
export async function detectAgents(cwd?: string): Promise<Agent[]> {
  const detected: Agent[] = [];

  for (const name of listAgentNames()) {
    const agent = getAgent(name);
    if (!agent) continue;

    try {
      const present = await agent.detectPresence(cwd);
      if (present) detected.push(agent);
    } catch {
      // Skip agents that fail detection
    }
  }

  return detected;
}

/**
 * Auto-detect the first present agent
 */
export async function detectAgent(cwd?: string): Promise<Agent | null> {
  const agents = await detectAgents(cwd);
  return agents[0] ?? null;
}

/**
 * Get an agent by its human-readable type
 */
export function getAgentByType(agentType: AgentType): Agent | null {
  for (const name of listAgentNames()) {
    const agent = getAgent(name);
    if (agent && agent.type === agentType) return agent;
  }
  return null;
}

/**
 * Get the default agent
 */
export function getDefaultAgent(): Agent | null {
  return getAgent(DEFAULT_AGENT_NAME);
}

/**
 * Get the union of all protected directories across all agents
 */
export function allProtectedDirs(): string[] {
  const dirs = new Set<string>();
  for (const name of listAgentNames()) {
    const agent = getAgent(name);
    if (agent) {
      for (const dir of agent.protectedDirs) {
        dirs.add(dir);
      }
    }
  }
  return Array.from(dirs);
}

/**
 * Resolve an agent name, trying exact match then type match
 */
export function resolveAgent(nameOrType: string): Agent | null {
  // Try exact name match
  const byName = getAgent(nameOrType);
  if (byName) return byName;

  // Try type match
  return getAgentByType(nameOrType);
}

/**
 * Reset the registry (for testing)
 */
export function resetRegistry(): void {
  agents.clear();
  cachedInstances = new Map();
}

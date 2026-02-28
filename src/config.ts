/**
 * Configuration Management
 *
 * Loads and manages Sessionlog settings from .sessionlog/settings.json
 * and .sessionlog/settings.local.json (local overrides).
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  type SessionlogSettings,
  DEFAULT_SETTINGS,
  SESSIONLOG_SETTINGS_FILE,
  SESSIONLOG_SETTINGS_LOCAL_FILE,
  SESSIONLOG_DIR,
} from './types.js';
import { getWorktreeRoot } from './git-operations.js';
import { atomicWriteFile } from './git-operations.js';

// ============================================================================
// Load Settings
// ============================================================================

/**
 * Load effective settings (project merged with local overrides)
 */
export async function loadSettings(cwd?: string): Promise<SessionlogSettings> {
  const project = await loadProjectSettings(cwd);
  const local = await loadLocalSettings(cwd);
  return mergeSettings(project, local);
}

/**
 * Load project-level settings (.sessionlog/settings.json)
 */
export async function loadProjectSettings(cwd?: string): Promise<SessionlogSettings> {
  const root = cwd ?? (await getWorktreeRoot());
  const settingsPath = path.join(root, SESSIONLOG_SETTINGS_FILE);
  return loadSettingsFile(settingsPath);
}

/**
 * Load local settings (.sessionlog/settings.local.json)
 */
export async function loadLocalSettings(cwd?: string): Promise<SessionlogSettings> {
  const root = cwd ?? (await getWorktreeRoot());
  const settingsPath = path.join(root, SESSIONLOG_SETTINGS_LOCAL_FILE);
  return loadSettingsFile(settingsPath);
}

function loadSettingsFile(filePath: string): SessionlogSettings {
  try {
    const content = fs.readFileSync(filePath, 'utf-8');
    const data = JSON.parse(content) as Partial<SessionlogSettings>;
    return { ...DEFAULT_SETTINGS, ...data };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

function mergeSettings(project: SessionlogSettings, local: SessionlogSettings): SessionlogSettings {
  return {
    enabled: local.enabled !== DEFAULT_SETTINGS.enabled ? local.enabled : project.enabled,
    strategy: local.strategy !== DEFAULT_SETTINGS.strategy ? local.strategy : project.strategy,
    logLevel: local.logLevel ?? project.logLevel,
    skipPushSessions: local.skipPushSessions ?? project.skipPushSessions,
    telemetryEnabled: local.telemetryEnabled ?? project.telemetryEnabled,
    summarizationEnabled: local.summarizationEnabled ?? project.summarizationEnabled,
    sessionRepoPath: local.sessionRepoPath ?? project.sessionRepoPath,
  };
}

// ============================================================================
// Save Settings
// ============================================================================

/**
 * Save project-level settings
 */
export async function saveProjectSettings(
  settings: Partial<SessionlogSettings>,
  cwd?: string,
): Promise<void> {
  const root = cwd ?? (await getWorktreeRoot());
  const settingsPath = path.join(root, SESSIONLOG_SETTINGS_FILE);
  await ensureSessionlogDir(root);
  await atomicWriteFile(settingsPath, JSON.stringify(settings, null, 2));
}

/**
 * Save local settings
 */
export async function saveLocalSettings(
  settings: Partial<SessionlogSettings>,
  cwd?: string,
): Promise<void> {
  const root = cwd ?? (await getWorktreeRoot());
  const settingsPath = path.join(root, SESSIONLOG_SETTINGS_LOCAL_FILE);
  await ensureSessionlogDir(root);
  await atomicWriteFile(settingsPath, JSON.stringify(settings, null, 2));
}

// ============================================================================
// Queries
// ============================================================================

/**
 * Check if Sessionlog is enabled in the current repository
 */
export async function isEnabled(cwd?: string): Promise<boolean> {
  const settings = await loadSettings(cwd);
  return settings.enabled;
}

/**
 * Get the current strategy name
 */
export async function getStrategy(cwd?: string): Promise<string> {
  const settings = await loadSettings(cwd);
  return settings.strategy;
}

// ============================================================================
// Helpers
// ============================================================================

async function ensureSessionlogDir(root: string): Promise<void> {
  const dir = path.join(root, SESSIONLOG_DIR);
  await fs.promises.mkdir(dir, { recursive: true });
}

/**
 * Ensure the .sessionlog directory is gitignored for local files
 */
export async function ensureGitignore(cwd?: string): Promise<void> {
  const root = cwd ?? (await getWorktreeRoot());
  const gitignorePath = path.join(root, SESSIONLOG_DIR, '.gitignore');

  const content = [
    '# Sessionlog local files (not committed)',
    'settings.local.json',
    'tmp/',
    'logs/',
    '',
  ].join('\n');

  try {
    await fs.promises.access(gitignorePath);
    // Already exists
  } catch {
    await ensureSessionlogDir(root);
    await fs.promises.writeFile(gitignorePath, content);
  }
}

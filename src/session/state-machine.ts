/**
 * Session State Machine
 *
 * Pure-function state machine for session lifecycle transitions.
 * Ported from Go: session/phase.go
 *
 * The state machine computes the next phase and required actions given the
 * current phase and an event. ApplyTransition executes side effects.
 */

// ============================================================================
// Phase
// ============================================================================

export type Phase = 'active' | 'idle' | 'ended';

/**
 * Normalize a phase string, treating empty or unknown values as 'idle'
 * for backward compatibility with pre-state-machine session files.
 */
export function phaseFromString(s: string | undefined): Phase {
  switch (s) {
    case 'active':
    case 'active_committed':
      // "active_committed" was removed with the 1:1 checkpoint model.
      return 'active';
    case 'idle':
      return 'idle';
    case 'ended':
      return 'ended';
    default:
      return 'idle';
  }
}

// ============================================================================
// Event
// ============================================================================

export const enum StateMachineEvent {
  TurnStart = 0,
  TurnEnd = 1,
  GitCommit = 2,
  SessionStart = 3,
  SessionStop = 4,
  Compaction = 5,
}

const ALL_EVENTS: StateMachineEvent[] = [
  StateMachineEvent.TurnStart,
  StateMachineEvent.TurnEnd,
  StateMachineEvent.GitCommit,
  StateMachineEvent.SessionStart,
  StateMachineEvent.SessionStop,
  StateMachineEvent.Compaction,
];

export function eventToString(e: StateMachineEvent): string {
  switch (e) {
    case StateMachineEvent.TurnStart:
      return 'TurnStart';
    case StateMachineEvent.TurnEnd:
      return 'TurnEnd';
    case StateMachineEvent.GitCommit:
      return 'GitCommit';
    case StateMachineEvent.SessionStart:
      return 'SessionStart';
    case StateMachineEvent.SessionStop:
      return 'SessionStop';
    case StateMachineEvent.Compaction:
      return 'Compaction';
    default:
      return `Event(${e})`;
  }
}

// ============================================================================
// Action
// ============================================================================

export const enum Action {
  Condense = 0,
  CondenseIfFilesTouched = 1,
  DiscardIfNoFiles = 2,
  WarnStaleSession = 3,
  ClearEndedAt = 4,
  UpdateLastInteraction = 5,
}

export function actionToString(a: Action): string {
  switch (a) {
    case Action.Condense:
      return 'Condense';
    case Action.CondenseIfFilesTouched:
      return 'CondenseIfFilesTouched';
    case Action.DiscardIfNoFiles:
      return 'DiscardIfNoFiles';
    case Action.WarnStaleSession:
      return 'WarnStaleSession';
    case Action.ClearEndedAt:
      return 'ClearEndedAt';
    case Action.UpdateLastInteraction:
      return 'UpdateLastInteraction';
    default:
      return `Action(${a})`;
  }
}

// ============================================================================
// Transition Context & Result
// ============================================================================

export interface TransitionContext {
  hasFilesTouched: boolean;
  isRebaseInProgress: boolean;
}

export interface TransitionResult {
  newPhase: Phase;
  actions: Action[];
}

// ============================================================================
// Transition — pure function, no side effects
// ============================================================================

export function transition(
  current: Phase,
  event: StateMachineEvent,
  ctx: TransitionContext,
): TransitionResult {
  current = phaseFromString(current);

  switch (current) {
    case 'idle':
      return transitionFromIdle(event, ctx);
    case 'active':
      return transitionFromActive(event, ctx);
    case 'ended':
      return transitionFromEnded(event, ctx);
    default:
      return { newPhase: 'idle', actions: [] };
  }
}

function transitionFromIdle(event: StateMachineEvent, ctx: TransitionContext): TransitionResult {
  switch (event) {
    case StateMachineEvent.TurnStart:
      return {
        newPhase: 'active',
        actions: [Action.UpdateLastInteraction],
      };
    case StateMachineEvent.TurnEnd:
      return { newPhase: 'idle', actions: [] };
    case StateMachineEvent.GitCommit:
      if (ctx.isRebaseInProgress) {
        return { newPhase: 'idle', actions: [] };
      }
      return {
        newPhase: 'idle',
        actions: [Action.Condense, Action.UpdateLastInteraction],
      };
    case StateMachineEvent.SessionStart:
      return { newPhase: 'idle', actions: [] };
    case StateMachineEvent.SessionStop:
      return {
        newPhase: 'ended',
        actions: [Action.UpdateLastInteraction],
      };
    case StateMachineEvent.Compaction:
      return {
        newPhase: 'idle',
        actions: [Action.CondenseIfFilesTouched, Action.UpdateLastInteraction],
      };
    default:
      return { newPhase: 'idle', actions: [] };
  }
}

function transitionFromActive(event: StateMachineEvent, ctx: TransitionContext): TransitionResult {
  switch (event) {
    case StateMachineEvent.TurnStart:
      return {
        newPhase: 'active',
        actions: [Action.UpdateLastInteraction],
      };
    case StateMachineEvent.TurnEnd:
      return {
        newPhase: 'idle',
        actions: [Action.UpdateLastInteraction],
      };
    case StateMachineEvent.GitCommit:
      if (ctx.isRebaseInProgress) {
        return { newPhase: 'active', actions: [] };
      }
      return {
        newPhase: 'active',
        actions: [Action.Condense, Action.UpdateLastInteraction],
      };
    case StateMachineEvent.SessionStart:
      return {
        newPhase: 'active',
        actions: [Action.WarnStaleSession],
      };
    case StateMachineEvent.SessionStop:
      return {
        newPhase: 'ended',
        actions: [Action.UpdateLastInteraction],
      };
    case StateMachineEvent.Compaction:
      return {
        newPhase: 'active',
        actions: [Action.CondenseIfFilesTouched, Action.UpdateLastInteraction],
      };
    default:
      return { newPhase: 'active', actions: [] };
  }
}

function transitionFromEnded(event: StateMachineEvent, ctx: TransitionContext): TransitionResult {
  switch (event) {
    case StateMachineEvent.TurnStart:
      return {
        newPhase: 'active',
        actions: [Action.ClearEndedAt, Action.UpdateLastInteraction],
      };
    case StateMachineEvent.TurnEnd:
      return { newPhase: 'ended', actions: [] };
    case StateMachineEvent.GitCommit:
      if (ctx.isRebaseInProgress) {
        return { newPhase: 'ended', actions: [] };
      }
      if (ctx.hasFilesTouched) {
        return {
          newPhase: 'ended',
          actions: [Action.CondenseIfFilesTouched, Action.UpdateLastInteraction],
        };
      }
      return {
        newPhase: 'ended',
        actions: [Action.DiscardIfNoFiles, Action.UpdateLastInteraction],
      };
    case StateMachineEvent.SessionStart:
      return {
        newPhase: 'idle',
        actions: [Action.ClearEndedAt],
      };
    case StateMachineEvent.SessionStop:
      return { newPhase: 'ended', actions: [] };
    case StateMachineEvent.Compaction:
      return { newPhase: 'ended', actions: [] };
    default:
      return { newPhase: 'ended', actions: [] };
  }
}

// ============================================================================
// Action Handler
// ============================================================================

export interface ActionHandler {
  handleCondense(state: StateMachineState): Promise<void>;
  handleCondenseIfFilesTouched(state: StateMachineState): Promise<void>;
  handleDiscardIfNoFiles(state: StateMachineState): Promise<void>;
  handleWarnStaleSession(state: StateMachineState): Promise<void>;
}

export class NoOpActionHandler implements ActionHandler {
  async handleCondense(): Promise<void> {}
  async handleCondenseIfFilesTouched(): Promise<void> {}
  async handleDiscardIfNoFiles(): Promise<void> {}
  async handleWarnStaleSession(): Promise<void> {}
}

// ============================================================================
// Apply Transition
// ============================================================================

export interface StateMachineState {
  sessionID: string;
  phase: Phase;
  filesTouched: string[];
  lastInteractionTime?: string;
  endedAt?: string;
}

/**
 * Apply a TransitionResult to state: sets the new phase, then executes
 * all actions. Common actions (UpdateLastInteraction, ClearEndedAt)
 * always run. Strategy-specific handler actions stop on first error.
 */
export async function applyTransition(
  state: StateMachineState,
  result: TransitionResult,
  handler: ActionHandler,
): Promise<Error | null> {
  state.phase = result.newPhase;

  let handlerErr: Error | null = null;

  for (const action of result.actions) {
    switch (action) {
      case Action.UpdateLastInteraction:
        state.lastInteractionTime = new Date().toISOString();
        break;
      case Action.ClearEndedAt:
        state.endedAt = undefined;
        break;
      case Action.Condense:
        if (!handlerErr) {
          try {
            await handler.handleCondense(state);
          } catch (e) {
            handlerErr = e instanceof Error ? e : new Error(String(e));
          }
        }
        break;
      case Action.CondenseIfFilesTouched:
        if (!handlerErr) {
          try {
            await handler.handleCondenseIfFilesTouched(state);
          } catch (e) {
            handlerErr = e instanceof Error ? e : new Error(String(e));
          }
        }
        break;
      case Action.DiscardIfNoFiles:
        if (!handlerErr) {
          try {
            await handler.handleDiscardIfNoFiles(state);
          } catch (e) {
            handlerErr = e instanceof Error ? e : new Error(String(e));
          }
        }
        break;
      case Action.WarnStaleSession:
        if (!handlerErr) {
          try {
            await handler.handleWarnStaleSession(state);
          } catch (e) {
            handlerErr = e instanceof Error ? e : new Error(String(e));
          }
        }
        break;
    }
  }

  return handlerErr;
}

// ============================================================================
// Session State Helpers
// ============================================================================

/** Duration after which a session is considered stale (7 days) */
export const STALE_SESSION_THRESHOLD_MS = 7 * 24 * 60 * 60 * 1000;

/**
 * Returns true when the session's last interaction exceeds the stale threshold.
 */
export function isStale(lastInteractionTime: string | undefined): boolean {
  if (!lastInteractionTime) return false;
  return Date.now() - new Date(lastInteractionTime).getTime() > STALE_SESSION_THRESHOLD_MS;
}

/**
 * Normalize session state after loading from disk.
 * Migrates legacy phase values and deprecated transcript fields.
 */
export function normalizeAfterLoad(state: {
  phase?: string;
  checkpointTranscriptStart?: number;
  condensedTranscriptLines?: number;
  transcriptLinesAtStart?: number;
  attributionBaseCommit?: string;
  baseCommit?: string;
}): void {
  // Normalize legacy phase values
  state.phase = phaseFromString(state.phase);

  // Migrate transcript fields
  if (!state.checkpointTranscriptStart) {
    if (state.condensedTranscriptLines && state.condensedTranscriptLines > 0) {
      state.checkpointTranscriptStart = state.condensedTranscriptLines;
    } else if (state.transcriptLinesAtStart && state.transcriptLinesAtStart > 0) {
      state.checkpointTranscriptStart = state.transcriptLinesAtStart;
    }
  }
  // Clear deprecated fields
  state.condensedTranscriptLines = 0;
  state.transcriptLinesAtStart = 0;

  // Backfill attributionBaseCommit
  if (!state.attributionBaseCommit && state.baseCommit) {
    state.attributionBaseCommit = state.baseCommit;
  }
}

// ============================================================================
// Mermaid Diagram
// ============================================================================

const ALL_PHASES: Phase[] = ['idle', 'active', 'ended'];

/**
 * Generate a Mermaid state diagram from the transition table.
 */
export function mermaidDiagram(): string {
  const lines: string[] = ['stateDiagram-v2'];
  lines.push('    state "IDLE" as idle');
  lines.push('    state "ACTIVE" as active');
  lines.push('    state "ENDED" as ended');
  lines.push('');

  for (const phase of ALL_PHASES) {
    for (const event of ALL_EVENTS) {
      interface ContextVariant {
        label: string;
        ctx: TransitionContext;
      }

      let variants: ContextVariant[];

      if (event === StateMachineEvent.GitCommit && phase === 'ended') {
        variants = [
          { label: '[files]', ctx: { hasFilesTouched: true, isRebaseInProgress: false } },
          { label: '[no files]', ctx: { hasFilesTouched: false, isRebaseInProgress: false } },
          { label: '[rebase]', ctx: { hasFilesTouched: false, isRebaseInProgress: true } },
        ];
      } else if (event === StateMachineEvent.GitCommit) {
        variants = [
          { label: '', ctx: { hasFilesTouched: false, isRebaseInProgress: false } },
          { label: '[rebase]', ctx: { hasFilesTouched: false, isRebaseInProgress: true } },
        ];
      } else {
        variants = [{ label: '', ctx: { hasFilesTouched: false, isRebaseInProgress: false } }];
      }

      for (const v of variants) {
        const result = transition(phase, event, v.ctx);
        let label = eventToString(event);
        if (v.label) label += ' ' + v.label;
        if (result.actions.length > 0) {
          label += ' / ' + result.actions.map(actionToString).join(', ');
        }
        lines.push(`    ${phase} --> ${result.newPhase} : ${label}`);
      }
    }
  }

  return lines.join('\n') + '\n';
}

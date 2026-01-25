/**
 * Context System for Keybindings
 *
 * Contexts are flags that describe the current state of the application.
 * Keybindings can be conditionally active based on context expressions.
 */

import { SessionKind } from '../types';

/**
 * All possible context flags.
 *
 * Naming convention: camelCase, descriptive of state
 */
export type ContextFlag =
  // View focus (what entity is selected - mutually exclusive)
  | 'scratchFocused'
  | 'worktreeFocused'
  | 'projectFocused'

  // Panel focus (where keyboard input goes)
  | 'drawerFocused'
  | 'mainFocused'

  // UI state
  | 'drawerOpen'
  | 'rightPanelOpen'
  | 'pickerOpen'
  | 'commandPaletteOpen'
  | 'taskSwitcherOpen'
  | 'projectSwitcherOpen'
  | 'modalOpen'

  // Entity state
  | 'hasMultipleEntities'
  | 'hasPreviousView'
  ;

/**
 * Active contexts as a Set for efficient lookup
 */
export type ActiveContexts = Set<ContextFlag>;

/**
 * State needed to compute active contexts.
 * This mirrors the relevant parts of App state.
 */
export interface ContextState {
  // Active session (unified)
  activeSessionId: string | null;
  activeSessionKind: SessionKind | null;

  // Legacy: Active entity IDs (for backward compatibility)
  activeScratchId?: string | null;
  activeWorktreeId?: string | null;
  activeProjectId?: string | null;

  // Focus state
  focusState: 'main' | 'drawer';

  // UI state
  isDrawerOpen: boolean;
  isRightPanelOpen: boolean;

  // Pickers
  isCommandPaletteOpen: boolean;
  isTaskSwitcherOpen: boolean;
  isProjectSwitcherOpen: boolean;

  // Modal
  hasOpenModal: boolean;

  // Entity counts
  openEntityCount: number;

  // Navigation
  hasPreviousView: boolean;
}

/**
 * Compute the set of active context flags from application state.
 *
 * @param state - Current application state
 * @returns Set of active context flags
 */
export function getActiveContexts(state: ContextState): ActiveContexts {
  const contexts = new Set<ContextFlag>();

  // View focus (mutually exclusive)
  // Use activeSessionKind if available, otherwise fall back to legacy IDs
  if (state.activeSessionKind) {
    switch (state.activeSessionKind) {
      case 'scratch':
        contexts.add('scratchFocused');
        break;
      case 'worktree':
        contexts.add('worktreeFocused');
        break;
      case 'project':
        contexts.add('projectFocused');
        break;
    }
  } else {
    // Legacy fallback: Priority: scratch > worktree > project
    if (state.activeScratchId) {
      contexts.add('scratchFocused');
    } else if (state.activeWorktreeId) {
      contexts.add('worktreeFocused');
    } else if (state.activeProjectId) {
      contexts.add('projectFocused');
    }
  }

  // Panel focus
  if (state.isDrawerOpen && state.focusState === 'drawer') {
    contexts.add('drawerFocused');
  }
  if (state.focusState === 'main') {
    contexts.add('mainFocused');
  }

  // UI state
  if (state.isDrawerOpen) {
    contexts.add('drawerOpen');
  }
  if (state.isRightPanelOpen) {
    contexts.add('rightPanelOpen');
  }

  // Pickers
  if (state.isCommandPaletteOpen || state.isTaskSwitcherOpen || state.isProjectSwitcherOpen) {
    contexts.add('pickerOpen');
  }
  if (state.isCommandPaletteOpen) {
    contexts.add('commandPaletteOpen');
  }
  if (state.isTaskSwitcherOpen) {
    contexts.add('taskSwitcherOpen');
  }
  if (state.isProjectSwitcherOpen) {
    contexts.add('projectSwitcherOpen');
  }

  // Modal
  if (state.hasOpenModal) {
    contexts.add('modalOpen');
  }

  // Entity state
  if (state.openEntityCount > 1) {
    contexts.add('hasMultipleEntities');
  }

  // Navigation
  if (state.hasPreviousView) {
    contexts.add('hasPreviousView');
  }

  return contexts;
}

/**
 * Check if a single context flag is active
 */
export function hasContext(contexts: ActiveContexts, flag: ContextFlag): boolean {
  return contexts.has(flag);
}

/**
 * Format active contexts for debugging
 */
export function formatContexts(contexts: ActiveContexts): string {
  return Array.from(contexts).sort().join(', ');
}

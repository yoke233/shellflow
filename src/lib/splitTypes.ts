/**
 * Split Types
 *
 * Type definitions for vim-style splits within terminal tabs.
 * Each tab can contain multiple split panes arranged horizontally/vertically.
 */

import { SerializedGridviewComponent } from 'dockview-react';

/**
 * Configuration for a single split pane within a tab.
 * Each pane renders a terminal with its own PTY.
 */
export interface SplitPaneConfig {
  id: string;
  /** PTY ID once spawned (undefined until ready) */
  ptyId?: string;
  /** Terminal type determines behavior and initial command */
  type: 'main' | 'project' | 'scratch' | 'shell' | 'task' | 'action';
  /** Working directory for the terminal */
  directory?: string;
  /** Command to run (for command tabs, task terminals) */
  command?: string;
  /** For task terminals: the task name */
  taskName?: string;
  /** For action terminals: the action type identifier */
  actionType?: string;
  /** For action terminals: the prompt to send when ready */
  actionPrompt?: string;
}

/**
 * Pending split operation info (for communicating orientation from hook to component)
 */
export interface PendingSplit {
  /** The new pane ID being added */
  newPaneId: string;
  /** The pane to split from (reference for positioning) */
  referencePaneId: string;
  /** Orientation of the split */
  orientation: SplitOrientation;
}

/**
 * State of splits within a single tab.
 * Tracks the Gridview layout and all pane configurations.
 */
export interface TabSplitState {
  /** Serialized Gridview layout (null = single pane, no splits) */
  layout: SerializedGridviewComponent | null;
  /** Map of pane ID to pane configuration */
  panes: Map<string, SplitPaneConfig>;
  /** Currently focused pane ID within this tab */
  activePaneId: string | null;
  /** Pending split operation (consumed by SplitContainer when adding the pane) */
  pendingSplit?: PendingSplit;
}

/**
 * Direction for split focus navigation (vim-style h/j/k/l)
 */
export type SplitDirection = 'left' | 'down' | 'up' | 'right';

/**
 * Split orientation for creating new splits
 */
export type SplitOrientation = 'horizontal' | 'vertical';

/**
 * Generate a unique pane ID
 */
export function generatePaneId(): string {
  return `pane-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

/**
 * Create a default single-pane split state for a tab
 */
export function createDefaultSplitState(
  paneId: string,
  config: Omit<SplitPaneConfig, 'id'>
): TabSplitState {
  const paneConfig: SplitPaneConfig = { id: paneId, ...config };
  return {
    layout: null, // null means single pane (no Gridview layout needed)
    panes: new Map([[paneId, paneConfig]]),
    activePaneId: paneId,
  };
}

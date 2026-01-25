/**
 * Action System
 *
 * Centralized definition of all app actions with their availability predicates.
 * This is the single source of truth for "can this action be performed?"
 *
 * Consumers:
 * - Menu bar: syncs availability to enable/disable menu items
 * - Keyboard shortcuts: checks availability before executing
 * - Context menus: checks availability to show/hide items
 * - Buttons: checks availability to enable/disable
 * - Command palette: lists available actions with labels and shortcuts
 */

// All possible actions in the app
export type ActionId =
  // File menu
  | 'addProject'
  | 'switchProject'
  | 'newWorktree'
  | 'newScratchTerminal'
  | 'closeTab'
  | 'openInFinder'
  | 'openInTerminal'
  | 'openInEditor'
  | 'closeProject'
  // View menu
  | 'commandPalette'
  | 'toggleDrawer'
  | 'expandDrawer'
  | 'toggleRightPanel'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  // Worktree menu
  | 'worktreePrev'
  | 'worktreeNext'
  | 'previousView'
  | 'switchFocus'
  | 'worktree1'
  | 'worktree2'
  | 'worktree3'
  | 'worktree4'
  | 'worktree5'
  | 'worktree6'
  | 'worktree7'
  | 'worktree8'
  | 'worktree9'
  | 'renameBranch'
  | 'mergeWorktree'
  | 'deleteWorktree'
  // Tasks menu
  | 'runTask'
  | 'taskSwitcher'
  // Help menu
  | 'helpDocs'
  | 'helpReportIssue'
  | 'helpReleaseNotes';

// State needed to evaluate action availability
export interface ActionContext {
  activeProjectId: string | null;
  activeWorktreeId: string | null;
  activeScratchId: string | null;
  activeEntityId: string | null;
  isDrawerOpen: boolean;
  isDrawerFocused: boolean;
  activeDrawerTabId: string | null;
  openWorktreeCount: number;
  previousView: unknown | null;
  activeSelectedTask: string | null;
  taskCount: number;
}

// Availability predicates - THE source of truth for "can this action run?"
const AVAILABILITY: Record<ActionId, (ctx: ActionContext) => boolean> = {
  // File menu
  addProject: () => true,
  switchProject: () => true,
  // newWorktree: available when Cmd+N creates a worktree (in project, not viewing scratch)
  newWorktree: (ctx) => !!ctx.activeProjectId && !ctx.activeScratchId,
  // newScratchTerminal: always available (has dedicated Cmd+Shift+N shortcut)
  newScratchTerminal: () => true,
  closeTab: (ctx) => (ctx.isDrawerOpen && !!ctx.activeDrawerTabId) || !!ctx.activeEntityId,
  openInFinder: (ctx) => !!ctx.activeEntityId,
  openInTerminal: (ctx) => !!ctx.activeEntityId,
  openInEditor: (ctx) => !!ctx.activeEntityId,
  closeProject: (ctx) => !!ctx.activeProjectId && !ctx.activeWorktreeId,

  // View menu
  commandPalette: () => true,
  toggleDrawer: (ctx) => !!ctx.activeEntityId,
  expandDrawer: (ctx) => !!ctx.activeEntityId && ctx.isDrawerOpen,
  toggleRightPanel: (ctx) => !!ctx.activeEntityId,
  zoomIn: () => true,
  zoomOut: () => true,
  zoomReset: () => true,

  // Worktree menu
  worktreePrev: (ctx) => ctx.openWorktreeCount > 0,
  worktreeNext: (ctx) => ctx.openWorktreeCount > 0,
  previousView: (ctx) => !!ctx.previousView,
  switchFocus: (ctx) => !!ctx.activeEntityId,
  worktree1: (ctx) => ctx.openWorktreeCount >= 1,
  worktree2: (ctx) => ctx.openWorktreeCount >= 2,
  worktree3: (ctx) => ctx.openWorktreeCount >= 3,
  worktree4: (ctx) => ctx.openWorktreeCount >= 4,
  worktree5: (ctx) => ctx.openWorktreeCount >= 5,
  worktree6: (ctx) => ctx.openWorktreeCount >= 6,
  worktree7: (ctx) => ctx.openWorktreeCount >= 7,
  worktree8: (ctx) => ctx.openWorktreeCount >= 8,
  worktree9: (ctx) => ctx.openWorktreeCount >= 9,
  renameBranch: (ctx) => !!ctx.activeWorktreeId,
  mergeWorktree: (ctx) => !!ctx.activeWorktreeId,
  deleteWorktree: (ctx) => !!ctx.activeWorktreeId,

  // Tasks menu
  runTask: (ctx) => !!ctx.activeEntityId && !!ctx.activeSelectedTask,
  taskSwitcher: (ctx) => ctx.taskCount > 0,

  // Help menu (always available)
  helpDocs: () => true,
  helpReportIssue: () => true,
  helpReleaseNotes: () => true,
};

// Map from ActionId to menu item ID (they're mostly the same, but with different casing)
const ACTION_TO_MENU_ID: Record<ActionId, string> = {
  addProject: 'add_project',
  switchProject: 'switch_project',
  newWorktree: 'new_worktree',
  newScratchTerminal: 'new_scratch_terminal',
  closeTab: 'close_tab',
  openInFinder: 'open_in_finder',
  openInTerminal: 'open_in_terminal',
  openInEditor: 'open_in_editor',
  closeProject: 'close_project',
  commandPalette: 'command_palette',
  toggleDrawer: 'toggle_drawer',
  expandDrawer: 'expand_drawer',
  toggleRightPanel: 'toggle_right_panel',
  zoomIn: 'zoom_in',
  zoomOut: 'zoom_out',
  zoomReset: 'zoom_reset',
  worktreePrev: 'worktree_prev',
  worktreeNext: 'worktree_next',
  previousView: 'previous_view',
  switchFocus: 'switch_focus',
  worktree1: 'worktree1',
  worktree2: 'worktree2',
  worktree3: 'worktree3',
  worktree4: 'worktree4',
  worktree5: 'worktree5',
  worktree6: 'worktree6',
  worktree7: 'worktree7',
  worktree8: 'worktree8',
  worktree9: 'worktree9',
  renameBranch: 'rename_branch',
  mergeWorktree: 'merge_worktree',
  deleteWorktree: 'delete_worktree',
  runTask: 'run_task',
  taskSwitcher: 'task_switcher',
  helpDocs: 'help_docs',
  helpReportIssue: 'help_report_issue',
  helpReleaseNotes: 'help_release_notes',
};

// Reverse map: menu ID to ActionId
const MENU_ID_TO_ACTION: Record<string, ActionId> = Object.fromEntries(
  Object.entries(ACTION_TO_MENU_ID).map(([action, menuId]) => [menuId, action as ActionId])
) as Record<string, ActionId>;

/**
 * Convert a menu item ID to an ActionId
 */
export function menuIdToAction(menuId: string): ActionId | undefined {
  return MENU_ID_TO_ACTION[menuId];
}

/**
 * Check if a specific action is available given the current context
 */
export function isActionAvailable(actionId: ActionId, ctx: ActionContext): boolean {
  return AVAILABILITY[actionId](ctx);
}

/**
 * Compute availability for all actions given the current context
 * Returns a map of action IDs to their availability
 */
export function getActionAvailability(ctx: ActionContext): Record<ActionId, boolean> {
  const result = {} as Record<ActionId, boolean>;
  for (const [id, predicate] of Object.entries(AVAILABILITY)) {
    result[id as ActionId] = predicate(ctx);
  }
  return result;
}

/**
 * Get action availability formatted for the menu bar (using menu item IDs)
 */
export function getMenuAvailability(ctx: ActionContext): Record<string, boolean> {
  const result: Record<string, boolean> = {};
  for (const [actionId, predicate] of Object.entries(AVAILABILITY)) {
    const menuId = ACTION_TO_MENU_ID[actionId as ActionId];
    result[menuId] = predicate(ctx);
  }
  return result;
}

// ============================================================================
// Action Metadata for Command Palette
// ============================================================================

export type ActionCategory = 'File' | 'View' | 'Navigate' | 'Tasks' | 'Help';

export interface ActionMetadata {
  label: string;
  category: ActionCategory;
  /** Whether to show in command palette (excludes worktree1-9) */
  showInPalette: boolean;
}

/** Metadata for each action - labels and categories */
export const ACTION_METADATA: Record<ActionId, ActionMetadata> = {
  // File menu
  addProject: { label: 'Add Project', category: 'File', showInPalette: true },
  switchProject: { label: 'Switch Project', category: 'File', showInPalette: true },
  newWorktree: { label: 'New Worktree', category: 'File', showInPalette: true },
  newScratchTerminal: { label: 'New Scratch Terminal', category: 'File', showInPalette: true },
  closeTab: { label: 'Close', category: 'File', showInPalette: true },
  openInFinder: { label: 'Open in Finder', category: 'File', showInPalette: true },
  openInTerminal: { label: 'Open in Terminal', category: 'File', showInPalette: true },
  openInEditor: { label: 'Open in Editor', category: 'File', showInPalette: true },
  closeProject: { label: 'Close Project', category: 'File', showInPalette: true },

  // View menu
  commandPalette: { label: 'Command Palette', category: 'View', showInPalette: false },
  toggleDrawer: { label: 'Toggle Drawer', category: 'View', showInPalette: true },
  expandDrawer: { label: 'Expand Drawer', category: 'View', showInPalette: true },
  toggleRightPanel: { label: 'Toggle Changed Files', category: 'View', showInPalette: true },
  zoomIn: { label: 'Zoom In', category: 'View', showInPalette: true },
  zoomOut: { label: 'Zoom Out', category: 'View', showInPalette: true },
  zoomReset: { label: 'Reset Zoom', category: 'View', showInPalette: true },

  // Navigate menu (worktree navigation)
  worktreePrev: { label: 'Previous Worktree', category: 'Navigate', showInPalette: true },
  worktreeNext: { label: 'Next Worktree', category: 'Navigate', showInPalette: true },
  previousView: { label: 'Previous View', category: 'Navigate', showInPalette: true },
  switchFocus: { label: 'Switch Focus', category: 'Navigate', showInPalette: true },
  // Worktree 1-9 are hidden from palette (clutter, rarely used via palette)
  worktree1: { label: 'Go to Worktree 1', category: 'Navigate', showInPalette: false },
  worktree2: { label: 'Go to Worktree 2', category: 'Navigate', showInPalette: false },
  worktree3: { label: 'Go to Worktree 3', category: 'Navigate', showInPalette: false },
  worktree4: { label: 'Go to Worktree 4', category: 'Navigate', showInPalette: false },
  worktree5: { label: 'Go to Worktree 5', category: 'Navigate', showInPalette: false },
  worktree6: { label: 'Go to Worktree 6', category: 'Navigate', showInPalette: false },
  worktree7: { label: 'Go to Worktree 7', category: 'Navigate', showInPalette: false },
  worktree8: { label: 'Go to Worktree 8', category: 'Navigate', showInPalette: false },
  worktree9: { label: 'Go to Worktree 9', category: 'Navigate', showInPalette: false },
  renameBranch: { label: 'Rename Branch', category: 'Navigate', showInPalette: true },
  mergeWorktree: { label: 'Merge Worktree', category: 'Navigate', showInPalette: true },
  deleteWorktree: { label: 'Delete Worktree', category: 'Navigate', showInPalette: true },

  // Tasks menu
  runTask: { label: 'Run Task', category: 'Tasks', showInPalette: true },
  taskSwitcher: { label: 'Task Switcher', category: 'Tasks', showInPalette: true },

  // Help menu
  helpDocs: { label: 'Help', category: 'Help', showInPalette: true },
  helpReportIssue: { label: 'Report Issue', category: 'Help', showInPalette: true },
  helpReleaseNotes: { label: 'Release Notes', category: 'Help', showInPalette: true },
};

/** Get actions that should appear in the command palette */
export function getPaletteActions(): ActionId[] {
  return (Object.keys(ACTION_METADATA) as ActionId[]).filter(
    (id) => ACTION_METADATA[id].showInPalette
  );
}

/** Get available actions for command palette given current context */
export function getAvailablePaletteActions(ctx: ActionContext): ActionId[] {
  return getPaletteActions().filter((id) => isActionAvailable(id, ctx));
}

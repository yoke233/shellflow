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
  | 'newTab'
  | 'closeTab'
  | 'openInFinder'
  | 'openInTerminal'
  | 'openInEditor'
  | 'openSettings'
  | 'openMappings'
  | 'closeProject'
  // View menu
  | 'commandPalette'
  | 'toggleDrawer'
  | 'expandDrawer'
  | 'toggleRightPanel'
  | 'zoomIn'
  | 'zoomOut'
  | 'zoomReset'
  // Navigate menu
  | 'sessionPrev'
  | 'sessionNext'
  | 'previousView'
  | 'switchFocus'
  | 'session1'
  | 'session2'
  | 'session3'
  | 'session4'
  | 'session5'
  | 'session6'
  | 'session7'
  | 'session8'
  | 'session9'
  | 'renameBranch'
  | 'renameSession'
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
  // newTab: available when there's an active session (entity)
  newTab: (ctx) => !!ctx.activeEntityId,
  closeTab: (ctx) => (ctx.isDrawerOpen && !!ctx.activeDrawerTabId) || !!ctx.activeEntityId,
  openInFinder: (ctx) => !!ctx.activeEntityId,
  openInTerminal: (ctx) => !!ctx.activeEntityId,
  openInEditor: (ctx) => !!ctx.activeEntityId,
  openSettings: () => true,
  openMappings: () => true,
  closeProject: (ctx) => !!ctx.activeProjectId && !ctx.activeWorktreeId,

  // View menu
  commandPalette: () => true,
  toggleDrawer: (ctx) => !!ctx.activeEntityId,
  expandDrawer: (ctx) => !!ctx.activeEntityId && ctx.isDrawerOpen,
  toggleRightPanel: (ctx) => !!ctx.activeEntityId,
  zoomIn: () => true,
  zoomOut: () => true,
  zoomReset: () => true,

  // Navigate menu
  sessionPrev: (ctx) => ctx.openWorktreeCount > 0,
  sessionNext: (ctx) => ctx.openWorktreeCount > 0,
  previousView: (ctx) => !!ctx.previousView,
  switchFocus: (ctx) => !!ctx.activeEntityId,
  session1: (ctx) => ctx.openWorktreeCount >= 1,
  session2: (ctx) => ctx.openWorktreeCount >= 2,
  session3: (ctx) => ctx.openWorktreeCount >= 3,
  session4: (ctx) => ctx.openWorktreeCount >= 4,
  session5: (ctx) => ctx.openWorktreeCount >= 5,
  session6: (ctx) => ctx.openWorktreeCount >= 6,
  session7: (ctx) => ctx.openWorktreeCount >= 7,
  session8: (ctx) => ctx.openWorktreeCount >= 8,
  session9: (ctx) => ctx.openWorktreeCount >= 9,
  renameBranch: (ctx) => !!ctx.activeWorktreeId,
  renameSession: (ctx) => !!ctx.activeScratchId,
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
  newTab: 'new_tab',
  closeTab: 'close_tab',
  openInFinder: 'open_in_finder',
  openInTerminal: 'open_in_terminal',
  openInEditor: 'open_in_editor',
  openSettings: 'open_settings',
  openMappings: 'open_mappings',
  closeProject: 'close_project',
  commandPalette: 'command_palette',
  toggleDrawer: 'toggle_drawer',
  expandDrawer: 'expand_drawer',
  toggleRightPanel: 'toggle_right_panel',
  zoomIn: 'zoom_in',
  zoomOut: 'zoom_out',
  zoomReset: 'zoom_reset',
  sessionPrev: 'session_prev',
  sessionNext: 'session_next',
  previousView: 'previous_view',
  switchFocus: 'switch_focus',
  session1: 'session1',
  session2: 'session2',
  session3: 'session3',
  session4: 'session4',
  session5: 'session5',
  session6: 'session6',
  session7: 'session7',
  session8: 'session8',
  session9: 'session9',
  renameBranch: 'rename_branch',
  renameSession: 'rename_session',
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
  newTab: { label: 'New Tab', category: 'File', showInPalette: true },
  closeTab: { label: 'Close', category: 'File', showInPalette: true },
  openInFinder: { label: 'Open in File Manager', category: 'File', showInPalette: true },
  openInTerminal: { label: 'Open in Terminal', category: 'File', showInPalette: true },
  openInEditor: { label: 'Open in Editor', category: 'File', showInPalette: true },
  openSettings: { label: 'Open Settings', category: 'File', showInPalette: true },
  openMappings: { label: 'Open Mappings', category: 'File', showInPalette: true },
  closeProject: { label: 'Close Project', category: 'File', showInPalette: true },

  // View menu
  commandPalette: { label: 'Command Palette', category: 'View', showInPalette: false },
  toggleDrawer: { label: 'Toggle Drawer', category: 'View', showInPalette: true },
  expandDrawer: { label: 'Expand Drawer', category: 'View', showInPalette: true },
  toggleRightPanel: { label: 'Toggle Changed Files', category: 'View', showInPalette: true },
  zoomIn: { label: 'Zoom In', category: 'View', showInPalette: true },
  zoomOut: { label: 'Zoom Out', category: 'View', showInPalette: true },
  zoomReset: { label: 'Reset Zoom', category: 'View', showInPalette: true },

  // Navigate menu (session navigation)
  sessionPrev: { label: 'Previous Session', category: 'Navigate', showInPalette: true },
  sessionNext: { label: 'Next Session', category: 'Navigate', showInPalette: true },
  previousView: { label: 'Previous Session', category: 'Navigate', showInPalette: true },
  switchFocus: { label: 'Switch Focus', category: 'Navigate', showInPalette: true },
  // Session 1-9 are hidden from palette (clutter, rarely used via palette)
  session1: { label: 'Go to Session 1', category: 'Navigate', showInPalette: false },
  session2: { label: 'Go to Session 2', category: 'Navigate', showInPalette: false },
  session3: { label: 'Go to Session 3', category: 'Navigate', showInPalette: false },
  session4: { label: 'Go to Session 4', category: 'Navigate', showInPalette: false },
  session5: { label: 'Go to Session 5', category: 'Navigate', showInPalette: false },
  session6: { label: 'Go to Session 6', category: 'Navigate', showInPalette: false },
  session7: { label: 'Go to Session 7', category: 'Navigate', showInPalette: false },
  session8: { label: 'Go to Session 8', category: 'Navigate', showInPalette: false },
  session9: { label: 'Go to Session 9', category: 'Navigate', showInPalette: false },
  renameBranch: { label: 'Rename Branch', category: 'Navigate', showInPalette: true },
  renameSession: { label: 'Rename Session', category: 'Navigate', showInPalette: true },
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

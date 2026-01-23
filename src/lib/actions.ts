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
 */

// All possible actions in the app
export type ActionId =
  // File menu
  | 'addProject'
  | 'newWorktree'
  | 'closeTab'
  | 'openInFinder'
  | 'setInactive'
  | 'removeProject'
  // View menu
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
  activeEntityId: string | null;
  isDrawerOpen: boolean;
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
  newWorktree: (ctx) => !!ctx.activeProjectId,
  closeTab: (ctx) => ctx.isDrawerOpen && !!ctx.activeDrawerTabId,
  openInFinder: (ctx) => !!ctx.activeEntityId,
  setInactive: (ctx) => !!ctx.activeEntityId,
  removeProject: (ctx) => !!ctx.activeProjectId && !ctx.activeWorktreeId,

  // View menu
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
  newWorktree: 'new_worktree',
  closeTab: 'close_tab',
  openInFinder: 'open_in_finder',
  setInactive: 'set_inactive',
  removeProject: 'remove_project',
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

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

// All possible actions in the app (namespaced format)
export type ActionId =
  // App actions
  | 'app::quit'
  | 'app::addProject'
  | 'app::openInFinder'
  | 'app::openInTerminal'
  | 'app::openInEditor'
  | 'app::openSettings'
  | 'app::openMappings'
  | 'app::helpDocs'
  | 'app::helpReportIssue'
  | 'app::helpReleaseNotes'
  | 'git::commit'
  // Palette actions
  | 'palette::toggle'
  | 'palette::projectSwitcher'
  // Session actions
  | 'session::newTab'
  | 'session::closeTab'
  // Worktree actions
  | 'worktree::new'
  | 'worktree::renameBranch'
  | 'worktree::merge'
  | 'worktree::delete'
  // Scratch actions
  | 'scratch::new'
  | 'scratch::renameSession'
  // Project actions
  | 'project::close'
  | 'project::refresh'
  // Drawer actions
  | 'drawer::toggle'
  | 'drawer::expand'
  // Right panel actions
  | 'rightPanel::toggle'
  // View actions
  | 'view::zoomIn'
  | 'view::zoomOut'
  | 'view::zoomReset'
  | 'view::switchTheme'
  | 'view::cycleBorderStyle'
  // Navigate actions
  | 'navigate::prev'
  | 'navigate::next'
  | 'navigate::back'
  | 'navigate::forward'
  | 'navigate::toEntity1'
  | 'navigate::toEntity2'
  | 'navigate::toEntity3'
  | 'navigate::toEntity4'
  | 'navigate::toEntity5'
  | 'navigate::toEntity6'
  | 'navigate::toEntity7'
  | 'navigate::toEntity8'
  | 'navigate::toEntity9'
  // Focus actions
  | 'focus::switch'
  // Diff navigation
  | 'diff::open'
  | 'diff::nextFile'
  | 'diff::prevFile'
  | 'diff::toggleMode'
  // Task actions
  | 'task::run'
  | 'task::switcher'
  // Pane actions (vim-style splits and navigation)
  | 'pane::splitHorizontal'
  | 'pane::splitVertical'
  | 'pane::focusLeft'
  | 'pane::focusDown'
  | 'pane::focusUp'
  | 'pane::focusRight'
  | 'pane::close';

// State needed to evaluate action availability
export interface ActionContext {
  activeProjectId: string | null;
  activeWorktreeId: string | null;
  activeScratchId: string | null;
  activeEntityId: string | null;
  isDrawerOpen: boolean;
  isDrawerFocused: boolean;
  activeDrawerTabId: string | null;
  /** Number of open entities (scratch terminals + projects + worktrees) for navigation */
  openEntityCount: number;
  /** Whether we can navigate back in history */
  canGoBack: boolean;
  /** Whether we can navigate forward in history */
  canGoForward: boolean;
  activeSelectedTask: string | null;
  taskCount: number;
  /** Whether the active tab is showing a diff view */
  isViewingDiff: boolean;
  /** Number of files in the changed files list */
  changedFilesCount: number;
  /** Whether the active tab has splits */
  hasSplits: boolean;
}

// Availability predicates - THE source of truth for "can this action run?"
const AVAILABILITY: Record<ActionId, (ctx: ActionContext) => boolean> = {
  // App actions
  'app::quit': () => true,
  'app::addProject': () => true,
  'app::openInFinder': (ctx) => !!ctx.activeEntityId,
  'app::openInTerminal': (ctx) => !!ctx.activeEntityId,
  'app::openInEditor': (ctx) => !!ctx.activeEntityId,
  'app::openSettings': () => true,
  'app::openMappings': () => true,
  'app::helpDocs': () => true,
  'app::helpReportIssue': () => true,
  'app::helpReleaseNotes': () => true,
  'git::commit': (ctx) => !!ctx.activeWorktreeId || (!!ctx.activeProjectId && !ctx.activeScratchId),

  // Palette actions
  'palette::toggle': () => true,
  'palette::projectSwitcher': () => true,

  // Theme actions
  'view::switchTheme': () => true,
  'view::cycleBorderStyle': () => true,

  // Session actions
  'session::newTab': (ctx) => !!ctx.activeEntityId,
  'session::closeTab': (ctx) => (ctx.isDrawerOpen && !!ctx.activeDrawerTabId) || !!ctx.activeEntityId,

  // Worktree actions
  'worktree::new': (ctx) => !!ctx.activeProjectId && !ctx.activeScratchId,
  'worktree::renameBranch': (ctx) => !!ctx.activeWorktreeId,
  'worktree::merge': (ctx) => !!ctx.activeWorktreeId,
  'worktree::delete': (ctx) => !!ctx.activeWorktreeId,

  // Scratch actions
  'scratch::new': () => true,
  'scratch::renameSession': (ctx) => !!ctx.activeScratchId,

  // Project actions
  'project::close': (ctx) => !!ctx.activeProjectId && !ctx.activeWorktreeId,
  'project::refresh': () => true,

  // Drawer actions
  'drawer::toggle': (ctx) => !!ctx.activeEntityId,
  'drawer::expand': (ctx) => !!ctx.activeEntityId && ctx.isDrawerOpen,

  // Right panel actions
  'rightPanel::toggle': (ctx) => !!ctx.activeEntityId,

  // View actions
  'view::zoomIn': () => true,
  'view::zoomOut': () => true,
  'view::zoomReset': () => true,

  // Navigate actions
  'navigate::prev': (ctx) => ctx.openEntityCount > 0,
  'navigate::next': (ctx) => ctx.openEntityCount > 0,
  'navigate::back': (ctx) => ctx.canGoBack,
  'navigate::forward': (ctx) => ctx.canGoForward,
  'navigate::toEntity1': (ctx) => ctx.openEntityCount >= 1,
  'navigate::toEntity2': (ctx) => ctx.openEntityCount >= 2,
  'navigate::toEntity3': (ctx) => ctx.openEntityCount >= 3,
  'navigate::toEntity4': (ctx) => ctx.openEntityCount >= 4,
  'navigate::toEntity5': (ctx) => ctx.openEntityCount >= 5,
  'navigate::toEntity6': (ctx) => ctx.openEntityCount >= 6,
  'navigate::toEntity7': (ctx) => ctx.openEntityCount >= 7,
  'navigate::toEntity8': (ctx) => ctx.openEntityCount >= 8,
  'navigate::toEntity9': (ctx) => ctx.openEntityCount >= 9,

  // Focus actions
  'focus::switch': (ctx) => !!ctx.activeEntityId,

  // Diff navigation
  'diff::open': (ctx) => !!ctx.activeEntityId && ctx.changedFilesCount > 0,
  'diff::nextFile': (ctx) => ctx.isViewingDiff && ctx.changedFilesCount > 1,
  'diff::prevFile': (ctx) => ctx.isViewingDiff && ctx.changedFilesCount > 1,
  'diff::toggleMode': (ctx) => !!ctx.activeWorktreeId,

  // Task actions
  'task::run': (ctx) => !!ctx.activeEntityId && !!ctx.activeSelectedTask,
  'task::switcher': (ctx) => ctx.taskCount > 0,

  // Pane actions (vim-style splits and navigation)
  'pane::splitHorizontal': (ctx) => !!ctx.activeEntityId,
  'pane::splitVertical': (ctx) => !!ctx.activeEntityId,
  'pane::focusLeft': (ctx) => !!ctx.activeEntityId && ctx.hasSplits,
  'pane::focusDown': (ctx) => !!ctx.activeEntityId && ctx.hasSplits,
  'pane::focusUp': (ctx) => !!ctx.activeEntityId && ctx.hasSplits,
  'pane::focusRight': (ctx) => !!ctx.activeEntityId && ctx.hasSplits,
  'pane::close': (ctx) => !!ctx.activeEntityId,
};

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
 * Get action availability formatted for the menu bar
 * Menu IDs are now the same as action IDs (namespaced format)
 */
export function getMenuAvailability(ctx: ActionContext): Record<string, boolean> {
  return getActionAvailability(ctx);
}

// ============================================================================
// Action Metadata for Command Palette
// ============================================================================

export type ActionCategory = 'File' | 'View' | 'Navigate' | 'Diff' | 'Tasks' | 'Help' | 'Panes';

export interface ActionMetadata {
  label: string;
  category: ActionCategory;
  /** Whether to show in command palette (excludes navigate::toEntity1-9) */
  showInPalette: boolean;
}

/** Metadata for each action - labels and categories */
export const ACTION_METADATA: Record<ActionId, ActionMetadata> = {
  // App actions
  'app::quit': { label: 'Quit', category: 'File', showInPalette: false },
  'app::addProject': { label: 'Open Project', category: 'File', showInPalette: true },
  'app::openInFinder': { label: 'Open in File Manager', category: 'File', showInPalette: true },
  'app::openInTerminal': { label: 'Open in Terminal', category: 'File', showInPalette: true },
  'app::openInEditor': { label: 'Open in Editor', category: 'File', showInPalette: true },
  'app::openSettings': { label: 'Open Settings', category: 'File', showInPalette: true },
  'app::openMappings': { label: 'Open Mappings', category: 'File', showInPalette: true },
  'app::helpDocs': { label: 'Help', category: 'Help', showInPalette: true },
  'app::helpReportIssue': { label: 'Report Issue', category: 'Help', showInPalette: true },
  'app::helpReleaseNotes': { label: 'Release Notes', category: 'Help', showInPalette: true },
  'git::commit': { label: 'Commit Changes', category: 'File', showInPalette: true },

  // Palette actions
  'palette::toggle': { label: 'Command Palette', category: 'View', showInPalette: false },
  'palette::projectSwitcher': { label: 'Switch Project', category: 'File', showInPalette: true },

  // Theme actions
  'view::switchTheme': { label: 'Switch Theme', category: 'View', showInPalette: true },
  'view::cycleBorderStyle': { label: 'Cycle Border Style', category: 'View', showInPalette: true },

  // Session actions
  'session::newTab': { label: 'New Tab', category: 'File', showInPalette: true },
  'session::closeTab': { label: 'Close', category: 'File', showInPalette: true },

  // Worktree actions
  'worktree::new': { label: 'New Worktree', category: 'File', showInPalette: true },
  'worktree::renameBranch': { label: 'Rename Branch', category: 'Navigate', showInPalette: true },
  'worktree::merge': { label: 'Merge Worktree', category: 'Navigate', showInPalette: true },
  'worktree::delete': { label: 'Delete Worktree', category: 'Navigate', showInPalette: true },

  // Scratch actions
  'scratch::new': { label: 'New Scratch Terminal', category: 'File', showInPalette: true },
  'scratch::renameSession': { label: 'Rename Session', category: 'Navigate', showInPalette: true },

  // Project actions
  'project::close': { label: 'Close Project', category: 'File', showInPalette: true },
  'project::refresh': { label: 'Refresh Projects', category: 'File', showInPalette: true },

  // Drawer actions
  'drawer::toggle': { label: 'Toggle Drawer', category: 'View', showInPalette: true },
  'drawer::expand': { label: 'Expand Drawer', category: 'View', showInPalette: true },

  // Right panel actions
  'rightPanel::toggle': { label: 'Toggle Changed Files', category: 'View', showInPalette: true },

  // View actions
  'view::zoomIn': { label: 'Zoom In', category: 'View', showInPalette: true },
  'view::zoomOut': { label: 'Zoom Out', category: 'View', showInPalette: true },
  'view::zoomReset': { label: 'Reset Zoom', category: 'View', showInPalette: true },

  // Navigate actions
  'navigate::prev': { label: 'Previous Session', category: 'Navigate', showInPalette: true },
  'navigate::next': { label: 'Next Session', category: 'Navigate', showInPalette: true },
  'navigate::back': { label: 'Go Back', category: 'Navigate', showInPalette: true },
  'navigate::forward': { label: 'Go Forward', category: 'Navigate', showInPalette: true },
  // Session 1-9 are hidden from palette (clutter, rarely used via palette)
  'navigate::toEntity1': { label: 'Go to Session 1', category: 'Navigate', showInPalette: false },
  'navigate::toEntity2': { label: 'Go to Session 2', category: 'Navigate', showInPalette: false },
  'navigate::toEntity3': { label: 'Go to Session 3', category: 'Navigate', showInPalette: false },
  'navigate::toEntity4': { label: 'Go to Session 4', category: 'Navigate', showInPalette: false },
  'navigate::toEntity5': { label: 'Go to Session 5', category: 'Navigate', showInPalette: false },
  'navigate::toEntity6': { label: 'Go to Session 6', category: 'Navigate', showInPalette: false },
  'navigate::toEntity7': { label: 'Go to Session 7', category: 'Navigate', showInPalette: false },
  'navigate::toEntity8': { label: 'Go to Session 8', category: 'Navigate', showInPalette: false },
  'navigate::toEntity9': { label: 'Go to Session 9', category: 'Navigate', showInPalette: false },

  // Focus actions
  'focus::switch': { label: 'Switch Focus', category: 'Navigate', showInPalette: true },

  // Diff navigation
  'diff::open': { label: 'Open Diff View', category: 'Diff', showInPalette: true },
  'diff::nextFile': { label: 'Next Changed File', category: 'Diff', showInPalette: true },
  'diff::prevFile': { label: 'Previous Changed File', category: 'Diff', showInPalette: true },
  'diff::toggleMode': { label: 'Toggle Uncommitted/Branch Diff', category: 'Diff', showInPalette: true },

  // Task actions
  'task::run': { label: 'Run Task', category: 'Tasks', showInPalette: true },
  'task::switcher': { label: 'Task Switcher', category: 'Tasks', showInPalette: true },

  // Pane actions (vim-style splits and navigation)
  'pane::splitHorizontal': { label: 'Split Horizontally', category: 'Panes', showInPalette: true },
  'pane::splitVertical': { label: 'Split Vertically', category: 'Panes', showInPalette: true },
  'pane::focusLeft': { label: 'Focus Left Pane', category: 'Panes', showInPalette: true },
  'pane::focusDown': { label: 'Focus Pane Below', category: 'Panes', showInPalette: true },
  'pane::focusUp': { label: 'Focus Pane Above', category: 'Panes', showInPalette: true },
  'pane::focusRight': { label: 'Focus Right Pane', category: 'Panes', showInPalette: true },
  'pane::close': { label: 'Close Pane', category: 'Panes', showInPalette: true },
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

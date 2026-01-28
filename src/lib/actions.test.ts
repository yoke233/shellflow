import { describe, it, expect } from 'vitest';
import {
  isActionAvailable,
  getActionAvailability,
  getPaletteActions,
  getAvailablePaletteActions,
  ACTION_METADATA,
  type ActionContext,
  type ActionId,
} from './actions';

// Default context with nothing active
const emptyContext: ActionContext = {
  activeProjectId: null,
  activeWorktreeId: null,
  activeScratchId: null,
  activeEntityId: null,
  isDrawerOpen: false,
  isDrawerFocused: false,
  activeDrawerTabId: null,
  openEntityCount: 0,
  canGoBack: false,
  canGoForward: false,
  activeSelectedTask: null,
  taskCount: 0,
  isViewingDiff: false,
  changedFilesCount: 0,
  hasSplits: false,
};

describe('isActionAvailable', () => {
  describe('always available actions', () => {
    it.each([
      'app::quit',
      'app::addProject',
      'app::openSettings',
      'app::openMappings',
      'app::helpDocs',
      'app::helpReportIssue',
      'app::helpReleaseNotes',
      'palette::toggle',
      'palette::projectSwitcher',
      'scratch::new',
      'view::zoomIn',
      'view::zoomOut',
      'view::zoomReset',
    ] as ActionId[])('%s is always available', (actionId) => {
      expect(isActionAvailable(actionId, emptyContext)).toBe(true);
    });
  });

  describe('entity navigation (navigate::toEntity1-9)', () => {
    it('toEntity1 is available with 1 open entity', () => {
      const ctx = { ...emptyContext, openEntityCount: 1 };
      expect(isActionAvailable('navigate::toEntity1', ctx)).toBe(true);
      expect(isActionAvailable('navigate::toEntity2', ctx)).toBe(false);
    });

    it('toEntity3 is available with 3 open entities', () => {
      const ctx = { ...emptyContext, openEntityCount: 3 };
      expect(isActionAvailable('navigate::toEntity1', ctx)).toBe(true);
      expect(isActionAvailable('navigate::toEntity2', ctx)).toBe(true);
      expect(isActionAvailable('navigate::toEntity3', ctx)).toBe(true);
      expect(isActionAvailable('navigate::toEntity4', ctx)).toBe(false);
    });

    it('all toEntity actions are available with 9+ entities', () => {
      const ctx = { ...emptyContext, openEntityCount: 9 };
      for (let i = 1; i <= 9; i++) {
        expect(isActionAvailable(`navigate::toEntity${i}` as ActionId, ctx)).toBe(true);
      }
    });

    it('no toEntity actions are available with 0 entities', () => {
      for (let i = 1; i <= 9; i++) {
        expect(isActionAvailable(`navigate::toEntity${i}` as ActionId, emptyContext)).toBe(false);
      }
    });
  });

  describe('prev/next navigation', () => {
    it('navigate::prev requires at least 1 open entity', () => {
      expect(isActionAvailable('navigate::prev', emptyContext)).toBe(false);
      expect(isActionAvailable('navigate::prev', { ...emptyContext, openEntityCount: 1 })).toBe(true);
    });

    it('navigate::next requires at least 1 open entity', () => {
      expect(isActionAvailable('navigate::next', emptyContext)).toBe(false);
      expect(isActionAvailable('navigate::next', { ...emptyContext, openEntityCount: 1 })).toBe(true);
    });
  });

  describe('history navigation', () => {
    it('navigate::back requires canGoBack', () => {
      expect(isActionAvailable('navigate::back', emptyContext)).toBe(false);
      expect(isActionAvailable('navigate::back', { ...emptyContext, canGoBack: true })).toBe(true);
    });

    it('navigate::forward requires canGoForward', () => {
      expect(isActionAvailable('navigate::forward', emptyContext)).toBe(false);
      expect(isActionAvailable('navigate::forward', { ...emptyContext, canGoForward: true })).toBe(true);
    });
  });

  describe('worktree actions', () => {
    it('worktree::new requires activeProjectId and no activeScratchId', () => {
      expect(isActionAvailable('worktree::new', emptyContext)).toBe(false);
      expect(isActionAvailable('worktree::new', { ...emptyContext, activeProjectId: 'p1' })).toBe(true);
      expect(isActionAvailable('worktree::new', {
        ...emptyContext,
        activeProjectId: 'p1',
        activeScratchId: 's1'
      })).toBe(false);
    });

    it('worktree::delete requires activeWorktreeId', () => {
      expect(isActionAvailable('worktree::delete', emptyContext)).toBe(false);
      expect(isActionAvailable('worktree::delete', { ...emptyContext, activeWorktreeId: 'wt1' })).toBe(true);
    });
  });

  describe('diff navigation', () => {
    it('diff::open requires activeEntityId and changed files', () => {
      expect(isActionAvailable('diff::open', emptyContext)).toBe(false);
      expect(isActionAvailable('diff::open', { ...emptyContext, activeEntityId: 'e1' })).toBe(false);
      expect(isActionAvailable('diff::open', { ...emptyContext, changedFilesCount: 1 })).toBe(false);
      expect(isActionAvailable('diff::open', {
        ...emptyContext,
        activeEntityId: 'e1',
        changedFilesCount: 1
      })).toBe(true);
    });

    it('diff::nextFile requires diff view with multiple files', () => {
      expect(isActionAvailable('diff::nextFile', emptyContext)).toBe(false);
      expect(isActionAvailable('diff::nextFile', { ...emptyContext, isViewingDiff: true })).toBe(false);
      expect(isActionAvailable('diff::nextFile', {
        ...emptyContext,
        isViewingDiff: true,
        changedFilesCount: 1
      })).toBe(false);
      expect(isActionAvailable('diff::nextFile', {
        ...emptyContext,
        isViewingDiff: true,
        changedFilesCount: 2
      })).toBe(true);
    });
  });

  describe('task actions', () => {
    it('task::run requires activeEntityId and activeSelectedTask', () => {
      expect(isActionAvailable('task::run', emptyContext)).toBe(false);
      expect(isActionAvailable('task::run', { ...emptyContext, activeEntityId: 'e1' })).toBe(false);
      expect(isActionAvailable('task::run', {
        ...emptyContext,
        activeEntityId: 'e1',
        activeSelectedTask: 'build'
      })).toBe(true);
    });

    it('task::switcher requires taskCount > 0', () => {
      expect(isActionAvailable('task::switcher', emptyContext)).toBe(false);
      expect(isActionAvailable('task::switcher', { ...emptyContext, taskCount: 1 })).toBe(true);
    });
  });

  describe('split actions', () => {
    it('split::horizontal requires activeEntityId', () => {
      expect(isActionAvailable('split::horizontal', emptyContext)).toBe(false);
      expect(isActionAvailable('split::horizontal', { ...emptyContext, activeEntityId: 'e1' })).toBe(true);
    });

    it('split::vertical requires activeEntityId', () => {
      expect(isActionAvailable('split::vertical', emptyContext)).toBe(false);
      expect(isActionAvailable('split::vertical', { ...emptyContext, activeEntityId: 'e1' })).toBe(true);
    });

    it('split::focusLeft requires activeEntityId and hasSplits', () => {
      expect(isActionAvailable('split::focusLeft', emptyContext)).toBe(false);
      expect(isActionAvailable('split::focusLeft', { ...emptyContext, activeEntityId: 'e1' })).toBe(false);
      expect(isActionAvailable('split::focusLeft', {
        ...emptyContext,
        activeEntityId: 'e1',
        hasSplits: true
      })).toBe(true);
    });

    it('split::focusDown requires activeEntityId and hasSplits', () => {
      expect(isActionAvailable('split::focusDown', emptyContext)).toBe(false);
      expect(isActionAvailable('split::focusDown', {
        ...emptyContext,
        activeEntityId: 'e1',
        hasSplits: true
      })).toBe(true);
    });

    it('split::focusUp requires activeEntityId and hasSplits', () => {
      expect(isActionAvailable('split::focusUp', emptyContext)).toBe(false);
      expect(isActionAvailable('split::focusUp', {
        ...emptyContext,
        activeEntityId: 'e1',
        hasSplits: true
      })).toBe(true);
    });

    it('split::focusRight requires activeEntityId and hasSplits', () => {
      expect(isActionAvailable('split::focusRight', emptyContext)).toBe(false);
      expect(isActionAvailable('split::focusRight', {
        ...emptyContext,
        activeEntityId: 'e1',
        hasSplits: true
      })).toBe(true);
    });
  });
});

describe('getActionAvailability', () => {
  it('returns availability for all actions', () => {
    const availability = getActionAvailability(emptyContext);

    // Check some known values
    expect(availability['app::quit']).toBe(true);
    expect(availability['navigate::toEntity1']).toBe(false);
    expect(availability['worktree::delete']).toBe(false);
  });
});

describe('getPaletteActions', () => {
  it('returns actions marked for palette display', () => {
    const paletteActions = getPaletteActions();

    // Should include palette-visible actions
    expect(paletteActions).toContain('app::addProject');
    expect(paletteActions).toContain('view::zoomIn');

    // Should exclude palette-hidden actions
    expect(paletteActions).not.toContain('app::quit');
    expect(paletteActions).not.toContain('palette::toggle');
    expect(paletteActions).not.toContain('navigate::toEntity1');
  });
});

describe('getAvailablePaletteActions', () => {
  it('filters palette actions by availability', () => {
    const available = getAvailablePaletteActions(emptyContext);

    // Always-available palette actions should be included
    expect(available).toContain('app::addProject');
    expect(available).toContain('view::zoomIn');

    // Actions requiring context should be excluded
    expect(available).not.toContain('worktree::delete');
    expect(available).not.toContain('session::newTab');
  });

  it('includes context-dependent actions when context is satisfied', () => {
    const ctx: ActionContext = {
      ...emptyContext,
      activeWorktreeId: 'wt1',
      activeEntityId: 'wt1',
    };
    const available = getAvailablePaletteActions(ctx);

    expect(available).toContain('worktree::delete');
    expect(available).toContain('session::newTab');
  });
});

describe('ACTION_METADATA', () => {
  it('has metadata for all action types', () => {
    // Verify structure of a few actions
    expect(ACTION_METADATA['app::addProject']).toEqual({
      label: 'Open Project',
      category: 'File',
      showInPalette: true,
    });

    expect(ACTION_METADATA['worktree::delete']).toEqual({
      label: 'Delete Worktree',
      category: 'Navigate',
      showInPalette: true,
    });
  });
});

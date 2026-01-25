import { describe, it, expect } from 'vitest';
import {
  getActiveContexts,
  hasContext,
  formatContexts,
  type ContextState,
} from './contexts';

// Default state with nothing active
const emptyState: ContextState = {
  activeSessionId: null,
  activeSessionKind: null,
  activeScratchId: null,
  activeWorktreeId: null,
  activeProjectId: null,
  focusState: 'main',
  isDrawerOpen: false,
  isRightPanelOpen: false,
  isCommandPaletteOpen: false,
  isTaskSwitcherOpen: false,
  isProjectSwitcherOpen: false,
  hasOpenModal: false,
  openEntityCount: 0,
  hasPreviousView: false,
};

describe('getActiveContexts', () => {
  describe('view focus (mutually exclusive) - unified session', () => {
    it('includes scratchFocused when scratch session is active', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        activeSessionId: 'scratch-1',
        activeSessionKind: 'scratch',
      });
      expect(contexts.has('scratchFocused')).toBe(true);
      expect(contexts.has('worktreeFocused')).toBe(false);
      expect(contexts.has('projectFocused')).toBe(false);
    });

    it('includes worktreeFocused when worktree session is active', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        activeSessionId: 'wt-1',
        activeSessionKind: 'worktree',
      });
      expect(contexts.has('worktreeFocused')).toBe(true);
      expect(contexts.has('scratchFocused')).toBe(false);
      expect(contexts.has('projectFocused')).toBe(false);
    });

    it('includes projectFocused when project session is active', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        activeSessionId: 'proj-1',
        activeSessionKind: 'project',
      });
      expect(contexts.has('projectFocused')).toBe(true);
      expect(contexts.has('scratchFocused')).toBe(false);
      expect(contexts.has('worktreeFocused')).toBe(false);
    });
  });

  describe('view focus (mutually exclusive) - legacy fallback', () => {
    it('includes scratchFocused when scratch is active', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        activeScratchId: 'scratch-1',
      });
      expect(contexts.has('scratchFocused')).toBe(true);
      expect(contexts.has('worktreeFocused')).toBe(false);
      expect(contexts.has('projectFocused')).toBe(false);
    });

    it('includes worktreeFocused when worktree is active', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        activeWorktreeId: 'wt-1',
      });
      expect(contexts.has('worktreeFocused')).toBe(true);
      expect(contexts.has('scratchFocused')).toBe(false);
      expect(contexts.has('projectFocused')).toBe(false);
    });

    it('includes projectFocused when only project is active', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        activeProjectId: 'proj-1',
      });
      expect(contexts.has('projectFocused')).toBe(true);
      expect(contexts.has('scratchFocused')).toBe(false);
      expect(contexts.has('worktreeFocused')).toBe(false);
    });

    it('scratch takes priority over worktree', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        activeScratchId: 'scratch-1',
        activeWorktreeId: 'wt-1',
      });
      expect(contexts.has('scratchFocused')).toBe(true);
      expect(contexts.has('worktreeFocused')).toBe(false);
    });

    it('worktree takes priority over project', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        activeWorktreeId: 'wt-1',
        activeProjectId: 'proj-1',
      });
      expect(contexts.has('worktreeFocused')).toBe(true);
      expect(contexts.has('projectFocused')).toBe(false);
    });
  });

  describe('unified session takes precedence over legacy', () => {
    it('activeSessionKind overrides legacy activeScratchId', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        activeSessionId: 'proj-1',
        activeSessionKind: 'project',
        activeScratchId: 'scratch-1', // This should be ignored
      });
      expect(contexts.has('projectFocused')).toBe(true);
      expect(contexts.has('scratchFocused')).toBe(false);
    });
  });

  describe('panel focus', () => {
    it('includes drawerFocused when drawer is open and focused', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        isDrawerOpen: true,
        focusState: 'drawer',
      });
      expect(contexts.has('drawerFocused')).toBe(true);
      expect(contexts.has('mainFocused')).toBe(false);
    });

    it('does not include drawerFocused when drawer is closed', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        isDrawerOpen: false,
        focusState: 'drawer',
      });
      expect(contexts.has('drawerFocused')).toBe(false);
    });

    it('includes mainFocused when main is focused', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        focusState: 'main',
      });
      expect(contexts.has('mainFocused')).toBe(true);
      expect(contexts.has('drawerFocused')).toBe(false);
    });

    it('drawerFocused and view focus can coexist', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        activeSessionId: 'wt-1',
        activeSessionKind: 'worktree',
        isDrawerOpen: true,
        focusState: 'drawer',
      });
      expect(contexts.has('worktreeFocused')).toBe(true);
      expect(contexts.has('drawerFocused')).toBe(true);
    });
  });

  describe('UI state', () => {
    it('includes drawerOpen when drawer is open', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        isDrawerOpen: true,
      });
      expect(contexts.has('drawerOpen')).toBe(true);
    });

    it('includes rightPanelOpen when right panel is open', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        isRightPanelOpen: true,
      });
      expect(contexts.has('rightPanelOpen')).toBe(true);
    });
  });

  describe('pickers', () => {
    it('includes pickerOpen when command palette is open', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        isCommandPaletteOpen: true,
      });
      expect(contexts.has('pickerOpen')).toBe(true);
      expect(contexts.has('commandPaletteOpen')).toBe(true);
    });

    it('includes pickerOpen when task switcher is open', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        isTaskSwitcherOpen: true,
      });
      expect(contexts.has('pickerOpen')).toBe(true);
      expect(contexts.has('taskSwitcherOpen')).toBe(true);
    });

    it('includes pickerOpen when project switcher is open', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        isProjectSwitcherOpen: true,
      });
      expect(contexts.has('pickerOpen')).toBe(true);
      expect(contexts.has('projectSwitcherOpen')).toBe(true);
    });
  });

  describe('modal', () => {
    it('includes modalOpen when modal is open', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        hasOpenModal: true,
      });
      expect(contexts.has('modalOpen')).toBe(true);
    });
  });

  describe('entity state', () => {
    it('includes hasMultipleEntities when more than one entity is open', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        openEntityCount: 2,
      });
      expect(contexts.has('hasMultipleEntities')).toBe(true);
    });

    it('does not include hasMultipleEntities when only one entity is open', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        openEntityCount: 1,
      });
      expect(contexts.has('hasMultipleEntities')).toBe(false);
    });
  });

  describe('navigation', () => {
    it('includes hasPreviousView when previous view exists', () => {
      const contexts = getActiveContexts({
        ...emptyState,
        hasPreviousView: true,
      });
      expect(contexts.has('hasPreviousView')).toBe(true);
    });
  });
});

describe('hasContext', () => {
  it('returns true for present context', () => {
    const contexts = new Set<'scratchFocused'>(['scratchFocused']);
    expect(hasContext(contexts, 'scratchFocused')).toBe(true);
  });

  it('returns false for absent context', () => {
    const contexts = new Set<'scratchFocused'>(['scratchFocused']);
    expect(hasContext(contexts, 'worktreeFocused')).toBe(false);
  });
});

describe('formatContexts', () => {
  it('formats contexts as sorted comma-separated string', () => {
    const contexts = getActiveContexts({
      ...emptyState,
      activeSessionId: 'wt-1',
      activeSessionKind: 'worktree',
      isDrawerOpen: true,
      focusState: 'drawer',
    });
    const formatted = formatContexts(contexts);
    expect(formatted).toBe('drawerFocused, drawerOpen, worktreeFocused');
  });

  it('returns empty string for no contexts', () => {
    const contexts = new Set<never>();
    expect(formatContexts(contexts)).toBe('');
  });
});

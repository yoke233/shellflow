import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useIndicators } from './useIndicators';
import { resetMocks, createTestProject, createTestWorktree } from '../test/setup';
import { Session } from '../types';

// Mock the notifications module
vi.mock('../lib/notifications', () => ({
  sendOsNotification: vi.fn(),
}));

import { sendOsNotification } from '../lib/notifications';

describe('useIndicators', () => {
  // Helper to create sessions from projects/worktrees
  const createSessions = (projects: ReturnType<typeof createTestProject>[]): Session[] => {
    const sessions: Session[] = [];
    let order = 0;
    for (const project of projects) {
      sessions.push({
        id: project.id,
        kind: 'project',
        name: project.name,
        path: project.path,
        order: order++,
      });
      for (const worktree of project.worktrees) {
        sessions.push({
          id: worktree.id,
          kind: 'worktree',
          name: worktree.name,
          path: worktree.path,
          order: order++,
          projectId: project.id,
          branch: worktree.branch,
        });
      }
    }
    return sessions;
  };

  const defaultOptions = {
    activeSessionId: null,
    sessions: [] as Session[],
  };

  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('starts with empty indicator sets', () => {
      const { result } = renderHook(() => useIndicators(defaultOptions));

      expect(result.current.notifiedWorktreeIds.size).toBe(0);
      expect(result.current.thinkingWorktreeIds.size).toBe(0);
      expect(result.current.idleWorktreeIds.size).toBe(0);
      expect(result.current.notifiedProjectIds.size).toBe(0);
      expect(result.current.thinkingProjectIds.size).toBe(0);
      expect(result.current.idleProjectIds.size).toBe(0);
    });

    it('starts with empty unified indicators map', () => {
      const { result } = renderHook(() => useIndicators(defaultOptions));

      expect(result.current.indicators.size).toBe(0);
    });
  });

  describe('unified handleNotification', () => {
    it('adds session to indicators on notification', () => {
      const sessions: Session[] = [
        { id: 'session-1', kind: 'scratch', name: 'Terminal 1', path: '/home', order: 0 },
      ];
      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleNotification('session-1', 'Title', 'Body');
      });

      expect(result.current.getIndicators('session-1').notified).toBe(true);
    });

    it('sends OS notification for inactive session', () => {
      const sessions: Session[] = [
        { id: 'session-1', kind: 'scratch', name: 'Terminal 1', path: '/home', order: 0 },
        { id: 'session-2', kind: 'scratch', name: 'Terminal 2', path: '/home', order: 1 },
      ];
      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: 'session-2', sessions })
      );

      act(() => {
        result.current.handleNotification('session-1', 'Test Title', 'Test Body');
      });

      expect(sendOsNotification).toHaveBeenCalledWith('Test Title', 'Test Body');
    });

    it('does not send OS notification for active session', () => {
      const sessions: Session[] = [
        { id: 'session-1', kind: 'scratch', name: 'Terminal 1', path: '/home', order: 0 },
      ];
      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: 'session-1', sessions })
      );

      act(() => {
        result.current.handleNotification('session-1', 'Title', 'Body');
      });

      expect(sendOsNotification).not.toHaveBeenCalled();
    });

    it('uses session name as title if not provided', () => {
      const sessions: Session[] = [
        { id: 'session-1', kind: 'scratch', name: 'My Terminal', path: '/home', order: 0 },
      ];
      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleNotification('session-1', '', 'Body');
      });

      expect(sendOsNotification).toHaveBeenCalledWith('My Terminal', 'Body');
    });

    it('clears notification when session becomes active', () => {
      const sessions: Session[] = [
        { id: 'session-1', kind: 'scratch', name: 'Terminal 1', path: '/home', order: 0 },
      ];
      const { result, rerender } = renderHook(
        (props) => useIndicators(props),
        { initialProps: { activeSessionId: null, sessions } }
      );

      act(() => {
        result.current.handleNotification('session-1', 'Title', 'Body');
      });

      expect(result.current.getIndicators('session-1').notified).toBe(true);

      rerender({ activeSessionId: 'session-1', sessions });

      expect(result.current.getIndicators('session-1').notified).toBe(false);
    });
  });

  describe('unified handleThinkingChange', () => {
    it('sets thinking state', () => {
      const sessions: Session[] = [
        { id: 'session-1', kind: 'scratch', name: 'Terminal 1', path: '/home', order: 0 },
      ];
      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleThinkingChange('session-1', true);
      });

      expect(result.current.getIndicators('session-1').thinking).toBe(true);
      expect(result.current.getIndicators('session-1').idle).toBe(false);
    });

    it('clears thinking and sets idle when thinking stops', () => {
      const sessions: Session[] = [
        { id: 'session-1', kind: 'scratch', name: 'Terminal 1', path: '/home', order: 0 },
      ];
      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleThinkingChange('session-1', true);
      });
      act(() => {
        result.current.handleThinkingChange('session-1', false);
      });

      expect(result.current.getIndicators('session-1').thinking).toBe(false);
      expect(result.current.getIndicators('session-1').idle).toBe(true);
    });

    it('does not set idle if was not thinking', () => {
      const sessions: Session[] = [
        { id: 'session-1', kind: 'scratch', name: 'Terminal 1', path: '/home', order: 0 },
      ];
      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleThinkingChange('session-1', false);
      });

      expect(result.current.getIndicators('session-1').idle).toBe(false);
    });

    it('clears idle when session becomes active', () => {
      const sessions: Session[] = [
        { id: 'session-1', kind: 'scratch', name: 'Terminal 1', path: '/home', order: 0 },
      ];
      const { result, rerender } = renderHook(
        (props) => useIndicators(props),
        { initialProps: { activeSessionId: null, sessions } }
      );

      act(() => {
        result.current.handleThinkingChange('session-1', true);
      });
      act(() => {
        result.current.handleThinkingChange('session-1', false);
      });

      expect(result.current.getIndicators('session-1').idle).toBe(true);

      rerender({ activeSessionId: 'session-1', sessions });

      expect(result.current.getIndicators('session-1').idle).toBe(false);
    });
  });

  describe('legacy worktree compatibility', () => {
    it('adds worktree to notified set on notification', () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature' });
      const project = createTestProject({ worktrees: [worktree] });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleWorktreeNotification('wt-1', 'Title', 'Body');
      });

      expect(result.current.notifiedWorktreeIds.has('wt-1')).toBe(true);
    });

    it('sends OS notification for inactive worktree', () => {
      const worktree1 = createTestWorktree({ id: 'wt-1', name: 'feature-1' });
      const worktree2 = createTestWorktree({ id: 'wt-2', name: 'feature-2' });
      const project = createTestProject({ worktrees: [worktree1, worktree2] });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: 'wt-2', sessions })
      );

      act(() => {
        result.current.handleWorktreeNotification('wt-1', 'Test Title', 'Test Body');
      });

      expect(sendOsNotification).toHaveBeenCalledWith('Test Title', 'Test Body');
    });

    it('does not send OS notification for active worktree', () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature' });
      const project = createTestProject({ worktrees: [worktree] });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: 'wt-1', sessions })
      );

      act(() => {
        result.current.handleWorktreeNotification('wt-1', 'Title', 'Body');
      });

      expect(sendOsNotification).not.toHaveBeenCalled();
    });

    it('uses worktree name as title if not provided', () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-branch' });
      const project = createTestProject({ worktrees: [worktree] });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleWorktreeNotification('wt-1', '', 'Body');
      });

      expect(sendOsNotification).toHaveBeenCalledWith('feature-branch', 'Body');
    });

    it('clears notification when worktree becomes active', () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature' });
      const project = createTestProject({ worktrees: [worktree] });
      const sessions = createSessions([project]);

      const { result, rerender } = renderHook(
        (props) => useIndicators(props),
        { initialProps: { activeSessionId: null, sessions } }
      );

      act(() => {
        result.current.handleWorktreeNotification('wt-1', 'Title', 'Body');
      });

      expect(result.current.notifiedWorktreeIds.has('wt-1')).toBe(true);

      rerender({ activeSessionId: 'wt-1', sessions });

      expect(result.current.notifiedWorktreeIds.has('wt-1')).toBe(false);
    });
  });

  describe('legacy worktree thinking state', () => {
    it('adds worktree to thinking set when thinking starts', () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature' });
      const project = createTestProject({ worktrees: [worktree] });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleWorktreeThinkingChange('wt-1', true);
      });

      expect(result.current.thinkingWorktreeIds.has('wt-1')).toBe(true);
    });

    it('removes worktree from thinking set when thinking stops', () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature' });
      const project = createTestProject({ worktrees: [worktree] });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleWorktreeThinkingChange('wt-1', true);
      });
      act(() => {
        result.current.handleWorktreeThinkingChange('wt-1', false);
      });

      expect(result.current.thinkingWorktreeIds.has('wt-1')).toBe(false);
    });

    it('clears idle state when thinking starts', () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature' });
      const project = createTestProject({ worktrees: [worktree] });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      // First, make worktree idle by completing a thinking cycle
      act(() => {
        result.current.handleWorktreeThinkingChange('wt-1', true);
      });
      act(() => {
        result.current.handleWorktreeThinkingChange('wt-1', false);
      });

      expect(result.current.idleWorktreeIds.has('wt-1')).toBe(true);

      // Start thinking again - should clear idle
      act(() => {
        result.current.handleWorktreeThinkingChange('wt-1', true);
      });

      expect(result.current.idleWorktreeIds.has('wt-1')).toBe(false);
    });

    it('sets idle state when thinking stops', () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature' });
      const project = createTestProject({ worktrees: [worktree] });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleWorktreeThinkingChange('wt-1', true);
      });
      act(() => {
        result.current.handleWorktreeThinkingChange('wt-1', false);
      });

      expect(result.current.idleWorktreeIds.has('wt-1')).toBe(true);
    });

    it('does not set idle if was not thinking', () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature' });
      const project = createTestProject({ worktrees: [worktree] });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleWorktreeThinkingChange('wt-1', false);
      });

      expect(result.current.idleWorktreeIds.has('wt-1')).toBe(false);
    });

    it('clears idle state when worktree becomes active', () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature' });
      const project = createTestProject({ worktrees: [worktree] });
      const sessions = createSessions([project]);

      const { result, rerender } = renderHook(
        (props) => useIndicators(props),
        { initialProps: { activeSessionId: null, sessions } }
      );

      // Create idle state
      act(() => {
        result.current.handleWorktreeThinkingChange('wt-1', true);
      });
      act(() => {
        result.current.handleWorktreeThinkingChange('wt-1', false);
      });

      expect(result.current.idleWorktreeIds.has('wt-1')).toBe(true);

      rerender({ activeSessionId: 'wt-1', sessions });

      expect(result.current.idleWorktreeIds.has('wt-1')).toBe(false);
    });
  });

  describe('legacy project compatibility', () => {
    it('adds project to notified set on notification', () => {
      const project = createTestProject({ id: 'proj-1', name: 'my-project' });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleProjectNotification('proj-1', 'Title', 'Body');
      });

      expect(result.current.notifiedProjectIds.has('proj-1')).toBe(true);
    });

    it('sends OS notification for inactive project', () => {
      const project1 = createTestProject({ id: 'proj-1', name: 'project-1' });
      const project2 = createTestProject({ id: 'proj-2', name: 'project-2' });
      const sessions = createSessions([project1, project2]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: 'proj-2', sessions })
      );

      act(() => {
        result.current.handleProjectNotification('proj-1', 'Test Title', 'Test Body');
      });

      expect(sendOsNotification).toHaveBeenCalledWith('Test Title', 'Test Body');
    });

    it('does not send OS notification for active project', () => {
      const project = createTestProject({ id: 'proj-1', name: 'my-project' });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: 'proj-1', sessions })
      );

      act(() => {
        result.current.handleProjectNotification('proj-1', 'Title', 'Body');
      });

      expect(sendOsNotification).not.toHaveBeenCalled();
    });

    it('uses project name as title if not provided', () => {
      const project = createTestProject({ id: 'proj-1', name: 'my-project' });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleProjectNotification('proj-1', '', 'Body');
      });

      expect(sendOsNotification).toHaveBeenCalledWith('my-project', 'Body');
    });

    it('clears notification when project becomes active', () => {
      const project = createTestProject({ id: 'proj-1', name: 'my-project' });
      const sessions = createSessions([project]);

      const { result, rerender } = renderHook(
        (props) => useIndicators(props),
        { initialProps: { activeSessionId: null, sessions } }
      );

      act(() => {
        result.current.handleProjectNotification('proj-1', 'Title', 'Body');
      });

      expect(result.current.notifiedProjectIds.has('proj-1')).toBe(true);

      rerender({ activeSessionId: 'proj-1', sessions });

      expect(result.current.notifiedProjectIds.has('proj-1')).toBe(false);
    });
  });

  describe('legacy project thinking state', () => {
    it('adds project to thinking set when thinking starts', () => {
      const project = createTestProject({ id: 'proj-1', name: 'my-project' });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleProjectThinkingChange('proj-1', true);
      });

      expect(result.current.thinkingProjectIds.has('proj-1')).toBe(true);
    });

    it('removes project from thinking set when thinking stops', () => {
      const project = createTestProject({ id: 'proj-1', name: 'my-project' });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleProjectThinkingChange('proj-1', true);
      });
      act(() => {
        result.current.handleProjectThinkingChange('proj-1', false);
      });

      expect(result.current.thinkingProjectIds.has('proj-1')).toBe(false);
    });

    it('sets idle state when thinking stops', () => {
      const project = createTestProject({ id: 'proj-1', name: 'my-project' });
      const sessions = createSessions([project]);

      const { result } = renderHook(() =>
        useIndicators({ activeSessionId: null, sessions })
      );

      act(() => {
        result.current.handleProjectThinkingChange('proj-1', true);
      });
      act(() => {
        result.current.handleProjectThinkingChange('proj-1', false);
      });

      expect(result.current.idleProjectIds.has('proj-1')).toBe(true);
    });

    it('clears idle state when project becomes active', () => {
      const project = createTestProject({ id: 'proj-1', name: 'my-project' });
      const sessions = createSessions([project]);

      const { result, rerender } = renderHook(
        (props) => useIndicators(props),
        { initialProps: { activeSessionId: null, sessions } }
      );

      // Create idle state
      act(() => {
        result.current.handleProjectThinkingChange('proj-1', true);
      });
      act(() => {
        result.current.handleProjectThinkingChange('proj-1', false);
      });

      expect(result.current.idleProjectIds.has('proj-1')).toBe(true);

      rerender({ activeSessionId: 'proj-1', sessions });

      expect(result.current.idleProjectIds.has('proj-1')).toBe(false);
    });
  });
});

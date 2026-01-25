import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSessions } from './useSessions';
import { ScratchTerminal, Project } from '../types';

describe('useSessions', () => {
  const createScratch = (id: string, name: string, order: number): ScratchTerminal => ({
    id,
    name,
    order,
  });

  const createProject = (
    id: string,
    name: string,
    path: string,
    worktrees: Array<{ id: string; name: string; path: string; branch: string }> = []
  ): Project => ({
    id,
    name,
    path,
    isActive: true,
    worktrees: worktrees.map((w, i) => ({
      ...w,
      createdAt: new Date().toISOString(),
      order: i,
    })),
  });

  describe('deriveSessions', () => {
    it('returns empty array when no data', () => {
      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals: [],
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      expect(result.current.sessions).toEqual([]);
    });

    it('derives sessions from scratch terminals', () => {
      const scratchTerminals = [
        createScratch('scratch-1', 'Terminal 1', 0),
        createScratch('scratch-2', 'Terminal 2', 1),
      ];
      const scratchCwds = new Map([
        ['scratch-1', '/projects/foo'],
        ['scratch-2', '/projects/bar'],
      ]);

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds,
          projects: [],
          homeDir: '/home/user',
        })
      );

      expect(result.current.sessions).toHaveLength(2);
      expect(result.current.sessions[0]).toEqual({
        id: 'scratch-1',
        kind: 'scratch',
        name: 'Terminal 1',
        path: '/projects/foo',
        order: 0,
      });
      expect(result.current.sessions[1]).toEqual({
        id: 'scratch-2',
        kind: 'scratch',
        name: 'Terminal 2',
        path: '/projects/bar',
        order: 1,
      });
    });

    it('uses homeDir for scratch terminals without cwd', () => {
      const scratchTerminals = [createScratch('scratch-1', 'Terminal 1', 0)];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      expect(result.current.sessions[0].path).toBe('/home/user');
    });

    it('derives sessions from projects and worktrees', () => {
      const projects = [
        createProject('proj-1', 'Project 1', '/projects/proj1', [
          { id: 'wt-1', name: 'feature-a', path: '/worktrees/wt1', branch: 'feature-a' },
          { id: 'wt-2', name: 'feature-b', path: '/worktrees/wt2', branch: 'feature-b' },
        ]),
      ];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals: [],
          scratchCwds: new Map(),
          projects,
          homeDir: '/home/user',
        })
      );

      expect(result.current.sessions).toHaveLength(3);

      // Project session
      expect(result.current.sessions[0]).toEqual({
        id: 'proj-1',
        kind: 'project',
        name: 'Project 1',
        path: '/projects/proj1',
        order: 0,
      });

      // Worktree sessions
      expect(result.current.sessions[1]).toEqual({
        id: 'wt-1',
        kind: 'worktree',
        name: 'feature-a',
        path: '/worktrees/wt1',
        order: 1,
        projectId: 'proj-1',
        branch: 'feature-a',
      });
      expect(result.current.sessions[2]).toEqual({
        id: 'wt-2',
        kind: 'worktree',
        name: 'feature-b',
        path: '/worktrees/wt2',
        order: 2,
        projectId: 'proj-1',
        branch: 'feature-b',
      });
    });

    it('orders scratch before projects', () => {
      const scratchTerminals = [createScratch('scratch-1', 'Terminal 1', 0)];
      const projects = [
        createProject('proj-1', 'Project 1', '/projects/proj1'),
      ];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects,
          homeDir: '/home/user',
        })
      );

      expect(result.current.sessions[0].kind).toBe('scratch');
      expect(result.current.sessions[1].kind).toBe('project');
    });

    it('excludes inactive projects', () => {
      const projects: Project[] = [
        { ...createProject('proj-1', 'Active', '/active'), isActive: true },
        { ...createProject('proj-2', 'Inactive', '/inactive'), isActive: false },
      ];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals: [],
          scratchCwds: new Map(),
          projects,
          homeDir: '/home/user',
        })
      );

      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.sessions[0].name).toBe('Active');
    });
  });

  describe('setActiveSession', () => {
    it('sets active session and auto-opens it', () => {
      const scratchTerminals = [createScratch('scratch-1', 'Terminal 1', 0)];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      expect(result.current.activeSessionId).toBeNull();
      expect(result.current.openSessionIds.size).toBe(0);

      act(() => {
        result.current.setActiveSession('scratch-1');
      });

      expect(result.current.activeSessionId).toBe('scratch-1');
      expect(result.current.openSessionIds.has('scratch-1')).toBe(true);
    });

    it('stores previous session for toggle back', () => {
      const scratchTerminals = [
        createScratch('scratch-1', 'Terminal 1', 0),
        createScratch('scratch-2', 'Terminal 2', 1),
      ];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.setActiveSession('scratch-1');
      });
      expect(result.current.previousSessionId).toBeNull();

      act(() => {
        result.current.setActiveSession('scratch-2');
      });
      expect(result.current.previousSessionId).toBe('scratch-1');
    });
  });

  describe('openSession/closeSession', () => {
    it('opens and closes sessions', () => {
      const scratchTerminals = [createScratch('scratch-1', 'Terminal 1', 0)];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.openSession('scratch-1');
      });
      expect(result.current.openSessionIds.has('scratch-1')).toBe(true);

      act(() => {
        result.current.closeSession('scratch-1');
      });
      expect(result.current.openSessionIds.has('scratch-1')).toBe(false);
    });
  });

  describe('navigation', () => {
    it('getNextSessionId cycles through open sessions', () => {
      const scratchTerminals = [
        createScratch('scratch-1', 'Terminal 1', 0),
        createScratch('scratch-2', 'Terminal 2', 1),
        createScratch('scratch-3', 'Terminal 3', 2),
      ];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      // Open all sessions
      act(() => {
        result.current.openSession('scratch-1');
        result.current.openSession('scratch-2');
        result.current.openSession('scratch-3');
      });

      expect(result.current.getNextSessionId('scratch-1')).toBe('scratch-2');
      expect(result.current.getNextSessionId('scratch-2')).toBe('scratch-3');
      expect(result.current.getNextSessionId('scratch-3')).toBe('scratch-1'); // wraps
    });

    it('getPrevSessionId cycles through open sessions', () => {
      const scratchTerminals = [
        createScratch('scratch-1', 'Terminal 1', 0),
        createScratch('scratch-2', 'Terminal 2', 1),
      ];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.openSession('scratch-1');
        result.current.openSession('scratch-2');
      });

      expect(result.current.getPrevSessionId('scratch-2')).toBe('scratch-1');
      expect(result.current.getPrevSessionId('scratch-1')).toBe('scratch-2'); // wraps
    });

    it('getSessionByIndex returns correct session', () => {
      const scratchTerminals = [
        createScratch('scratch-1', 'Terminal 1', 0),
        createScratch('scratch-2', 'Terminal 2', 1),
      ];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.openSession('scratch-1');
        result.current.openSession('scratch-2');
      });

      expect(result.current.getSessionByIndex(1)?.id).toBe('scratch-1');
      expect(result.current.getSessionByIndex(2)?.id).toBe('scratch-2');
      expect(result.current.getSessionByIndex(0)).toBeNull();
      expect(result.current.getSessionByIndex(10)).toBeNull();
    });
  });

  describe('activeSession', () => {
    it('returns null when no active session', () => {
      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals: [],
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      expect(result.current.activeSession).toBeNull();
    });

    it('returns the active session object', () => {
      const scratchTerminals = [createScratch('scratch-1', 'Terminal 1', 0)];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map([['scratch-1', '/projects/foo']]),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.setActiveSession('scratch-1');
      });

      expect(result.current.activeSession).toEqual({
        id: 'scratch-1',
        kind: 'scratch',
        name: 'Terminal 1',
        path: '/projects/foo',
        order: 0,
      });
    });
  });

  describe('closeSession edge cases', () => {
    it('clears active session when closing the active session', () => {
      const scratchTerminals = [createScratch('scratch-1', 'Terminal 1', 0)];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.setActiveSession('scratch-1');
      });

      expect(result.current.activeSessionId).toBe('scratch-1');

      act(() => {
        result.current.closeSession('scratch-1');
      });

      expect(result.current.activeSessionId).toBeNull();
      expect(result.current.openSessionIds.has('scratch-1')).toBe(false);
    });

    it('activates last remaining session when closing active session', () => {
      const scratchTerminals = [
        createScratch('scratch-1', 'Terminal 1', 0),
        createScratch('scratch-2', 'Terminal 2', 1),
      ];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.openSession('scratch-1');
        result.current.openSession('scratch-2');
        result.current.setActiveSession('scratch-1');
      });

      act(() => {
        result.current.closeSession('scratch-1');
      });

      // Should activate the remaining open session
      expect(result.current.openSessionIds.has('scratch-2')).toBe(true);
    });

    it('does not affect active session when closing a different session', () => {
      const scratchTerminals = [
        createScratch('scratch-1', 'Terminal 1', 0),
        createScratch('scratch-2', 'Terminal 2', 1),
      ];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.openSession('scratch-1');
        result.current.openSession('scratch-2');
        result.current.setActiveSession('scratch-1');
      });

      act(() => {
        result.current.closeSession('scratch-2');
      });

      expect(result.current.activeSessionId).toBe('scratch-1');
      expect(result.current.openSessionIds.has('scratch-2')).toBe(false);
    });
  });

  describe('navigation edge cases', () => {
    it('getNextSessionId returns null when no sessions are open', () => {
      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals: [],
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      expect(result.current.getNextSessionId(null)).toBeNull();
      expect(result.current.getNextSessionId('nonexistent')).toBeNull();
    });

    it('getPrevSessionId returns null when no sessions are open', () => {
      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals: [],
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      expect(result.current.getPrevSessionId(null)).toBeNull();
      expect(result.current.getPrevSessionId('nonexistent')).toBeNull();
    });

    it('getNextSessionId returns first session when current is null', () => {
      const scratchTerminals = [createScratch('scratch-1', 'Terminal 1', 0)];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.openSession('scratch-1');
      });

      expect(result.current.getNextSessionId(null)).toBe('scratch-1');
    });

    it('getPrevSessionId returns last session when current is null', () => {
      const scratchTerminals = [
        createScratch('scratch-1', 'Terminal 1', 0),
        createScratch('scratch-2', 'Terminal 2', 1),
      ];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.openSession('scratch-1');
        result.current.openSession('scratch-2');
      });

      expect(result.current.getPrevSessionId(null)).toBe('scratch-2');
    });

    it('handles navigation with single open session', () => {
      const scratchTerminals = [createScratch('scratch-1', 'Terminal 1', 0)];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.openSession('scratch-1');
      });

      // With single session, next and prev should return the same session
      expect(result.current.getNextSessionId('scratch-1')).toBe('scratch-1');
      expect(result.current.getPrevSessionId('scratch-1')).toBe('scratch-1');
    });
  });

  describe('session updates when source data changes', () => {
    it('updates sessions when scratchTerminals change', () => {
      const initialScratch = [createScratch('scratch-1', 'Terminal 1', 0)];

      const { result, rerender } = renderHook(
        (props) => useSessions(props),
        {
          initialProps: {
            scratchTerminals: initialScratch,
            scratchCwds: new Map<string, string>(),
            projects: [] as Project[],
            homeDir: '/home/user',
          },
        }
      );

      expect(result.current.sessions).toHaveLength(1);

      const updatedScratch = [
        createScratch('scratch-1', 'Terminal 1', 0),
        createScratch('scratch-2', 'Terminal 2', 1),
      ];

      rerender({
        scratchTerminals: updatedScratch,
        scratchCwds: new Map<string, string>(),
        projects: [] as Project[],
        homeDir: '/home/user',
      });

      expect(result.current.sessions).toHaveLength(2);
    });

    it('updates sessions when projects change', () => {
      const { result, rerender } = renderHook(
        (props) => useSessions(props),
        {
          initialProps: {
            scratchTerminals: [] as ScratchTerminal[],
            scratchCwds: new Map<string, string>(),
            projects: [] as Project[],
            homeDir: '/home/user',
          },
        }
      );

      expect(result.current.sessions).toHaveLength(0);

      const newProject = createProject('proj-1', 'Project', '/proj');

      rerender({
        scratchTerminals: [] as ScratchTerminal[],
        scratchCwds: new Map<string, string>(),
        projects: [newProject],
        homeDir: '/home/user',
      });

      expect(result.current.sessions).toHaveLength(1);
      expect(result.current.sessions[0].kind).toBe('project');
    });

    it('updates session path when scratchCwds change', () => {
      const scratchTerminals = [createScratch('scratch-1', 'Terminal 1', 0)];

      const { result, rerender } = renderHook(
        (props) => useSessions(props),
        {
          initialProps: {
            scratchTerminals,
            scratchCwds: new Map<string, string>(),
            projects: [] as Project[],
            homeDir: '/home/user',
          },
        }
      );

      expect(result.current.sessions[0].path).toBe('/home/user');

      rerender({
        scratchTerminals,
        scratchCwds: new Map([['scratch-1', '/new/path']]),
        projects: [] as Project[],
        homeDir: '/home/user',
      });

      expect(result.current.sessions[0].path).toBe('/new/path');
    });
  });

  describe('previousSessionId management', () => {
    it('does not update previousSessionId when setting same session', () => {
      const scratchTerminals = [createScratch('scratch-1', 'Terminal 1', 0)];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.setActiveSession('scratch-1');
      });

      expect(result.current.previousSessionId).toBeNull();

      act(() => {
        result.current.setActiveSession('scratch-1');
      });

      // Setting same session shouldn't change previousSessionId
      expect(result.current.previousSessionId).toBeNull();
    });

    it('can manually set previousSessionId', () => {
      const scratchTerminals = [createScratch('scratch-1', 'Terminal 1', 0)];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals,
          scratchCwds: new Map(),
          projects: [],
          homeDir: '/home/user',
        })
      );

      act(() => {
        result.current.setPreviousSessionId('scratch-1');
      });

      expect(result.current.previousSessionId).toBe('scratch-1');
    });
  });

  describe('multiple projects and worktrees', () => {
    it('maintains correct order across multiple projects', () => {
      const projects = [
        createProject('proj-1', 'Project 1', '/proj1', [
          { id: 'wt-1', name: 'wt1', path: '/wt1', branch: 'main' },
        ]),
        createProject('proj-2', 'Project 2', '/proj2', [
          { id: 'wt-2', name: 'wt2', path: '/wt2', branch: 'main' },
        ]),
      ];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals: [],
          scratchCwds: new Map(),
          projects,
          homeDir: '/home/user',
        })
      );

      expect(result.current.sessions).toHaveLength(4);
      expect(result.current.sessions.map(s => s.id)).toEqual([
        'proj-1',
        'wt-1',
        'proj-2',
        'wt-2',
      ]);
      expect(result.current.sessions.map(s => s.order)).toEqual([0, 1, 2, 3]);
    });

    it('includes projectId reference for worktrees', () => {
      const projects = [
        createProject('proj-1', 'Project 1', '/proj1', [
          { id: 'wt-1', name: 'wt1', path: '/wt1', branch: 'feature' },
        ]),
      ];

      const { result } = renderHook(() =>
        useSessions({
          scratchTerminals: [],
          scratchCwds: new Map(),
          projects,
          homeDir: '/home/user',
        })
      );

      const worktreeSession = result.current.sessions.find(s => s.id === 'wt-1');
      expect(worktreeSession?.projectId).toBe('proj-1');
      expect(worktreeSession?.branch).toBe('feature');
    });
  });
});

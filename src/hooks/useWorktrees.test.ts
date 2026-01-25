import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, waitFor, act } from '@testing-library/react';
import { useWorktrees } from './useWorktrees';
import {
  resetMocks,
  mockInvokeResponses,
  invokeHistory,
  emitEvent,
  createTestProject,
  createTestWorktree,
} from '../test/setup';

describe('useWorktrees', () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe('loading projects', () => {
    it('loads projects on mount', async () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'project-one' }),
        createTestProject({ id: 'proj-2', name: 'project-two' }),
      ];
      mockInvokeResponses.set('list_projects', projects);

      const { result } = renderHook(() => useWorktrees());

      // Initially loading
      expect(result.current.loading).toBe(true);

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.projects).toHaveLength(2);
      expect(result.current.projects[0].name).toBe('project-one');
      expect(result.current.projects[1].name).toBe('project-two');
    });

    it('handles errors when loading fails', async () => {
      mockInvokeResponses.set('list_projects', () => {
        throw new Error('Network error');
      });

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.error).toBe('Network error');
      expect(result.current.projects).toHaveLength(0);
    });

    it('returns projects with their worktrees', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-branch' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.projects[0].worktrees).toHaveLength(1);
      expect(result.current.projects[0].worktrees[0].name).toBe('feature-branch');
    });
  });

  describe('addProject', () => {
    it('adds a new project', async () => {
      mockInvokeResponses.set('list_projects', []);
      const newProject = createTestProject({ id: 'proj-new', name: 'new-project' });
      mockInvokeResponses.set('add_project', newProject);

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        const project = await result.current.addProject('/path/to/new-project');
        expect(project.name).toBe('new-project');
      });

      // Should invoke add_project command
      expect(invokeHistory.some((h) => h.command === 'add_project')).toBe(true);

      // Project should be added to list
      expect(result.current.projects).toHaveLength(1);
    });

    it('throws error when adding project fails', async () => {
      mockInvokeResponses.set('list_projects', []);
      mockInvokeResponses.set('add_project', () => {
        throw new Error('Invalid git repository');
      });

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.addProject('/invalid/path');
        })
      ).rejects.toThrow('Invalid git repository');
    });
  });

  describe('closeProject', () => {
    it('closes a project and refreshes the list', async () => {
      const project = createTestProject({ id: 'proj-1', name: 'to-close' });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('close_project', null);

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.projects).toHaveLength(1);
      });

      // After close, return empty list
      mockInvokeResponses.set('list_projects', []);

      await act(async () => {
        await result.current.closeProject('proj-1');
      });

      expect(invokeHistory.some((h) => h.command === 'close_project')).toBe(true);

      await waitFor(() => {
        expect(result.current.projects).toHaveLength(0);
      });
    });
  });

  describe('createWorktree', () => {
    it('creates a worktree and refreshes projects', async () => {
      const project = createTestProject({ id: 'proj-1', name: 'my-project' });
      mockInvokeResponses.set('list_projects', [project]);

      const newWorktree = createTestWorktree({ id: 'wt-new', name: 'new-feature' });
      mockInvokeResponses.set('create_worktree', newWorktree);

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // Update list_projects to return project with new worktree
      mockInvokeResponses.set('list_projects', [{ ...project, worktrees: [newWorktree] }]);

      let createdWorktree;
      await act(async () => {
        createdWorktree = await result.current.createWorktree(project.path);
      });

      expect(createdWorktree).toEqual(newWorktree);
      expect(invokeHistory.some((h) => h.command === 'create_worktree')).toBe(true);

      // Projects should be refreshed with new worktree
      await waitFor(() => {
        expect(result.current.projects[0].worktrees).toHaveLength(1);
      });
    });

    it('creates worktree with custom name', async () => {
      const project = createTestProject({ id: 'proj-1', name: 'my-project' });
      mockInvokeResponses.set('list_projects', [project]);

      const newWorktree = createTestWorktree({ id: 'wt-custom', name: 'custom-name' });
      mockInvokeResponses.set('create_worktree', newWorktree);

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await act(async () => {
        await result.current.createWorktree(project.path, 'custom-name');
      });

      // Verify the name was passed
      const createCall = invokeHistory.find((h) => h.command === 'create_worktree');
      expect(createCall?.args).toEqual({ projectPath: project.path, name: 'custom-name' });
    });

    it('throws when worktree creation fails', async () => {
      const project = createTestProject({ id: 'proj-1' });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('create_worktree', () => {
        throw new Error('uncommitted changes');
      });

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      await expect(
        act(async () => {
          await result.current.createWorktree(project.path);
        })
      ).rejects.toThrow('uncommitted changes');
    });
  });

  describe('deleteWorktree', () => {
    it('deletes a worktree and refreshes', async () => {
      const worktree = createTestWorktree({ id: 'wt-1' });
      const project = createTestProject({ id: 'proj-1', worktrees: [worktree] });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('delete_worktree', null);

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.projects[0].worktrees).toHaveLength(1);
      });

      // After delete, return project without worktree
      mockInvokeResponses.set('list_projects', [{ ...project, worktrees: [] }]);

      await act(async () => {
        await result.current.deleteWorktree('wt-1');
      });

      expect(invokeHistory.some((h) => h.command === 'delete_worktree')).toBe(true);

      await waitFor(() => {
        expect(result.current.projects[0].worktrees).toHaveLength(0);
      });
    });
  });

  describe('renameWorktree', () => {
    it('renames a worktree and refreshes', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'old-name' });
      const project = createTestProject({ id: 'proj-1', worktrees: [worktree] });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('rename_worktree', null);

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // After rename, return updated worktree
      mockInvokeResponses.set('list_projects', [
        { ...project, worktrees: [{ ...worktree, name: 'new-name' }] },
      ]);

      await act(async () => {
        await result.current.renameWorktree('wt-1', 'new-name');
      });

      const renameCall = invokeHistory.find((h) => h.command === 'rename_worktree');
      expect(renameCall?.args).toEqual({ worktreeId: 'wt-1', newName: 'new-name' });

      await waitFor(() => {
        expect(result.current.projects[0].worktrees[0].name).toBe('new-name');
      });
    });
  });

  describe('reordering', () => {
    it('reorders projects optimistically', async () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'first' }),
        createTestProject({ id: 'proj-2', name: 'second' }),
        createTestProject({ id: 'proj-3', name: 'third' }),
      ];
      mockInvokeResponses.set('list_projects', projects);

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.projects).toHaveLength(3);
      });

      // Reorder: move third to first
      act(() => {
        result.current.reorderProjectsOptimistic(['proj-3', 'proj-1', 'proj-2']);
      });

      expect(result.current.projects[0].id).toBe('proj-3');
      expect(result.current.projects[1].id).toBe('proj-1');
      expect(result.current.projects[2].id).toBe('proj-2');
    });

    it('reorders worktrees within a project optimistically', async () => {
      const worktrees = [
        createTestWorktree({ id: 'wt-1', name: 'first' }),
        createTestWorktree({ id: 'wt-2', name: 'second' }),
      ];
      const project = createTestProject({ id: 'proj-1', worktrees });
      mockInvokeResponses.set('list_projects', [project]);

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.projects[0].worktrees).toHaveLength(2);
      });

      // Reorder worktrees
      act(() => {
        result.current.reorderWorktreesOptimistic('proj-1', ['wt-2', 'wt-1']);
      });

      expect(result.current.projects[0].worktrees[0].id).toBe('wt-2');
      expect(result.current.projects[0].worktrees[1].id).toBe('wt-1');
    });
  });

  describe('refresh', () => {
    it('manually refreshes projects', async () => {
      mockInvokeResponses.set('list_projects', []);

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.projects).toHaveLength(0);

      // Add a project via mock and refresh
      const newProject = createTestProject({ id: 'proj-new' });
      mockInvokeResponses.set('list_projects', [newProject]);

      await act(async () => {
        await result.current.refresh();
      });

      expect(result.current.projects).toHaveLength(1);
    });
  });

  describe('event handling', () => {
    it('removes stale worktree when worktree-removed event is received', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', path: '/path/to/worktree' });
      const project = createTestProject({ id: 'proj-1', worktrees: [worktree] });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('remove_stale_worktree', null);

      const { result } = renderHook(() => useWorktrees());

      await waitFor(() => {
        expect(result.current.projects[0].worktrees).toHaveLength(1);
      });

      // Update mock for after removal
      mockInvokeResponses.set('list_projects', [{ ...project, worktrees: [] }]);

      // Emit worktree-removed event
      await act(async () => {
        emitEvent('worktree-removed', { worktree_path: '/path/to/worktree' });
        // Give time for async operations
        await new Promise((r) => setTimeout(r, 100));
      });

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'remove_stale_worktree')).toBe(true);
      });
    });
  });
});

import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { Project, Worktree } from '../types';

interface WorktreeRemoved {
  worktree_path: string;
}

interface LoadProjectsOptions {
  syncFromGit?: boolean;
}

export function useWorktrees() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadInFlightRef = useRef<Promise<void> | null>(null);
  const queuedSyncRef = useRef(false);

  const runLoadProjects = useCallback(async (syncFromGit: boolean) => {
    try {
      setLoading(true);
      const result = await invoke<Project[]>('list_projects', { syncFromGit });
      setProjects(result);
      setError(null);
    } catch (err) {
      console.error('Failed to load projects:', err);
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  const loadProjects = useCallback(async (options: LoadProjectsOptions = {}) => {
    const { syncFromGit = false } = options;

    if (syncFromGit) {
      queuedSyncRef.current = true;
    }

    if (loadInFlightRef.current) {
      await loadInFlightRef.current;
      return;
    }

    const execute = async () => {
      let shouldSync = queuedSyncRef.current;
      queuedSyncRef.current = false;

      await runLoadProjects(shouldSync);

      while (queuedSyncRef.current) {
        shouldSync = queuedSyncRef.current;
        queuedSyncRef.current = false;
        await runLoadProjects(shouldSync);
      }
    };

    loadInFlightRef.current = execute();
    try {
      await loadInFlightRef.current;
    } finally {
      loadInFlightRef.current = null;
    }
  }, [runLoadProjects]);

  useEffect(() => {
    void loadProjects({ syncFromGit: true });
  }, [loadProjects]);

  // Listen for worktree-removed events (when worktree folder is deleted externally)
  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    listen<WorktreeRemoved>('worktree-removed', async (event) => {
      console.log('[useWorktrees] Worktree folder removed:', event.payload.worktree_path);

      // Remove the stale worktree from backend state
      try {
        await invoke('remove_stale_worktree', {
          worktreePath: event.payload.worktree_path,
        });
        // Refresh projects to update UI
        await loadProjects({ syncFromGit: false });
      } catch (err) {
        console.error('[useWorktrees] Failed to remove stale worktree:', err);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [loadProjects]);

  const addProject = useCallback(async (path: string) => {
    try {
      const project = await invoke<Project>('add_project', { path });
      setProjects((prev) => [...prev, project]);
      return project;
    } catch (err) {
      console.error('Failed to add project:', err);
      throw err;
    }
  }, []);

  const createWorktree = useCallback(
    async (projectPath: string, name?: string) => {
      console.log('[useWorktrees.createWorktree] Called with path:', projectPath);
      try {
        const worktree = await invoke<Worktree>('create_worktree', {
          projectPath,
          name,
        });
        console.log('[useWorktrees.createWorktree] Success:', worktree.name);
        // Reload projects to get updated worktree list
        await loadProjects({ syncFromGit: false });
        return worktree;
      } catch (err) {
        console.error('[useWorktrees.createWorktree] Failed:', err);
        throw err;
      }
    },
    [loadProjects]
  );

  const deleteWorktree = useCallback(
    async (worktreeId: string) => {
      try {
        await invoke('delete_worktree', { worktreeId });
        await loadProjects({ syncFromGit: false });
      } catch (err) {
        console.error('Failed to delete worktree:', err);
        throw err;
      }
    },
    [loadProjects]
  );

  const renameWorktree = useCallback(
    async (worktreeId: string, newName: string) => {
      try {
        await invoke('rename_worktree', { worktreeId, newName });
        await loadProjects({ syncFromGit: false });
      } catch (err) {
        console.error('Failed to rename worktree:', err);
        throw err;
      }
    },
    [loadProjects]
  );

  const hideProject = useCallback(
    async (projectId: string) => {
      try {
        await invoke('hide_project', { projectId });
        // Optimistic update: only change the specific project's isActive flag
        // This preserves object identity for other projects, preventing unnecessary remounts
        setProjects((prev) =>
          prev.map((project) =>
            project.id === projectId ? { ...project, isActive: false } : project
          )
        );
      } catch (err) {
        console.error('Failed to hide project:', err);
        // On error, reload to get correct state
        await loadProjects({ syncFromGit: false });
        throw err;
      }
    },
    [loadProjects]
  );

  // Optimistic activate: mirrors what touch_project does on backend (sets isActive = true)
  const activateProject = useCallback((projectId: string) => {
    setProjects((prev) =>
      prev.map((project) =>
        project.id === projectId ? { ...project, isActive: true } : project
      )
    );
  }, []);

  // Optimistic reorder: update local state immediately for smooth DnD
  // Takes an array of project IDs in the new order
  const reorderProjectsOptimistic = useCallback((newOrder: string[]) => {
    setProjects((prev) => {
      // Build the new order from the ID array
      const orderMap = new Map(newOrder.map((id, idx) => [id, idx]));
      return [...prev].sort((a, b) => {
        const aIdx = orderMap.get(a.id) ?? Infinity;
        const bIdx = orderMap.get(b.id) ?? Infinity;
        return aIdx - bIdx;
      });
    });
  }, []);

  // Optimistic reorder worktrees within a project
  const reorderWorktreesOptimistic = useCallback((projectId: string, newOrder: string[]) => {
    setProjects((prev) =>
      prev.map((project) => {
        if (project.id !== projectId) return project;
        const orderMap = new Map(newOrder.map((id, idx) => [id, idx]));
        const sortedWorktrees = [...project.worktrees].sort((a, b) => {
          const aIdx = orderMap.get(a.id) ?? Infinity;
          const bIdx = orderMap.get(b.id) ?? Infinity;
          return aIdx - bIdx;
        });
        return { ...project, worktrees: sortedWorktrees };
      })
    );
  }, []);


  const refresh = useCallback((options: LoadProjectsOptions = {}) => {
    return loadProjects(options);
  }, [loadProjects]);

  return {
    projects,
    loading,
    error,
    addProject,
    hideProject,
    activateProject,
    createWorktree,
    deleteWorktree,
    renameWorktree,
    reorderProjectsOptimistic,
    reorderWorktreesOptimistic,
    refresh,
  };
}

import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Project, Worktree } from '../types';

export function useWorktrees() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const loadProjects = useCallback(async () => {
    try {
      setLoading(true);
      const result = await invoke<Project[]>('list_projects');
      setProjects(result);
      setError(null);
    } catch (err) {
      console.error('Failed to load projects:', err);
      setError(err instanceof Error ? err.message : 'Failed to load projects');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadProjects();
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
        await loadProjects();
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
        await loadProjects();
      } catch (err) {
        console.error('Failed to delete worktree:', err);
        throw err;
      }
    },
    [loadProjects]
  );

  const removeProject = useCallback(
    async (projectId: string) => {
      try {
        await invoke('remove_project', { projectId });
        await loadProjects();
      } catch (err) {
        console.error('Failed to remove project:', err);
        throw err;
      }
    },
    [loadProjects]
  );

  return {
    projects,
    loading,
    error,
    addProject,
    removeProject,
    createWorktree,
    deleteWorktree,
    refresh: loadProjects,
  };
}

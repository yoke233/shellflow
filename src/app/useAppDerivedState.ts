import { useCallback, useMemo } from 'react';
import type { Project, ScratchTerminal, Worktree, RunningTask } from '../types';

type EntityOrderEntry = { type: 'scratch' | 'project' | 'worktree'; id: string };

type GitStatusTarget = Worktree | { id: string; path: string } | null;

interface UseAppDerivedStateArgs {
  projects: Project[];
  activeWorktreeId: string | null;
  activeProjectId: string | null;
  scratchTerminals: ScratchTerminal[];
  openProjectIds: Set<string>;
  openWorktreeIds: Set<string>;
  runningTasks: Map<string, RunningTask[]>;
}

interface AppDerivedState {
  activeWorktree: Worktree | null;
  activeProject: Project | null;
  getEntityDirectory: (entityId: string) => string | undefined;
  gitStatusTarget: GitStatusTarget;
  openEntitiesInOrder: EntityOrderEntry[];
  navigableEntitiesInOrder: EntityOrderEntry[];
  runningTaskCounts: Map<string, number>;
}

export function useAppDerivedState({
  projects,
  activeWorktreeId,
  activeProjectId,
  scratchTerminals,
  openProjectIds,
  openWorktreeIds,
  runningTasks,
}: UseAppDerivedStateArgs): AppDerivedState {
  const activeWorktree = useMemo(() => {
    if (!activeWorktreeId) return null;
    for (const project of projects) {
      const worktree = project.worktrees.find(w => w.id === activeWorktreeId);
      if (worktree) return worktree;
    }
    return null;
  }, [activeWorktreeId, projects]);

  const activeProject = useMemo(() => {
    if (!activeProjectId) return null;
    return projects.find(p => p.id === activeProjectId) ?? null;
  }, [activeProjectId, projects]);

  const getEntityDirectory = useCallback((entityId: string): string | undefined => {
    for (const project of projects) {
      const worktree = project.worktrees.find(w => w.id === entityId);
      if (worktree) return worktree.path;
    }
    const project = projects.find(p => p.id === entityId);
    if (project) return project.path;
    return undefined;
  }, [projects]);

  const gitStatusTarget = useMemo(() => {
    if (activeWorktree) return activeWorktree;
    if (activeProject) return { id: activeProject.id, path: activeProject.path };
    return null;
  }, [activeWorktree, activeProject]);

  const openEntitiesInOrder = useMemo(() => {
    const scratchIds = scratchTerminals.map(s => ({ type: 'scratch' as const, id: s.id }));
    const projectAndWorktreeIds: Array<{ type: 'project' | 'worktree'; id: string }> = [];
    for (const project of projects) {
      if (openProjectIds.has(project.id)) {
        projectAndWorktreeIds.push({ type: 'project' as const, id: project.id });
      }
      for (const worktree of project.worktrees) {
        if (openWorktreeIds.has(worktree.id)) {
          projectAndWorktreeIds.push({ type: 'worktree' as const, id: worktree.id });
        }
      }
    }

    return [...scratchIds, ...projectAndWorktreeIds];
  }, [scratchTerminals, projects, openProjectIds, openWorktreeIds]);

  const navigableEntitiesInOrder = useMemo(() => {
    const scratchIds = scratchTerminals.map(s => ({ type: 'scratch' as const, id: s.id }));
    const projectAndWorktreeIds: Array<{ type: 'project' | 'worktree'; id: string }> = [];
    for (const project of projects) {
      if (!project.isActive) continue;
      projectAndWorktreeIds.push({ type: 'project' as const, id: project.id });
      for (const worktree of project.worktrees) {
        projectAndWorktreeIds.push({ type: 'worktree' as const, id: worktree.id });
      }
    }

    return [...scratchIds, ...projectAndWorktreeIds];
  }, [scratchTerminals, projects]);

  const runningTaskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [worktreeId, tasks] of runningTasks.entries()) {
      const runningCount = tasks.filter(t => t.status === 'running').length;
      if (runningCount > 0) {
        counts.set(worktreeId, runningCount);
      }
    }
    return counts;
  }, [runningTasks]);

  return {
    activeWorktree,
    activeProject,
    getEntityDirectory,
    gitStatusTarget,
    openEntitiesInOrder,
    navigableEntitiesInOrder,
    runningTaskCounts,
  };
}

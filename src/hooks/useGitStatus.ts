import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { FileChange, FilesChanged, Worktree, ChangedFilesViewMode, BranchInfo } from '../types';

// Can be a worktree or a project (both have id and path)
type GitStatusTarget = { id: string; path: string } | null;

interface UseGitStatusOptions {
  mode?: ChangedFilesViewMode;
  projectPath?: string;
}

// Check if error indicates path is not a git repository
function isNotGitRepoError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    // Check for error code
    if ('code' in err && err.code === 'NOT_GIT_REPO') {
      return true;
    }
    // Check for error message containing common git2 error patterns
    if ('message' in err && typeof err.message === 'string') {
      const msg = err.message.toLowerCase();
      return msg.includes('not a git repository') || msg.includes('could not find repository');
    }
    // Check if it's a string that contains the pattern
    const errStr = String(err).toLowerCase();
    return errStr.includes('not a git repository') || errStr.includes('could not find repository');
  }
  return false;
}

export function useGitStatus(
  target: GitStatusTarget,
  options: UseGitStatusOptions = {}
) {
  const { mode = 'uncommitted', projectPath } = options;
  // For backwards compatibility, also accept Worktree type
  const worktree = target as (Worktree | { id: string; path: string } | null);
  const worktreeId = worktree?.id ?? null;
  const worktreePath = worktree?.path ?? null;
  const [files, setFiles] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(false);
  const [isGitRepo, setIsGitRepo] = useState(true);
  const [branchInfo, setBranchInfo] = useState<BranchInfo | null>(null);
  const watchingRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!worktreeId || !worktreePath) {
      setFiles([]);
      return;
    }

    try {
      setLoading(true);

      if (mode === 'uncommitted') {
        // Fetch uncommitted changes (working tree vs HEAD)
        const result = await invoke<FileChange[]>('get_changed_files', {
          worktreePath,
        });
        setFiles(result);
      } else {
        // Fetch branch changes (current branch vs base branch)
        const result = await invoke<FileChange[]>('get_branch_changed_files', {
          worktreePath,
          projectPath,
        });
        setFiles(result);
      }
      setIsGitRepo(true);
    } catch (err) {
      console.error('Failed to get changed files:', err);
      setFiles([]);
      // Only set isGitRepo to false for specific "not a git repo" errors
      if (isNotGitRepoError(err)) {
        setIsGitRepo(false);
      }
    } finally {
      setLoading(false);
    }
  }, [worktreeId, worktreePath, mode, projectPath]);

  // Fetch branch info when target changes
  useEffect(() => {
    if (!worktreeId || !worktreePath) {
      setBranchInfo(null);
      return;
    }

    invoke<BranchInfo>('get_branch_info', {
      worktreePath,
      projectPath,
    })
      .then(setBranchInfo)
      .catch((err) => {
        console.error('Failed to get branch info:', err);
        setBranchInfo(null);
      });
  }, [worktreeId, worktreePath, projectPath]);

  // Initial load and start watcher
  // IMPORTANT: We register the event listener BEFORE starting the watcher to avoid
  // a race condition where events could be emitted before the listener is ready.
  useEffect(() => {
    if (!worktreeId || !worktreePath) {
      setFiles([]);
      setIsGitRepo(true); // Reset when no target
      return;
    }

    // Reset isGitRepo when target changes
    setIsGitRepo(true);

    let cancelled = false;
    let unlistenFn: UnlistenFn | null = null;

    const setup = async () => {
      // In uncommitted mode, register listener FIRST, then start watcher
      if (mode === 'uncommitted') {
        // Register the event listener before starting the watcher
        unlistenFn = await listen<FilesChanged>('files-changed', (event) => {
          // Only update if this is for our worktree and effect hasn't been cancelled
          if (!cancelled && event.payload.worktree_path === worktreePath) {
            setFiles(event.payload.files);
          }
        });

        // If cancelled during listener setup, clean up immediately
        if (cancelled) {
          unlistenFn();
          return;
        }

        // Now start the watcher (listener is already ready to receive events)
        if (watchingRef.current !== worktreeId) {
          // Stop previous watcher if any
          if (watchingRef.current) {
            await invoke('stop_watching', { worktreeId: watchingRef.current }).catch(() => {});
          }
          watchingRef.current = worktreeId;
          await invoke('start_watching', {
            worktreeId: worktreeId,
            worktreePath: worktreePath,
          }).catch((err) => console.error('Failed to start watching:', err));
        }
      } else if (mode === 'branch' && watchingRef.current) {
        // Stop watching when in branch mode
        await invoke('stop_watching', { worktreeId: watchingRef.current }).catch(() => {});
        watchingRef.current = null;
      }

      // Fetch initial data after listener is set up
      if (!cancelled) {
        refresh();
      }
    };

    setup();

    // Cleanup on unmount or deps change
    return () => {
      cancelled = true;
      if (unlistenFn) {
        unlistenFn();
      }
      if (watchingRef.current) {
        invoke('stop_watching', { worktreeId: watchingRef.current }).catch(() => {});
        watchingRef.current = null;
      }
    };
  }, [worktreeId, worktreePath, refresh, mode]);

  return {
    files,
    loading,
    refresh,
    isGitRepo,
    branchInfo,
  };
}

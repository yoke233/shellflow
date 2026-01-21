import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { FileChange, FilesChanged, Worktree } from '../types';

// Can be a worktree or a project (both have id and path)
type GitStatusTarget = { id: string; path: string } | null;

export function useGitStatus(target: GitStatusTarget) {
  // For backwards compatibility, also accept Worktree type
  const worktree = target as (Worktree | { id: string; path: string } | null);
  const [files, setFiles] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(false);
  const watchingRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!worktree) {
      setFiles([]);
      return;
    }

    try {
      setLoading(true);
      const result = await invoke<FileChange[]>('get_changed_files', {
        worktreePath: worktree.path,
      });
      setFiles(result);
    } catch (err) {
      console.error('Failed to get changed files:', err);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [worktree]);

  // Initial load and start watcher
  useEffect(() => {
    if (!worktree) {
      setFiles([]);
      return;
    }

    refresh();

    // Start watching if not already watching this worktree
    if (watchingRef.current !== worktree.id) {
      // Stop previous watcher if any
      if (watchingRef.current) {
        invoke('stop_watching', { worktreeId: watchingRef.current }).catch(() => {});
      }
      watchingRef.current = worktree.id;
      invoke('start_watching', {
        worktreeId: worktree.id,
        worktreePath: worktree.path,
      }).catch((err) => console.error('Failed to start watching:', err));
    }

    // Cleanup on unmount
    return () => {
      if (watchingRef.current) {
        invoke('stop_watching', { worktreeId: watchingRef.current }).catch(() => {});
        watchingRef.current = null;
      }
    };
  }, [worktree, refresh]);

  // Listen for file change events
  useEffect(() => {
    if (!worktree) return;

    let unlisten: UnlistenFn | null = null;

    listen<FilesChanged>('files-changed', (event) => {
      // Only update if this is for our worktree
      if (event.payload.worktree_path === worktree.path) {
        setFiles(event.payload.files);
      }
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      if (unlisten) {
        unlisten();
      }
    };
  }, [worktree]);

  return {
    files,
    loading,
    refresh,
  };
}

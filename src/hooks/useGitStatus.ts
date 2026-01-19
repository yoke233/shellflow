import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { FileChange, FilesChanged, Workspace } from '../types';

export function useGitStatus(workspace: Workspace | null) {
  const [files, setFiles] = useState<FileChange[]>([]);
  const [loading, setLoading] = useState(false);
  const watchingRef = useRef<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspace) {
      setFiles([]);
      return;
    }

    try {
      setLoading(true);
      const result = await invoke<FileChange[]>('get_changed_files', {
        workspacePath: workspace.path,
      });
      setFiles(result);
    } catch (err) {
      console.error('Failed to get changed files:', err);
      setFiles([]);
    } finally {
      setLoading(false);
    }
  }, [workspace]);

  // Initial load and start watcher
  useEffect(() => {
    if (!workspace) {
      setFiles([]);
      return;
    }

    refresh();

    // Start watching if not already watching this workspace
    if (watchingRef.current !== workspace.id) {
      // Stop previous watcher if any
      if (watchingRef.current) {
        invoke('stop_watching', { workspaceId: watchingRef.current }).catch(() => {});
      }
      watchingRef.current = workspace.id;
      invoke('start_watching', {
        workspaceId: workspace.id,
        workspacePath: workspace.path,
      }).catch((err) => console.error('Failed to start watching:', err));
    }

    // Cleanup on unmount
    return () => {
      if (watchingRef.current) {
        invoke('stop_watching', { workspaceId: watchingRef.current }).catch(() => {});
        watchingRef.current = null;
      }
    };
  }, [workspace, refresh]);

  // Listen for file change events
  useEffect(() => {
    if (!workspace) return;

    let unlisten: UnlistenFn | null = null;

    listen<FilesChanged>('files-changed', (event) => {
      // Only update if this is for our workspace
      if (event.payload.workspace_path === workspace.path) {
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
  }, [workspace]);

  return {
    files,
    loading,
    refresh,
  };
}

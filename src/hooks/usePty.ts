import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { PtyOutput } from '../types';

type PtyType = 'main' | 'shell' | 'project' | 'scratch';

export function usePty(onOutput?: (data: string) => void) {
  const [ptyId, setPtyId] = useState<string | null>(null);
  // Use ref for immediate access to ptyId (avoids React state timing issues)
  const ptyIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const onOutputRef = useRef(onOutput);

  // Keep the callback ref updated
  useEffect(() => {
    onOutputRef.current = onOutput;
  }, [onOutput]);

  // Clean up listener on unmount
  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
      }
    };
  }, []);

  const spawn = useCallback(async (worktreeId: string, type: PtyType, cols?: number, rows?: number) => {
    try {
      // Clean up any existing listener
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      // Set up listener BEFORE spawning so we don't miss early output (like DA1 queries)
      // We'll filter by id once we know it
      let pendingId: string | null = null;
      const earlyEvents: PtyOutput[] = [];

      const unlisten = await listen<PtyOutput>('pty-output', (event) => {
        if (pendingId === null) {
          // Buffer events until we know the id
          earlyEvents.push(event.payload);
        } else if (event.payload.pty_id === pendingId) {
          onOutputRef.current?.(event.payload.data);
        }
      });

      // Now spawn the PTY
      // Different types use different backend commands
      let command: string;
      let params: Record<string, unknown>;
      if (type === 'main') {
        command = 'spawn_main';
        params = { worktreeId, cols, rows };
      } else if (type === 'project') {
        command = 'spawn_project_shell';
        params = { projectId: worktreeId, cols, rows };
      } else if (type === 'scratch') {
        command = 'spawn_scratch_terminal';
        params = { scratchId: worktreeId, cols, rows };
      } else {
        command = 'spawn_terminal';
        params = { worktreeId, cols, rows };
      }
      const id = await invoke<string>(command, params);

      // Set ref immediately for synchronous access
      ptyIdRef.current = id;
      setPtyId(id);
      pendingId = id;
      unlistenRef.current = unlisten;

      // Process any buffered events
      for (const event of earlyEvents) {
        if (event.pty_id === id) {
          onOutputRef.current?.(event.data);
        }
      }

      return id;
    } catch (error) {
      console.error('Failed to spawn PTY:', error);
      throw error;
    }
  }, []);

  // Use ref for ptyId to avoid timing issues with DA1 query responses
  const write = useCallback(async (data: string) => {
    const id = ptyIdRef.current;
    if (!id) return;
    try {
      await invoke('pty_write', { ptyId: id, data });
    } catch (error) {
      console.error('Failed to write to PTY:', error);
    }
  }, []);

  const resize = useCallback(async (cols: number, rows: number) => {
    const id = ptyIdRef.current;
    if (!id) return;
    try {
      await invoke('pty_resize', { ptyId: id, cols, rows });
    } catch (error) {
      console.error('Failed to resize PTY:', error);
    }
  }, []);

  const kill = useCallback(async () => {
    const id = ptyIdRef.current;
    if (!id) return;
    try {
      await invoke('pty_kill', { ptyId: id });
      ptyIdRef.current = null;
      setPtyId(null);
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
    } catch (error) {
      console.error('Failed to kill PTY:', error);
    }
  }, []);

  return {
    ptyId,
    spawn,
    write,
    resize,
    kill,
  };
}

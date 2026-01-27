import { useState, useEffect, useCallback, useRef } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';
import { PtyOutput } from '../types';

type PtyType = 'main' | 'shell' | 'worktree' | 'project' | 'scratch';

export function usePty(onOutput?: (data: string) => void, onReady?: () => void) {
  const [ptyId, setPtyId] = useState<string | null>(null);
  // Use ref for immediate access to ptyId (avoids React state timing issues)
  const ptyIdRef = useRef<string | null>(null);
  const unlistenRef = useRef<UnlistenFn | null>(null);
  const unlistenReadyRef = useRef<UnlistenFn | null>(null);
  const onOutputRef = useRef(onOutput);
  const onReadyRef = useRef(onReady);

  // Keep the ready callback ref updated
  useEffect(() => {
    onReadyRef.current = onReady;
  }, [onReady]);

  // Keep the callback ref updated
  useEffect(() => {
    onOutputRef.current = onOutput;
  }, [onOutput]);

  // Clean up listeners on unmount
  useEffect(() => {
    return () => {
      if (unlistenRef.current) {
        unlistenRef.current();
      }
      if (unlistenReadyRef.current) {
        unlistenReadyRef.current();
      }
    };
  }, []);

  const spawn = useCallback(async (worktreeId: string, type: PtyType, cols?: number, rows?: number, directory?: string) => {
    try {
      // Clean up any existing listeners
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }
      if (unlistenReadyRef.current) {
        unlistenReadyRef.current();
        unlistenReadyRef.current = null;
      }

      // Set up listeners BEFORE spawning so we don't miss early events
      // We'll filter by id once we know it
      let pendingId: string | null = null;
      const earlyEvents: PtyOutput[] = [];
      let earlyReadyReceived = false;
      let earlyReadyPtyId: string | null = null;

      const unlisten = await listen<PtyOutput>('pty-output', (event) => {
        if (pendingId === null) {
          // Buffer events until we know the id
          earlyEvents.push(event.payload);
        } else if (event.payload.pty_id === pendingId) {
          onOutputRef.current?.(event.payload.data);
        }
      });

      // Listen for pty-ready BEFORE spawning to avoid race condition
      const unlistenReady = await listen<{ ptyId: string; worktreeId: string }>('pty-ready', (event) => {
        if (pendingId === null) {
          // Buffer if we don't know our id yet
          earlyReadyReceived = true;
          earlyReadyPtyId = event.payload.ptyId;
        } else if (event.payload.ptyId === pendingId) {
          onReadyRef.current?.();
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
        params = { scratchId: worktreeId, directory, cols, rows };
      } else {
        // 'shell' or 'worktree' - both spawn a terminal in the worktree directory
        command = 'spawn_terminal';
        params = { worktreeId, cols, rows };
      }
      const id = await invoke<string>(command, params);

      // Set ref immediately for synchronous access
      ptyIdRef.current = id;
      setPtyId(id);
      pendingId = id;
      unlistenRef.current = unlisten;
      unlistenReadyRef.current = unlistenReady;

      // Process any buffered events
      for (const event of earlyEvents) {
        if (event.pty_id === id) {
          onOutputRef.current?.(event.data);
        }
      }

      // Process buffered ready event
      if (earlyReadyReceived && earlyReadyPtyId === id) {
        onReadyRef.current?.();
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

  const interrupt = useCallback(async () => {
    const id = ptyIdRef.current;
    if (!id) return;
    try {
      await invoke('pty_interrupt', { ptyId: id });
    } catch (error) {
      console.error('Failed to interrupt PTY:', error);
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
      if (unlistenReadyRef.current) {
        unlistenReadyRef.current();
        unlistenReadyRef.current = null;
      }
    } catch (error) {
      console.error('Failed to kill PTY:', error);
    }
  }, []);

  // Simpler shell spawn that just takes entity ID and optional directory
  const spawnShell = useCallback(async (entityId: string, directory?: string, cols?: number, rows?: number) => {
    try {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      let pendingId: string | null = null;
      const earlyEvents: PtyOutput[] = [];

      const unlisten = await listen<PtyOutput>('pty-output', (event) => {
        if (pendingId === null) {
          earlyEvents.push(event.payload);
        } else if (event.payload.pty_id === pendingId) {
          onOutputRef.current?.(event.payload.data);
        }
      });

      const id = await invoke<string>('spawn_shell', { entityId, directory, cols, rows });

      ptyIdRef.current = id;
      setPtyId(id);
      pendingId = id;
      unlistenRef.current = unlisten;

      for (const event of earlyEvents) {
        if (event.pty_id === id) {
          onOutputRef.current?.(event.data);
        }
      }

      return id;
    } catch (error) {
      console.error('Failed to spawn shell:', error);
      throw error;
    }
  }, []);

  // Spawn a PTY running a specific command (for editors in drawer/tab)
  const spawnCommand = useCallback(async (entityId: string, directory: string, command: string, cols?: number, rows?: number) => {
    try {
      if (unlistenRef.current) {
        unlistenRef.current();
        unlistenRef.current = null;
      }

      let pendingId: string | null = null;
      const earlyEvents: PtyOutput[] = [];

      const unlisten = await listen<PtyOutput>('pty-output', (event) => {
        if (pendingId === null) {
          earlyEvents.push(event.payload);
        } else if (event.payload.pty_id === pendingId) {
          onOutputRef.current?.(event.payload.data);
        }
      });

      const id = await invoke<string>('spawn_command', { entityId, directory, command, cols, rows });

      ptyIdRef.current = id;
      setPtyId(id);
      pendingId = id;
      unlistenRef.current = unlisten;

      for (const event of earlyEvents) {
        if (event.pty_id === id) {
          onOutputRef.current?.(event.data);
        }
      }

      return id;
    } catch (error) {
      console.error('Failed to spawn command:', error);
      throw error;
    }
  }, []);

  return {
    ptyId,
    spawn,
    spawnShell,
    spawnCommand,
    write,
    resize,
    interrupt,
    kill,
  };
}

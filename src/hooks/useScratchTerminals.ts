import { useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { ScratchTerminal } from '../types';

export interface UseScratchTerminalsReturn {
  scratchTerminals: ScratchTerminal[];
  /** Map of tab ID -> cwd (keyed by tab ID, not session ID) */
  scratchCwds: Map<string, string>;
  homeDir: string | null;

  /** Add a new scratch terminal, optionally starting at a specific directory */
  addScratchTerminal: (initialCwd?: string) => ScratchTerminal;
  closeScratchTerminal: (id: string) => void;
  renameScratchTerminal: (id: string, name: string) => void;
  reorderScratchTerminals: (ids: string[]) => void;
  /** Update cwd for a tab (keyed by tab ID) */
  updateScratchCwd: (tabId: string, cwd: string) => void;
  /** Remove cwd entry for a tab (called when tab is closed) */
  removeScratchCwd: (tabId: string) => void;
}

export function useScratchTerminals(): UseScratchTerminalsReturn {
  const [scratchTerminals, setScratchTerminals] = useState<ScratchTerminal[]>([]);
  const [scratchTerminalCounter, setScratchTerminalCounter] = useState(0);
  const [scratchCwds, setScratchCwds] = useState<Map<string, string>>(new Map());
  const [homeDir, setHomeDir] = useState<string | null>(null);

  // Fetch home directory on mount (used for initial scratch terminal cwd)
  useEffect(() => {
    invoke<string>('get_home_dir').then(setHomeDir).catch(() => {});
  }, []);

  // Set initial cwd for any terminals created before homeDir was available
  useEffect(() => {
    if (!homeDir) return;
    setScratchCwds((prev) => {
      let changed = false;
      const next = new Map(prev);
      for (const scratch of scratchTerminals) {
        if (!next.has(scratch.id)) {
          next.set(scratch.id, homeDir);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [homeDir, scratchTerminals]);

  const addScratchTerminal = useCallback((initialCwd?: string) => {
    const newCounter = scratchTerminalCounter + 1;
    const newScratch: ScratchTerminal = {
      id: `scratch-${newCounter}`,
      name: `Terminal ${newCounter}`,
      order: scratchTerminals.length,
      initialCwd,
    };
    setScratchTerminals((prev) => [...prev, newScratch]);
    setScratchTerminalCounter(newCounter);
    // Note: cwd is now tracked per tab ID (set when terminal emits OSC 7),
    // not per session ID, so we don't initialize it here
    return newScratch;
  }, [scratchTerminalCounter, scratchTerminals.length]);

  const closeScratchTerminal = useCallback((scratchId: string) => {
    setScratchTerminals((prev) => prev.filter((s) => s.id !== scratchId));
    // Note: tab cwds are cleaned up by the caller (App.tsx) since they're keyed by tab ID
  }, []);

  const renameScratchTerminal = useCallback((scratchId: string, newName: string) => {
    setScratchTerminals((prev) =>
      prev.map((s) => (s.id === scratchId ? { ...s, name: newName } : s))
    );
  }, []);

  const updateScratchCwd = useCallback((tabId: string, cwd: string) => {
    setScratchCwds((prev) => {
      const next = new Map(prev);
      next.set(tabId, cwd);
      return next;
    });
  }, []);

  const removeScratchCwd = useCallback((tabId: string) => {
    setScratchCwds((prev) => {
      if (!prev.has(tabId)) return prev;
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  const reorderScratchTerminals = useCallback((scratchIds: string[]) => {
    setScratchTerminals((prev) => {
      const scratchMap = new Map(prev.map((s) => [s.id, s]));
      return scratchIds.map((id, index) => ({
        ...scratchMap.get(id)!,
        order: index,
      }));
    });
  }, []);

  return {
    scratchTerminals,
    scratchCwds,
    homeDir,
    addScratchTerminal,
    closeScratchTerminal,
    renameScratchTerminal,
    reorderScratchTerminals,
    updateScratchCwd,
    removeScratchCwd,
  };
}

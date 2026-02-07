import { useState, useCallback, useRef } from 'react';
import { arrayMove } from '@dnd-kit/sortable';
import type { DiffTabConfig } from '../types';

export interface SessionTab {
  id: string;           // e.g., "worktree-abc-session-1"
  label: string;        // e.g., "Terminal 1"
  /** User-defined label override (displayed instead of label when set) */
  customLabel?: string;
  isPrimary: boolean;   // First tab runs configured command
  /** For command tabs: command to run instead of shell/main command */
  command?: string;
  /** For command tabs: directory to run the command in */
  directory?: string;
  /** For diff tabs: diff viewer configuration */
  diff?: DiffTabConfig;
}

export interface UseSessionTabsReturn {
  // State Maps (keyed by sessionId)
  sessionTabs: Map<string, SessionTab[]>;
  sessionActiveTabIds: Map<string, string>;
  sessionTabCounters: Map<string, number>;
  sessionPtyIds: Map<string, string>;  // tabId -> ptyId
  sessionLastActiveTabIds: Map<string, string>;  // sessionId -> tabId (for notification routing)

  // Raw setters (for backward compatibility with existing handlers)
  setSessionTabs: React.Dispatch<React.SetStateAction<Map<string, SessionTab[]>>>;
  setSessionActiveTabIds: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  setSessionTabCounters: React.Dispatch<React.SetStateAction<Map<string, number>>>;
  setSessionPtyIds: React.Dispatch<React.SetStateAction<Map<string, string>>>;
  setSessionLastActiveTabIds: React.Dispatch<React.SetStateAction<Map<string, string>>>;

  // Getters for current session
  getTabsForSession: (sessionId: string | null) => SessionTab[];
  getActiveTabIdForSession: (sessionId: string | null) => string | null;
  getCounterForSession: (sessionId: string | null) => number;
  getLastActiveTabIdForSession: (sessionId: string | null) => string | null;

  // Tab operations
  addTab: (sessionId: string, tab: SessionTab) => void;
  removeTab: (sessionId: string, tabId: string) => string | null; // returns new active tab id or null
  setActiveTab: (sessionId: string, tabId: string) => void;
  reorderTabs: (sessionId: string, oldIndex: number, newIndex: number) => void;
  incrementCounter: (sessionId: string) => number; // returns new counter value

  // PTY ID tracking
  setPtyId: (tabId: string, ptyId: string) => void;
  getPtyId: (tabId: string) => string | undefined;
  removePtyId: (tabId: string) => void;

  // Last active tab tracking (for notification routing)
  setLastActiveTabId: (sessionId: string, tabId: string) => void;

  // Update tab properties
  updateTabLabel: (sessionId: string, tabId: string, label: string) => void;
  updateTab: (sessionId: string, tabId: string, updates: Partial<SessionTab>) => void;

  // Navigation
  prevTab: (sessionId: string) => void;
  nextTab: (sessionId: string) => void;
  selectTabByIndex: (sessionId: string, index: number) => void;

  // Cleanup
  clearSessionTabs: (sessionId: string) => void;
}

export function useSessionTabs(): UseSessionTabsReturn {
  const [sessionTabs, setSessionTabs] = useState<Map<string, SessionTab[]>>(new Map());
  const [sessionActiveTabIds, setSessionActiveTabIds] = useState<Map<string, string>>(new Map());
  const [sessionTabCounters, setSessionTabCounters] = useState<Map<string, number>>(new Map());
  const [sessionPtyIds, setSessionPtyIds] = useState<Map<string, string>>(new Map());
  const [sessionLastActiveTabIds, setSessionLastActiveTabIds] = useState<Map<string, string>>(new Map());

  // Refs to track latest values for synchronous return
  const tabCountersRef = useRef(sessionTabCounters);
  tabCountersRef.current = sessionTabCounters;

  const tabsRef = useRef(sessionTabs);
  tabsRef.current = sessionTabs;

  const activeTabIdsRef = useRef(sessionActiveTabIds);
  activeTabIdsRef.current = sessionActiveTabIds;

  const getTabsForSession = useCallback((sessionId: string | null): SessionTab[] => {
    return sessionId ? sessionTabs.get(sessionId) ?? [] : [];
  }, [sessionTabs]);

  const getActiveTabIdForSession = useCallback((sessionId: string | null): string | null => {
    return sessionId ? sessionActiveTabIds.get(sessionId) ?? null : null;
  }, [sessionActiveTabIds]);

  const getCounterForSession = useCallback((sessionId: string | null): number => {
    return sessionId ? sessionTabCounters.get(sessionId) ?? 0 : 0;
  }, [sessionTabCounters]);

  const getLastActiveTabIdForSession = useCallback((sessionId: string | null): string | null => {
    return sessionId ? sessionLastActiveTabIds.get(sessionId) ?? null : null;
  }, [sessionLastActiveTabIds]);

  const addTab = useCallback((sessionId: string, tab: SessionTab) => {
    setSessionTabs((prev) => {
      const currentTabs = prev.get(sessionId) ?? [];
      const next = new Map(prev);
      next.set(sessionId, [...currentTabs, tab]);
      return next;
    });
    setSessionActiveTabIds((prev) => {
      const next = new Map(prev);
      next.set(sessionId, tab.id);
      return next;
    });
  }, []);

  const removeTab = useCallback((sessionId: string, tabId: string): string | null => {
    // Calculate new active tab synchronously from ref
    const currentTabs = tabsRef.current.get(sessionId) ?? [];
    const currentActiveId = activeTabIdsRef.current.get(sessionId);
    const tabIndex = currentTabs.findIndex(t => t.id === tabId);
    const remaining = currentTabs.filter(t => t.id !== tabId);

    // If removing the active tab, select the previous tab (or next if first)
    let newActiveTabId: string | null = null;
    if (remaining.length > 0) {
      if (currentActiveId === tabId) {
        // Select the tab before the removed one, or the first if removing index 0
        const newIndex = Math.max(0, tabIndex - 1);
        newActiveTabId = remaining[newIndex]?.id ?? remaining[remaining.length - 1].id;
      } else {
        newActiveTabId = currentActiveId ?? remaining[remaining.length - 1].id;
      }
    }

    setSessionTabs((prev) => {
      const currentTabsPrev = prev.get(sessionId) ?? [];
      const remainingPrev = currentTabsPrev.filter(t => t.id !== tabId);
      const next = new Map(prev);
      next.set(sessionId, remainingPrev);
      return next;
    });

    setSessionActiveTabIds((prev) => {
      const currentActiveTabId = prev.get(sessionId);
      if (currentActiveTabId === tabId) {
        const next = new Map(prev);
        if (newActiveTabId) {
          next.set(sessionId, newActiveTabId);
        } else {
          next.delete(sessionId);
        }
        return next;
      }
      return prev;
    });

    return newActiveTabId;
  }, []);

  const setActiveTab = useCallback((sessionId: string, tabId: string) => {
    setSessionActiveTabIds((prev) => {
      if (prev.get(sessionId) === tabId) return prev;
      const next = new Map(prev);
      next.set(sessionId, tabId);
      return next;
    });
  }, []);

  const reorderTabs = useCallback((sessionId: string, oldIndex: number, newIndex: number) => {
    setSessionTabs((prev) => {
      const tabs = prev.get(sessionId);
      if (!tabs) return prev;

      const reordered = arrayMove(tabs, oldIndex, newIndex);
      const next = new Map(prev);
      next.set(sessionId, reordered);
      return next;
    });
  }, []);

  const incrementCounter = useCallback((sessionId: string): number => {
    // Calculate new counter synchronously from ref
    const current = tabCountersRef.current.get(sessionId) ?? 0;
    const newCounter = current + 1;

    setSessionTabCounters((prev) => {
      const currentPrev = prev.get(sessionId) ?? 0;
      const next = new Map(prev);
      next.set(sessionId, currentPrev + 1);
      return next;
    });

    return newCounter;
  }, []);

  const setPtyId = useCallback((tabId: string, ptyId: string) => {
    setSessionPtyIds((prev) => {
      const next = new Map(prev);
      next.set(tabId, ptyId);
      return next;
    });
  }, []);

  const getPtyId = useCallback((tabId: string): string | undefined => {
    return sessionPtyIds.get(tabId);
  }, [sessionPtyIds]);

  const removePtyId = useCallback((tabId: string) => {
    setSessionPtyIds((prev) => {
      if (!prev.has(tabId)) return prev;
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  const setLastActiveTabId = useCallback((sessionId: string, tabId: string) => {
    setSessionLastActiveTabIds((prev) => {
      if (prev.get(sessionId) === tabId) return prev;
      const next = new Map(prev);
      next.set(sessionId, tabId);
      return next;
    });
  }, []);

  const updateTabLabel = useCallback((sessionId: string, tabId: string, label: string) => {
    setSessionTabs((prev) => {
      const tabs = prev.get(sessionId);
      if (!tabs) return prev;
      const tabIndex = tabs.findIndex(t => t.id === tabId);
      if (tabIndex === -1) return prev;
      // Don't update if label is the same
      if (tabs[tabIndex].label === label) return prev;
      const next = new Map(prev);
      const updatedTabs = [...tabs];
      updatedTabs[tabIndex] = { ...tabs[tabIndex], label };
      next.set(sessionId, updatedTabs);
      return next;
    });
  }, []);

  const updateTab = useCallback((sessionId: string, tabId: string, updates: Partial<SessionTab>) => {
    setSessionTabs((prev) => {
      const tabs = prev.get(sessionId);
      if (!tabs) return prev;
      const tabIndex = tabs.findIndex(t => t.id === tabId);
      if (tabIndex === -1) return prev;
      const next = new Map(prev);
      const updatedTabs = [...tabs];
      updatedTabs[tabIndex] = { ...tabs[tabIndex], ...updates };
      next.set(sessionId, updatedTabs);
      return next;
    });
  }, []);

  const prevTab = useCallback((sessionId: string) => {
    const tabs = tabsRef.current.get(sessionId) ?? [];
    const activeId = activeTabIdsRef.current.get(sessionId);
    if (tabs.length <= 1 || !activeId) return;

    const currentIndex = tabs.findIndex(t => t.id === activeId);
    const newIndex = currentIndex <= 0 ? tabs.length - 1 : currentIndex - 1;
    setActiveTab(sessionId, tabs[newIndex].id);
  }, [setActiveTab]);

  const nextTab = useCallback((sessionId: string) => {
    const tabs = tabsRef.current.get(sessionId) ?? [];
    const activeId = activeTabIdsRef.current.get(sessionId);
    if (tabs.length <= 1 || !activeId) return;

    const currentIndex = tabs.findIndex(t => t.id === activeId);
    const newIndex = currentIndex >= tabs.length - 1 ? 0 : currentIndex + 1;
    setActiveTab(sessionId, tabs[newIndex].id);
  }, [setActiveTab]);

  const selectTabByIndex = useCallback((sessionId: string, index: number) => {
    const tabs = tabsRef.current.get(sessionId) ?? [];
    if (index < 0 || index >= tabs.length) return;
    setActiveTab(sessionId, tabs[index].id);
  }, [setActiveTab]);

  const clearSessionTabs = useCallback((sessionId: string) => {
    setSessionTabs((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
    setSessionActiveTabIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
    setSessionTabCounters((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
    setSessionLastActiveTabIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Map(prev);
      next.delete(sessionId);
      return next;
    });
  }, []);

  return {
    sessionTabs,
    sessionActiveTabIds,
    sessionTabCounters,
    sessionPtyIds,
    sessionLastActiveTabIds,
    setSessionTabs,
    setSessionActiveTabIds,
    setSessionTabCounters,
    setSessionPtyIds,
    setSessionLastActiveTabIds,
    getTabsForSession,
    getActiveTabIdForSession,
    getCounterForSession,
    getLastActiveTabIdForSession,
    addTab,
    removeTab,
    setActiveTab,
    reorderTabs,
    incrementCounter,
    setPtyId,
    getPtyId,
    removePtyId,
    setLastActiveTabId,
    updateTabLabel,
    updateTab,
    prevTab,
    nextTab,
    selectTabByIndex,
    clearSessionTabs,
  };
}

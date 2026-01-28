/**
 * useSplitLayout Hook
 *
 * Manages split state for terminal tabs. Each tab can have multiple
 * split panes arranged in a vim-style layout.
 */

import { useCallback, useState } from 'react';
import {
  TabSplitState,
  SplitPaneConfig,
  SplitDirection,
  SplitOrientation,
  PendingSplit,
  generatePaneId,
  createDefaultSplitState,
} from '../lib/splitTypes';
import { log } from '../lib/log';

export interface UseSplitLayoutReturn {
  /** Per-tab split states */
  splitStates: Map<string, TabSplitState>;

  /** Initialize split state for a tab (idempotent) */
  initTab: (tabId: string, config: Omit<SplitPaneConfig, 'id'>) => string;

  /** Create a new split from the active pane */
  split: (tabId: string, orientation: SplitOrientation) => string | null;

  /** Close a specific pane */
  closePane: (tabId: string, paneId: string) => void;

  /** Set focus to a specific pane */
  focusPane: (tabId: string, paneId: string) => void;

  /** Move focus in a direction (vim-style navigation) */
  focusDirection: (tabId: string, direction: SplitDirection) => void;

  /** Mark a pane as ready with its PTY ID */
  setPaneReady: (tabId: string, paneId: string, ptyId: string) => void;

  /** Get all PTY IDs for a tab (for cleanup) */
  getTabPtyIds: (tabId: string) => string[];

  /** Clear all state for a tab (when tab is closed) */
  clearTab: (tabId: string) => void;

  /** Check if a tab has splits (more than one pane) */
  hasSplits: (tabId: string) => boolean;

  /** Get the active pane ID for a tab */
  getActivePaneId: (tabId: string) => string | null;

  /** Get pane config by ID */
  getPaneConfig: (tabId: string, paneId: string) => SplitPaneConfig | undefined;

  /** Get all pane IDs for a tab */
  getPaneIds: (tabId: string) => string[];

  /** Clear pending split after it's been consumed by SplitContainer */
  clearPendingSplit: (tabId: string) => void;
}

export function useSplitLayout(): UseSplitLayoutReturn {
  const [splitStates, setSplitStates] = useState<Map<string, TabSplitState>>(new Map());

  const initTab = useCallback((tabId: string, config: Omit<SplitPaneConfig, 'id'>): string => {
    // Generate ID once, outside the updater (avoids Strict Mode double-invoke issues)
    const newPaneId = generatePaneId();
    let resultPaneId: string = newPaneId;

    setSplitStates((prev) => {
      // If already initialized, return existing state
      const existing = prev.get(tabId);
      if (existing) {
        resultPaneId = existing.activePaneId ?? newPaneId;
        log.debug('[SPLIT] initTab: already initialized', { tabId, existingPaneId: resultPaneId });
        return prev;
      }

      // Create new single-pane state
      const newState = createDefaultSplitState(newPaneId, config);
      const next = new Map(prev);
      next.set(tabId, newState);
      log.debug('[SPLIT] initTab: created new state', { tabId, paneId: newPaneId, config });
      return next;
    });

    return resultPaneId;
  }, []);

  const split = useCallback((tabId: string, orientation: SplitOrientation): string | null => {
    // Generate ID once, outside the updater (avoids Strict Mode double-invoke issues)
    const newPaneId = generatePaneId();
    let wasAdded = false;

    log.debug('[SPLIT] split() called', { tabId, orientation });

    setSplitStates((prev) => {
      const state = prev.get(tabId);
      if (!state || !state.activePaneId) {
        log.debug('[SPLIT] split: no state or activePaneId', { tabId, hasState: !!state });
        return prev;
      }

      const activePane = state.panes.get(state.activePaneId);
      if (!activePane) {
        log.debug('[SPLIT] split: activePane not found', { activePaneId: state.activePaneId });
        return prev;
      }

      // Idempotency check: if pane already exists, skip (Strict Mode double-invoke)
      if (state.panes.has(newPaneId)) {
        log.debug('[SPLIT] split: pane already exists (idempotency check)', { newPaneId });
        return prev;
      }

      // Create new pane with same config as active pane
      const newPane: SplitPaneConfig = {
        id: newPaneId,
        type: activePane.type,
        directory: activePane.directory,
        // Don't copy command/task/action - new pane gets fresh terminal
      };

      // Track panes and pending split info for SplitContainer to consume
      const newPanes = new Map(state.panes);
      newPanes.set(newPaneId, newPane);

      // Create pending split info so SplitContainer knows the orientation
      const pendingSplit: PendingSplit = {
        newPaneId,
        referencePaneId: state.activePaneId,
        orientation,
      };

      const next = new Map(prev);
      next.set(tabId, {
        ...state,
        panes: newPanes,
        pendingSplit,
        // Focus stays on active pane; SplitContainer will update when ready
      });

      wasAdded = true;
      log.debug('[SPLIT] split: created new pane', { tabId, newPaneId, referencePaneId: state.activePaneId, orientation, totalPanes: newPanes.size });
      return next;
    });

    return wasAdded ? newPaneId : null;
  }, []);

  const closePane = useCallback((tabId: string, paneId: string) => {
    setSplitStates((prev) => {
      const state = prev.get(tabId);
      if (!state) return prev;

      // If this is the last pane, don't close it
      if (state.panes.size <= 1) return prev;

      const newPanes = new Map(state.panes);
      newPanes.delete(paneId);

      // If closing the active pane, focus another one
      let newActivePaneId = state.activePaneId;
      if (newActivePaneId === paneId) {
        newActivePaneId = newPanes.keys().next().value ?? null;
      }

      const next = new Map(prev);
      next.set(tabId, {
        ...state,
        panes: newPanes,
        activePaneId: newActivePaneId,
      });
      return next;
    });
  }, []);

  const focusPane = useCallback((tabId: string, paneId: string) => {
    setSplitStates((prev) => {
      const state = prev.get(tabId);
      if (!state || !state.panes.has(paneId)) return prev;

      const next = new Map(prev);
      next.set(tabId, {
        ...state,
        activePaneId: paneId,
      });
      return next;
    });
  }, []);

  const focusDirection = useCallback((_tabId: string, _direction: SplitDirection) => {
    // Direction-based navigation is implemented by SplitContainer
    // using the Gridview API to find adjacent panels
    // This is a placeholder that components can call
  }, []);

  const setPaneReady = useCallback((tabId: string, paneId: string, ptyId: string) => {
    setSplitStates((prev) => {
      const state = prev.get(tabId);
      if (!state) return prev;

      const pane = state.panes.get(paneId);
      if (!pane) return prev;

      const newPanes = new Map(state.panes);
      newPanes.set(paneId, { ...pane, ptyId });

      const next = new Map(prev);
      next.set(tabId, {
        ...state,
        panes: newPanes,
      });
      return next;
    });
  }, []);

  const getTabPtyIds = useCallback((tabId: string): string[] => {
    const state = splitStates.get(tabId);
    if (!state) return [];
    return Array.from(state.panes.values())
      .map((p) => p.ptyId)
      .filter((id): id is string => !!id);
  }, [splitStates]);

  const clearTab = useCallback((tabId: string) => {
    setSplitStates((prev) => {
      if (!prev.has(tabId)) return prev;
      const next = new Map(prev);
      next.delete(tabId);
      return next;
    });
  }, []);

  const hasSplits = useCallback((tabId: string): boolean => {
    const state = splitStates.get(tabId);
    return state ? state.panes.size > 1 : false;
  }, [splitStates]);

  const getActivePaneId = useCallback((tabId: string): string | null => {
    const state = splitStates.get(tabId);
    return state?.activePaneId ?? null;
  }, [splitStates]);

  const getPaneConfig = useCallback((tabId: string, paneId: string): SplitPaneConfig | undefined => {
    const state = splitStates.get(tabId);
    return state?.panes.get(paneId);
  }, [splitStates]);

  const getPaneIds = useCallback((tabId: string): string[] => {
    const state = splitStates.get(tabId);
    return state ? Array.from(state.panes.keys()) : [];
  }, [splitStates]);

  const clearPendingSplit = useCallback((tabId: string) => {
    log.debug('[SPLIT] clearPendingSplit() called', { tabId });
    setSplitStates((prev) => {
      const state = prev.get(tabId);
      if (!state || !state.pendingSplit) {
        log.debug('[SPLIT] clearPendingSplit: no pending split to clear', { tabId, hasPendingSplit: !!state?.pendingSplit });
        return prev;
      }

      const next = new Map(prev);
      next.set(tabId, {
        ...state,
        pendingSplit: undefined,
      });
      log.debug('[SPLIT] clearPendingSplit: cleared', { tabId });
      return next;
    });
  }, []);

  return {
    splitStates,
    initTab,
    split,
    closePane,
    focusPane,
    focusDirection,
    setPaneReady,
    getTabPtyIds,
    clearTab,
    hasSplits,
    getActivePaneId,
    getPaneConfig,
    getPaneIds,
    clearPendingSplit,
  };
}

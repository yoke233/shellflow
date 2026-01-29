/**
 * SplitContext
 *
 * Provides split layout state to components without prop drilling.
 * Uses separate contexts for state and actions to minimize re-renders:
 * - Actions context: Stable references, never triggers re-renders
 * - State context: Contains mutable state, triggers re-renders on change
 *
 * Also provides selector hooks for fine-grained subscriptions:
 * - useSplitForTab(tabId): Only re-renders when that specific tab's state changes
 */

import {
  createContext,
  useContext,
  ReactNode,
  useCallback,
  useRef,
  useSyncExternalStore,
  useMemo,
} from 'react';
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

// ============================================================================
// Types
// ============================================================================

export interface SplitActions {
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

  /** Clear pending focus direction after it's been consumed by SplitContainer */
  clearPendingFocusDirection: (tabId: string) => void;
}

export interface SplitState {
  /** Per-tab split states */
  splitStates: Map<string, TabSplitState>;
}

// Combined return type for backwards compatibility
export interface UseSplitReturn extends SplitActions, SplitState {}

// ============================================================================
// Store (external to React for useSyncExternalStore)
// ============================================================================

type Listener = () => void;

class SplitStore {
  private state: Map<string, TabSplitState> = new Map();
  private listeners = new Set<Listener>();
  private tabListeners = new Map<string, Set<Listener>>();

  getState(): Map<string, TabSplitState> {
    return this.state;
  }

  getTabState(tabId: string): TabSplitState | undefined {
    return this.state.get(tabId);
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  subscribeToTab(tabId: string, listener: Listener): () => void {
    if (!this.tabListeners.has(tabId)) {
      this.tabListeners.set(tabId, new Set());
    }
    this.tabListeners.get(tabId)!.add(listener);
    return () => {
      const listeners = this.tabListeners.get(tabId);
      if (listeners) {
        listeners.delete(listener);
        if (listeners.size === 0) {
          this.tabListeners.delete(tabId);
        }
      }
    };
  }

  private notify(changedTabId?: string) {
    // Notify global listeners
    this.listeners.forEach((l) => l());
    // Notify tab-specific listeners
    if (changedTabId) {
      this.tabListeners.get(changedTabId)?.forEach((l) => l());
    }
  }

  // State mutations
  setState(
    updater: (prev: Map<string, TabSplitState>) => Map<string, TabSplitState>,
    changedTabId?: string
  ) {
    const newState = updater(this.state);
    if (newState !== this.state) {
      this.state = newState;
      this.notify(changedTabId);
    }
  }
}

// ============================================================================
// Contexts
// ============================================================================

const SplitActionsContext = createContext<SplitActions | null>(null);
const SplitStoreContext = createContext<SplitStore | null>(null);

// ============================================================================
// Provider
// ============================================================================

export function SplitProvider({ children }: { children: ReactNode }) {
  // Create store once per provider
  const storeRef = useRef<SplitStore | null>(null);
  if (!storeRef.current) {
    storeRef.current = new SplitStore();
  }
  const store = storeRef.current;

  // Actions are stable (created once, reference store via ref)
  const actions = useMemo<SplitActions>(() => {
    const initTab = (tabId: string, config: Omit<SplitPaneConfig, 'id'>): string => {
      const newPaneId = generatePaneId();
      let resultPaneId: string = newPaneId;

      store.setState((prev) => {
        const existing = prev.get(tabId);
        if (existing) {
          resultPaneId = existing.activePaneId ?? newPaneId;
          log.debug('[SPLIT] initTab: already initialized', { tabId, existingPaneId: resultPaneId });
          return prev;
        }

        const newState = createDefaultSplitState(newPaneId, config);
        const next = new Map(prev);
        next.set(tabId, newState);
        log.debug('[SPLIT] initTab: created new state', { tabId, paneId: newPaneId, config });
        return next;
      }, tabId);

      return resultPaneId;
    };

    const split = (tabId: string, orientation: SplitOrientation): string | null => {
      const newPaneId = generatePaneId();
      let wasAdded = false;

      log.debug('[SPLIT] split() called', { tabId, orientation });

      store.setState((prev) => {
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

        if (state.panes.has(newPaneId)) {
          log.debug('[SPLIT] split: pane already exists (idempotency check)', { newPaneId });
          return prev;
        }

        const newPane: SplitPaneConfig = {
          id: newPaneId,
          type: activePane.type,
          directory: activePane.directory,
        };

        const newPanes = new Map(state.panes);
        newPanes.set(newPaneId, newPane);

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
          activePaneId: newPaneId,  // Focus the new pane
        });

        wasAdded = true;
        log.debug('[SPLIT] split: created new pane', {
          tabId,
          newPaneId,
          referencePaneId: state.activePaneId,
          orientation,
          totalPanes: newPanes.size,
        });
        return next;
      }, tabId);

      return wasAdded ? newPaneId : null;
    };

    const closePane = (tabId: string, paneId: string) => {
      store.setState((prev) => {
        const state = prev.get(tabId);
        if (!state) return prev;

        if (state.panes.size <= 1) return prev;

        const newPanes = new Map(state.panes);
        newPanes.delete(paneId);

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
      }, tabId);
    };

    const focusPane = (tabId: string, paneId: string) => {
      store.setState((prev) => {
        const state = prev.get(tabId);
        // Early return if pane doesn't exist or is already the active pane
        // This prevents infinite loops when focus events fire redundantly
        if (!state || !state.panes.has(paneId) || state.activePaneId === paneId) {
          return prev;
        }

        const next = new Map(prev);
        next.set(tabId, {
          ...state,
          activePaneId: paneId,
        });
        return next;
      }, tabId);
    };

    const focusDirection = (tabId: string, direction: SplitDirection) => {
      store.setState((prev) => {
        const state = prev.get(tabId);
        if (!state || state.panes.size <= 1) return prev;

        const next = new Map(prev);
        next.set(tabId, {
          ...state,
          pendingFocusDirection: direction,
        });
        return next;
      }, tabId);
    };

    const setPaneReady = (tabId: string, paneId: string, ptyId: string) => {
      store.setState((prev) => {
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
      }, tabId);
    };

    const getTabPtyIds = (tabId: string): string[] => {
      const state = store.getState().get(tabId);
      if (!state) return [];
      return Array.from(state.panes.values())
        .map((p) => p.ptyId)
        .filter((id): id is string => !!id);
    };

    const clearTab = (tabId: string) => {
      store.setState((prev) => {
        if (!prev.has(tabId)) return prev;
        const next = new Map(prev);
        next.delete(tabId);
        return next;
      }, tabId);
    };

    const hasSplits = (tabId: string): boolean => {
      const state = store.getState().get(tabId);
      return state ? state.panes.size > 1 : false;
    };

    const getActivePaneId = (tabId: string): string | null => {
      const state = store.getState().get(tabId);
      return state?.activePaneId ?? null;
    };

    const getPaneConfig = (tabId: string, paneId: string): SplitPaneConfig | undefined => {
      const state = store.getState().get(tabId);
      return state?.panes.get(paneId);
    };

    const getPaneIds = (tabId: string): string[] => {
      const state = store.getState().get(tabId);
      return state ? Array.from(state.panes.keys()) : [];
    };

    const clearPendingSplit = (tabId: string) => {
      log.debug('[SPLIT] clearPendingSplit() called', { tabId });
      store.setState((prev) => {
        const state = prev.get(tabId);
        if (!state || !state.pendingSplit) {
          log.debug('[SPLIT] clearPendingSplit: no pending split to clear', {
            tabId,
            hasPendingSplit: !!state?.pendingSplit,
          });
          return prev;
        }

        const next = new Map(prev);
        next.set(tabId, {
          ...state,
          pendingSplit: undefined,
        });
        log.debug('[SPLIT] clearPendingSplit: cleared', { tabId });
        return next;
      }, tabId);
    };

    const clearPendingFocusDirection = (tabId: string) => {
      store.setState((prev) => {
        const state = prev.get(tabId);
        if (!state || !state.pendingFocusDirection) return prev;

        const next = new Map(prev);
        next.set(tabId, {
          ...state,
          pendingFocusDirection: undefined,
        });
        return next;
      }, tabId);
    };

    return {
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
      clearPendingFocusDirection,
    };
  }, [store]);

  return (
    <SplitStoreContext.Provider value={store}>
      <SplitActionsContext.Provider value={actions}>{children}</SplitActionsContext.Provider>
    </SplitStoreContext.Provider>
  );
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Get only split actions (stable references, never triggers re-renders)
 */
export function useSplitActions(): SplitActions {
  const actions = useContext(SplitActionsContext);
  if (!actions) {
    throw new Error('useSplitActions must be used within a SplitProvider');
  }
  return actions;
}

/**
 * Get split state for a specific tab only.
 * Only re-renders when that specific tab's state changes.
 */
export function useSplitForTab(tabId: string): TabSplitState | undefined {
  const store = useContext(SplitStoreContext);
  if (!store) {
    throw new Error('useSplitForTab must be used within a SplitProvider');
  }

  const subscribe = useCallback(
    (onStoreChange: () => void) => store.subscribeToTab(tabId, onStoreChange),
    [store, tabId]
  );

  const getSnapshot = useCallback(() => store.getTabState(tabId), [store, tabId]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Get full split state (all tabs).
 * Re-renders on any state change. Use useSplitForTab when possible.
 */
export function useSplitState(): Map<string, TabSplitState> {
  const store = useContext(SplitStoreContext);
  if (!store) {
    throw new Error('useSplitState must be used within a SplitProvider');
  }

  const subscribe = useCallback((onStoreChange: () => void) => store.subscribe(onStoreChange), [store]);
  const getSnapshot = useCallback(() => store.getState(), [store]);

  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/**
 * Backwards-compatible hook that returns both state and actions.
 * Prefer useSplitActions() or useSplitForTab() for better performance.
 */
export function useSplit(): UseSplitReturn {
  const actions = useSplitActions();
  const splitStates = useSplitState();
  return { ...actions, splitStates };
}

import { useState, useEffect, useRef, useCallback, useMemo, memo } from 'react';
import { GitBranch, FolderPlus, Terminal, Keyboard } from 'lucide-react';
import { MainTerminal } from './MainTerminal';
import { DrawerTerminal } from '../Drawer/DrawerTerminal';
import { DiffViewer } from '../DiffViewer';
import { SplitContainer } from '../SplitContainer';
import { SessionTabBar } from './SessionTabBar';
import { TerminalConfig, ConfigError } from '../../hooks/useConfig';
import { ConfigErrorBanner } from '../ConfigErrorBanner';
import { Session, SessionKind, SessionTab, TabIndicators } from '../../types';
import { SplitPaneConfig } from '../../lib/splitTypes';
import { useSplitActions, useSplitForTab } from '../../contexts/SplitContext';
import { log } from '../../lib/log';

interface MainPaneProps {
  // Unified session props
  sessions: Session[];
  openSessionIds: Set<string>;
  activeSessionId: string | null;

  // Session tabs props - Map of all session tabs to keep terminals alive across session switches
  allSessionTabs: Map<string, SessionTab[]>;
  activeSessionTabId: string | null;
  /** Map of sessionId -> last active tabId (for routing thinking indicators to correct tab) */
  sessionLastActiveTabIds: Map<string, string>;
  isCtrlKeyHeld?: boolean;
  onSelectSessionTab: (tabId: string) => void;
  onCloseSessionTab: (tabId: string) => void;
  onAddSessionTab: () => void;
  onReorderSessionTabs: (oldIndex: number, newIndex: number) => void;

  // Common props
  terminalConfig: TerminalConfig;
  /** Editor config for diff viewer (uses base config without zoom) */
  editorConfig: TerminalConfig;
  activityTimeout: number;
  /** Opacity (0.0 to 1.0) applied to unfocused split panes */
  unfocusedPaneOpacity?: number;
  shouldAutoFocus: boolean;
  /** Counter that triggers focus when incremented */
  focusTrigger?: number;
  configErrors: ConfigError[];
  onFocus: (sessionId: string, tabId?: string) => void;
  onNotification?: (sessionId: string, tabId: string, title: string, body: string) => void;
  onThinkingChange?: (sessionId: string, tabId: string, isThinking: boolean) => void;
  onClearNotification?: (sessionId: string) => void;
  onCwdChange?: (sessionId: string, cwd: string) => void;
  onTabTitleChange?: (sessionId: string, tabId: string, title: string) => void;
  /** Called when a tab's PTY is spawned (for cleanup tracking) */
  onPtyIdReady?: (tabId: string, ptyId: string) => void;

  // Legacy props for backward compatibility during migration
  openWorktreeIds?: Set<string>;
  activeWorktreeId?: string | null;
  openProjectIds?: Set<string>;
  activeProjectId?: string | null;
  activeScratchId?: string | null;
  onWorktreeNotification?: (worktreeId: string, title: string, body: string) => void;
  onWorktreeThinkingChange?: (worktreeId: string, isThinking: boolean) => void;
  onProjectNotification?: (projectId: string, title: string, body: string) => void;
  onProjectThinkingChange?: (projectId: string, isThinking: boolean) => void;
  onScratchNotification?: (scratchId: string, title: string, body: string) => void;
  onScratchThinkingChange?: (scratchId: string, isThinking: boolean) => void;
  onScratchCwdChange?: (scratchId: string, cwd: string) => void;
}

// Map session kind to terminal type
function getTerminalType(kind: SessionKind): 'main' | 'project' | 'scratch' {
  switch (kind) {
    case 'worktree':
      return 'main';
    case 'project':
      return 'project';
    case 'scratch':
      return 'scratch';
  }
}

// ============================================================================
// TerminalTabContent - Uses fine-grained split state subscription
// Only re-renders when THIS tab's split state changes (not all tabs)
// Receives callback factories to maintain stable props across parent re-renders
// ============================================================================

interface TerminalTabContentProps {
  tabId: string;
  sessionId: string;
  isActiveTab: boolean;
  shouldAutoFocus: boolean;
  focusTrigger: number | undefined;
  terminalConfig: TerminalConfig;
  activityTimeout: number;
  terminalType: 'main' | 'project' | 'scratch';
  tabDirectory: string | undefined;
  sessionKind: SessionKind;
  sessionInitialCwd: string | undefined;
  isPrimary: boolean;
  // Callback factories - stable references that take IDs as params
  onFocusFactory: (sessionId: string, tabId: string) => void;
  onNotificationFactory: (sessionId: string, tabId: string, title: string, body: string) => void;
  onThinkingChangeFactory: (tabId: string, isThinking: boolean) => void;
  onCwdChangeFactory: ((tabId: string, cwd: string) => void) | null;
  onTitleChangeFactory: (sessionId: string, tabId: string, title: string) => void;
  onPtyIdReadyFactory: ((tabId: string, ptyId: string) => void) | null;
  onExitFactory: (tabId: string, paneId: string, isLastPane: boolean) => void;
  renderSplitPane: (
    paneId: string,
    paneConfig: SplitPaneConfig,
    isActivePane: boolean,
    tabId: string,
    sessionId: string,
    isActiveTab: boolean,
    hasSplits: boolean,
    handleNotification: (title: string, body: string) => void,
    handleThinkingChange: (isThinking: boolean) => void,
    handleCwdChange: ((cwd: string) => void) | undefined,
    handleTitleChange: (title: string) => void,
    handleExit: (paneId: string) => void
  ) => React.ReactNode;
}

const TerminalTabContent = memo(function TerminalTabContent({
  tabId,
  sessionId,
  isActiveTab,
  shouldAutoFocus,
  focusTrigger,
  terminalConfig,
  activityTimeout,
  terminalType,
  tabDirectory,
  sessionKind,
  sessionInitialCwd,
  isPrimary,
  onFocusFactory,
  onNotificationFactory,
  onThinkingChangeFactory,
  onCwdChangeFactory,
  onTitleChangeFactory,
  onPtyIdReadyFactory,
  onExitFactory,
  renderSplitPane,
}: TerminalTabContentProps) {
  // Fine-grained subscription: only re-renders when THIS tab's split state changes
  const splitState = useSplitForTab(tabId);
  const { focusPane, setPaneReady, getActivePaneId, clearPendingSplit, clearPendingFocusDirection } = useSplitActions();

  // Create stable bound callbacks using this tab's IDs
  const handleFocus = useCallback(
    () => onFocusFactory(sessionId, tabId),
    [onFocusFactory, sessionId, tabId]
  );

  const handleNotification = useCallback(
    (title: string, body: string) => onNotificationFactory(sessionId, tabId, title, body),
    [onNotificationFactory, sessionId, tabId]
  );

  const handleThinkingChange = useCallback(
    (isThinking: boolean) => onThinkingChangeFactory(tabId, isThinking),
    [onThinkingChangeFactory, tabId]
  );

  const handleCwdChange = useMemo(
    () => (onCwdChangeFactory ? (cwd: string) => onCwdChangeFactory(tabId, cwd) : undefined),
    [onCwdChangeFactory, tabId]
  );

  const handleTitleChange = useCallback(
    (title: string) => onTitleChangeFactory(sessionId, tabId, title),
    [onTitleChangeFactory, sessionId, tabId]
  );

  const handlePtyIdReady = useCallback(
    (ptyId: string) => {
      if (splitState) {
        const paneId = splitState.activePaneId ?? tabId;
        setPaneReady(tabId, paneId, ptyId);
      }
      onPtyIdReadyFactory?.(tabId, ptyId);
    },
    [splitState, tabId, setPaneReady, onPtyIdReadyFactory]
  );

  const handleExit = useCallback(
    (paneId: string) => {
      const isLastPane = !splitState || splitState.panes.size <= 1;
      onExitFactory(tabId, paneId, isLastPane);
    },
    [onExitFactory, tabId, splitState]
  );

  const handlePendingSplitConsumed = useCallback(
    () => clearPendingSplit(tabId),
    [clearPendingSplit, tabId]
  );

  const handlePendingFocusDirectionConsumed = useCallback(
    () => clearPendingFocusDirection(tabId),
    [clearPendingFocusDirection, tabId]
  );

  const handlePaneFocus = useCallback(
    (paneId: string) => focusPane(tabId, paneId),
    [focusPane, tabId]
  );

  // For single-pane mode: get the pane ID (must be computed before conditional to keep hook order stable)
  const singlePaneId = splitState?.activePaneId ?? tabId;

  // Create bound exit handler - must be before conditional return to maintain hook order
  const handleSinglePaneExit = useCallback(
    () => handleExit(singlePaneId),
    [handleExit, singlePaneId]
  );

  log.debug('[SPLIT:TerminalTabContent] render', {
    tabId,
    hasSplitState: !!splitState,
    paneCount: splitState?.panes.size ?? 0,
    hasPendingSplit: !!splitState?.pendingSplit,
  });

  if (splitState && splitState.panes.size > 1) {
    // Multi-pane: use SplitContainer
    const activePaneId = getActivePaneId(tabId);
    return (
      <SplitContainer
        panes={splitState.panes}
        activePaneId={activePaneId}
        pendingSplit={splitState.pendingSplit}
        onPendingSplitConsumed={handlePendingSplitConsumed}
        pendingFocusDirection={splitState.pendingFocusDirection}
        onPendingFocusDirectionConsumed={handlePendingFocusDirectionConsumed}
        renderPane={(paneId, paneConfig, isActivePane) =>
          renderSplitPane(
            paneId,
            paneConfig,
            isActivePane,
            tabId,
            sessionId,
            isActiveTab,
            true, // hasSplits
            handleNotification,
            handleThinkingChange,
            handleCwdChange,
            handleTitleChange,
            handleExit
          )
        }
        onPaneFocus={handlePaneFocus}
      />
    );
  }

  // Single pane: render MainTerminal directly (no Gridview overhead)
  const singlePaneConfig = splitState?.panes.get(singlePaneId);
  // Map split pane types to MainTerminal types
  const rawType = singlePaneConfig?.type ?? (isPrimary ? terminalType : 'scratch');
  const singlePaneType =
    rawType === 'task' || rawType === 'action' || rawType === 'shell'
      ? ('scratch' as const)
      : rawType;
  const singlePaneCwd =
    singlePaneConfig?.directory ??
    tabDirectory ??
    (sessionKind === 'scratch' && isPrimary ? sessionInitialCwd : undefined);

  return (
    <MainTerminal
      entityId={singlePaneId}
      sessionId={sessionId}
      type={singlePaneType}
      isActive={isActiveTab}
      shouldAutoFocus={isActiveTab && shouldAutoFocus}
      focusTrigger={isActiveTab ? focusTrigger : undefined}
      terminalConfig={terminalConfig}
      activityTimeout={activityTimeout}
      initialCwd={singlePaneCwd}
      onFocus={handleFocus}
      onNotification={handleNotification}
      onThinkingChange={handleThinkingChange}
      onCwdChange={handleCwdChange}
      onTitleChange={handleTitleChange}
      onPtyIdReady={handlePtyIdReady}
      onExit={handleSinglePaneExit}
    />
  );
});

export const MainPane = memo(function MainPane({
  sessions,
  openSessionIds,
  activeSessionId,
  allSessionTabs,
  activeSessionTabId,
  sessionLastActiveTabIds,
  isCtrlKeyHeld = false,
  onSelectSessionTab,
  onCloseSessionTab,
  onAddSessionTab,
  onReorderSessionTabs,
  terminalConfig,
  editorConfig,
  activityTimeout,
  unfocusedPaneOpacity = 1,
  shouldAutoFocus,
  focusTrigger,
  configErrors,
  onFocus,
  onNotification,
  onThinkingChange,
  onClearNotification,
  onCwdChange,
  onTabTitleChange,
  onPtyIdReady,
  // Legacy props
  onWorktreeNotification,
  onWorktreeThinkingChange,
  onProjectNotification,
  onProjectThinkingChange,
  onScratchNotification,
  onScratchThinkingChange,
  onScratchCwdChange,
}: MainPaneProps) {
  // Use only actions from split context - state is handled by TerminalTabContent
  // This prevents MainPane from re-rendering when split state changes
  const {
    initTab: initSplitTab,
    focusPane: focusSplitPane,
    setPaneReady: setSplitPaneReady,
    closePane: closeSplitPane,
  } = useSplitActions();

  log.debug('[SPLIT:MainPane] render', {
    activeSessionId,
    activeSessionTabId,
    allSessionTabsSize: allSessionTabs.size,
  });

  const hasOpenSessions = openSessionIds.size > 0;

  // Per-tab indicator state (for tab bar display)
  const [tabIndicators, setTabIndicators] = useState<Map<string, TabIndicators>>(new Map());

  // Clear notification and idle indicators when a tab becomes active (you've seen it)
  // Note: thinking state is NOT cleared here - MainTerminal controls it
  // (OSC-based thinking persists until explicit stop, activity-based clears on its own)
  useEffect(() => {
    if (activeSessionTabId) {
      setTabIndicators((prev) => {
        const current = prev.get(activeSessionTabId);
        if (!current || (!current.notified && !current.idle)) return prev;
        const next = new Map(prev);
        next.set(activeSessionTabId, { ...current, notified: false, idle: false });
        return next;
      });
    }
  }, [activeSessionTabId]);

  // Track last propagated states per session to avoid redundant updates
  const lastPropagatedThinkingRef = useRef<Map<string, boolean>>(new Map());
  const lastPropagatedNotifiedRef = useRef<Map<string, boolean>>(new Map());

  // Track which tabs have been initialized for split state (prevents effect cascade)
  const initializedSplitTabsRef = useRef<Set<string>>(new Set());

  // Effect to propagate thinking and notification state to sidebar when relevant state changes
  // This ensures sidebar gets updated when sessionLastActiveTabIds changes after a session switch
  useEffect(() => {
    for (const [sessionId, tabs] of allSessionTabs.entries()) {
      const session = sessions.find(s => s.id === sessionId);
      if (!session) continue;

      // Determine which tab's thinking state should propagate to sidebar
      const isActiveSession = sessionId === activeSessionId;
      const lastActiveTabId = sessionLastActiveTabIds.get(sessionId);
      // For active session, use active tab; for others, use last active tab or first tab
      const propagatingTabId = isActiveSession
        ? activeSessionTabId
        : (lastActiveTabId ?? tabs[0]?.id);

      if (!propagatingTabId) continue;

      const tabState = tabIndicators.get(propagatingTabId);
      const isThinking = tabState?.thinking ?? false;
      const lastPropagatedThinking = lastPropagatedThinkingRef.current.get(sessionId);

      // Only propagate thinking if the state has changed
      if (isThinking !== lastPropagatedThinking) {
        lastPropagatedThinkingRef.current.set(sessionId, isThinking);

        if (onThinkingChange) {
          onThinkingChange(sessionId, propagatingTabId, isThinking);
        } else {
          // Legacy handlers
          if (session.kind === 'worktree') {
            onWorktreeThinkingChange?.(sessionId, isThinking);
          } else if (session.kind === 'project') {
            onProjectThinkingChange?.(sessionId, isThinking);
          } else {
            onScratchThinkingChange?.(sessionId, isThinking);
          }
        }
      }

      // Notification: session is notified if ANY tab in the session is notified
      const isSessionNotified = tabs.some(t => tabIndicators.get(t.id)?.notified);
      const lastPropagatedNotified = lastPropagatedNotifiedRef.current.get(sessionId);

      // Only propagate notification if the state has changed
      if (isSessionNotified !== lastPropagatedNotified) {
        lastPropagatedNotifiedRef.current.set(sessionId, isSessionNotified);

        if (isSessionNotified) {
          // Use the first notified tab for the propagation call
          const notifiedTab = tabs.find(t => tabIndicators.get(t.id)?.notified);
          const notifyingTabId = notifiedTab?.id ?? propagatingTabId;

          if (onNotification) {
            // We propagate a "synthetic" notification to update sidebar state
            onNotification(sessionId, notifyingTabId, '', '');
          }
        } else {
          // Clear notification - all tabs have been visited
          onClearNotification?.(sessionId);
        }
      }
    }
  }, [
    tabIndicators,
    sessionLastActiveTabIds,
    allSessionTabs,
    activeSessionId,
    activeSessionTabId,
    sessions,
    onThinkingChange,
    onNotification,
    onClearNotification,
    onWorktreeThinkingChange,
    onProjectThinkingChange,
    onScratchThinkingChange,
  ]);

  // Initialize split state for regular terminal tabs that don't have it yet
  useEffect(() => {
    let initializedCount = 0;
    let skippedCount = 0;

    for (const [sessionId, tabs] of allSessionTabs.entries()) {
      const session = sessions.find(s => s.id === sessionId);
      if (!session) continue;

      const terminalType = getTerminalType(session.kind);

      for (const tab of tabs) {
        // Skip non-terminal tabs (diff, command tabs)
        if (tab.diff || tab.command) continue;

        // Skip if we've already initialized this tab (using ref, not state)
        if (initializedSplitTabsRef.current.has(tab.id)) {
          skippedCount++;
          continue;
        }

        // Mark as initialized BEFORE calling initSplitTab to prevent double-init
        initializedSplitTabsRef.current.add(tab.id);

        const type = tab.isPrimary ? terminalType : 'scratch';
        const directory = tab.directory ?? (session.kind === 'scratch' && tab.isPrimary ? session.initialCwd : undefined);
        log.debug('[SPLIT:MainPane] initializing split state for tab', { tabId: tab.id, type, directory });
        initSplitTab(tab.id, { type, directory });
        initializedCount++;
      }
    }

    log.debug('[SPLIT:MainPane] init effect complete', { initializedCount, skippedCount, refSize: initializedSplitTabsRef.current.size });
  }, [allSessionTabs, sessions, initSplitTab]);  // ← Removed splitStates

  // Clean up tracking ref when tabs are closed
  useEffect(() => {
    const currentTabIds = new Set<string>();
    for (const [, tabs] of allSessionTabs.entries()) {
      for (const tab of tabs) {
        if (!tab.diff && !tab.command) {
          currentTabIds.add(tab.id);
        }
      }
    }

    // Remove closed tabs from our tracking ref
    for (const tabId of initializedSplitTabsRef.current) {
      if (!currentTabIds.has(tabId)) {
        initializedSplitTabsRef.current.delete(tabId);
      }
    }
  }, [allSessionTabs]);

  // Render a pane for SplitContainer - uses MainTerminal directly
  const renderSplitPane = useCallback(
    (
      paneId: string,
      paneConfig: SplitPaneConfig,
      isActivePane: boolean,
      tabId: string,
      sessionId: string,
      isActiveTab: boolean,
      hasSplits: boolean,
      handleNotification: (title: string, body: string) => void,
      handleThinkingChange: (isThinking: boolean) => void,
      handleCwdChange: ((cwd: string) => void) | undefined,
      handleTitleChange: (title: string) => void,
      handleExit: (paneId: string) => void
    ) => {
      // Map split pane type to MainTerminal type
      const terminalType = paneConfig.type === 'task' || paneConfig.type === 'action' || paneConfig.type === 'shell'
        ? 'scratch'
        : paneConfig.type;

      // Terminal is fully active only when both pane and tab are active
      const isActive = isActivePane && isActiveTab;

      // Apply opacity to unfocused panes when there are splits
      const paneOpacity = hasSplits && !isActivePane ? unfocusedPaneOpacity : 1;

      return (
        <div
          key={paneId}
          className="w-full h-full relative transition-opacity duration-150"
          style={{ opacity: paneOpacity }}
        >
          {/* Active pane indicator - shown when pane is active but tab is not focused */}
          {hasSplits && isActivePane && !isActive && (
            <div className="absolute inset-0 border-2 border-theme-accent/30 pointer-events-none z-10 rounded" />
          )}
          <MainTerminal
            entityId={paneId}
            sessionId={sessionId}
            type={terminalType}
            isActive={isActive}
            shouldAutoFocus={isActive && shouldAutoFocus}
            focusTrigger={isActive ? focusTrigger : undefined}
            terminalConfig={terminalConfig}
            activityTimeout={activityTimeout}
            initialCwd={paneConfig.directory}
            onFocus={() => {
              focusSplitPane(tabId, paneId);
              onFocus(sessionId, tabId);
            }}
            onNotification={handleNotification}
            onThinkingChange={handleThinkingChange}
            onCwdChange={handleCwdChange}
            onTitleChange={handleTitleChange}
            onPtyIdReady={(ptyId) => {
              setSplitPaneReady(tabId, paneId, ptyId);
              onPtyIdReady?.(tabId, ptyId);
            }}
            onExit={() => handleExit(paneId)}
          />
        </div>
      );
    },
    [shouldAutoFocus, focusTrigger, terminalConfig, activityTimeout, unfocusedPaneOpacity, focusSplitPane, onFocus, setSplitPaneReady, onPtyIdReady]
  );

  // ============================================================================
  // Stable callback factories for TerminalTabContent
  // These are memoized so TerminalTabContent's React.memo can work effectively
  // ============================================================================

  const onFocusFactory = useCallback(
    (sessionId: string, tabId: string) => {
      onFocus(sessionId, tabId);
    },
    [onFocus]
  );

  const onNotificationFactory = useCallback(
    (sessionId: string, tabId: string, title: string, body: string) => {
      // Update per-tab indicator state
      setTabIndicators((prev) => {
        const current = prev.get(tabId) ?? { notified: false, thinking: false, idle: false };
        const next = new Map(prev);
        next.set(tabId, { ...current, notified: true });
        return next;
      });

      // Propagate to sidebar with actual title/body for OS notification
      if (onNotification) {
        onNotification(sessionId, tabId, title, body);
      } else {
        // Legacy handlers - find session to determine kind
        const session = sessions.find((s) => s.id === sessionId);
        if (session?.kind === 'worktree') {
          onWorktreeNotification?.(sessionId, title, body);
        } else if (session?.kind === 'project') {
          onProjectNotification?.(sessionId, title, body);
        } else {
          onScratchNotification?.(sessionId, title, body);
        }
      }
    },
    [onNotification, sessions, onWorktreeNotification, onProjectNotification, onScratchNotification]
  );

  const onThinkingChangeFactory = useCallback((tabId: string, isThinking: boolean) => {
    setTabIndicators((prev) => {
      const current = prev.get(tabId) ?? { notified: false, thinking: false, idle: false };
      const next = new Map(prev);
      if (isThinking) {
        // Clear idle when thinking starts
        next.set(tabId, { ...current, thinking: true, idle: false });
      } else {
        // Set idle when thinking stops (only if was thinking)
        next.set(tabId, { ...current, thinking: false, idle: current.thinking });
      }
      return next;
    });
  }, []);

  const onCwdChangeFactory = useCallback(
    (tabId: string, cwd: string) => {
      if (onCwdChange) {
        onCwdChange(tabId, cwd);
      } else {
        onScratchCwdChange?.(tabId, cwd);
      }
    },
    [onCwdChange, onScratchCwdChange]
  );

  const onTitleChangeFactory = useCallback(
    (sessionId: string, tabId: string, title: string) => {
      onTabTitleChange?.(sessionId, tabId, title);
    },
    [onTabTitleChange]
  );

  const onPtyIdReadyFactory = useCallback(
    (tabId: string, ptyId: string) => {
      onPtyIdReady?.(tabId, ptyId);
    },
    [onPtyIdReady]
  );

  const onExitFactory = useCallback(
    (tabId: string, paneId: string, isLastPane: boolean) => {
      if (isLastPane) {
        // Close the entire tab when it's the last pane
        onCloseSessionTab(tabId);
      } else {
        // Close just the pane when there are multiple
        closeSplitPane(tabId, paneId);
      }
    },
    [onCloseSessionTab, closeSplitPane]
  );

  if (!hasOpenSessions || !activeSessionId) {
    return (
      <div className="flex flex-col h-full bg-theme-0 text-theme-2 select-none items-center justify-center px-8">
        <h1 className="text-2xl font-semibold text-theme-1 mb-2">Shellflow</h1>
        <p className="text-theme-3 mb-8 text-center max-w-md">
          The terminal wrapper with worktree orchestration.
        </p>

        <div className="flex flex-col gap-4 text-sm max-w-sm">
          <div className="flex items-start gap-3">
            <FolderPlus size={18} className="text-theme-3 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-theme-1">Add a project</span>
              <span className="text-theme-3"> — open any git repository to get started</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <GitBranch size={18} className="text-theme-3 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-theme-1">Create worktrees</span>
              <span className="text-theme-3"> — each worktree is an isolated branch with its own terminal</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Terminal size={18} className="text-theme-3 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-theme-1">Run commands in parallel</span>
              <span className="text-theme-3"> — switch between worktrees without losing context</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Keyboard size={18} className="text-theme-3 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-theme-1">Use keyboard shortcuts</span>
              <span className="text-theme-3"> — press </span>
              <kbd className="px-1.5 py-0.5 bg-theme-2 rounded text-theme-2 text-xs font-mono">⌘⇧P</kbd>
              <span className="text-theme-3"> for the command palette</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-theme-0 flex flex-col">
      {/* Config error banner */}
      <ConfigErrorBanner errors={configErrors} />

      {/* Session tab bar (only shown when multiple tabs exist) */}
      <SessionTabBar
        tabs={allSessionTabs.get(activeSessionId) ?? []}
        activeTabId={activeSessionTabId}
        tabIndicators={tabIndicators}
        isCtrlKeyHeld={isCtrlKeyHeld}
        onSelectTab={onSelectSessionTab}
        onCloseTab={onCloseSessionTab}
        onAddTab={onAddSessionTab}
        onReorderTabs={onReorderSessionTabs}
      />

      {/* Terminal container - render ALL terminals for ALL sessions to keep them alive */}
      <div className="flex-1 relative">
        {Array.from(allSessionTabs.entries()).flatMap(([sessionId, tabs]) => {
          const session = sessions.find(s => s.id === sessionId);
          if (!session) return [];

          const isActiveSession = sessionId === activeSessionId;
          const terminalType = getTerminalType(session.kind);

          return tabs.map((tab) => {
            const isActiveTab = isActiveSession && tab.id === activeSessionTabId;

            // Determine which element to render based on tab type
            let tabElement: React.ReactNode;

            if (tab.diff) {
              // Diff viewer tab
              tabElement = (
                <DiffViewer
                  worktreePath={tab.diff.worktreePath}
                  filePath={tab.diff.filePath}
                  mode={tab.diff.mode}
                  projectPath={tab.diff.projectPath}
                  onClose={() => onCloseSessionTab(tab.id)}
                  terminalConfig={editorConfig}
                />
              );
            } else if (tab.command) {
              // Command tab (DrawerTerminal)
              tabElement = (
                <DrawerTerminal
                  id={tab.id}
                  entityId={session.id}
                  directory={tab.directory}
                  command={tab.command}
                  isActive={isActiveTab}
                  shouldAutoFocus={isActiveTab && shouldAutoFocus}
                  terminalConfig={terminalConfig}
                  onFocus={() => onFocus(session.id, tab.id)}
                  onTitleChange={(title) => onTitleChangeFactory(session.id, tab.id, title)}
                  onClose={() => onCloseSessionTab(tab.id)}
                  onPtyIdReady={(ptyId) => onPtyIdReady?.(tab.id, ptyId)}
                />
              );
            } else {
              // Regular terminal tab - use TerminalTabContent for fine-grained split state subscription
              // TerminalTabContent only re-renders when THIS tab's split state changes
              // All callbacks are stable factories - TerminalTabContent binds them internally
              tabElement = (
                <TerminalTabContent
                  tabId={tab.id}
                  sessionId={session.id}
                  isActiveTab={isActiveTab}
                  shouldAutoFocus={shouldAutoFocus}
                  focusTrigger={focusTrigger}
                  terminalConfig={terminalConfig}
                  activityTimeout={activityTimeout}
                  terminalType={terminalType}
                  tabDirectory={tab.directory}
                  sessionKind={session.kind}
                  sessionInitialCwd={session.initialCwd}
                  isPrimary={tab.isPrimary}
                  onFocusFactory={onFocusFactory}
                  onNotificationFactory={onNotificationFactory}
                  onThinkingChangeFactory={onThinkingChangeFactory}
                  onCwdChangeFactory={session.kind === 'scratch' ? onCwdChangeFactory : null}
                  onTitleChangeFactory={onTitleChangeFactory}
                  onPtyIdReadyFactory={onPtyIdReady ? onPtyIdReadyFactory : null}
                  onExitFactory={onExitFactory}
                  renderSplitPane={renderSplitPane}
                />
              );
            }

            return (
              <div
                key={tab.id}
                className={`absolute inset-0 ${
                  isActiveTab
                    ? 'visible z-10'
                    : 'invisible z-0 pointer-events-none'
                }`}
              >
                {tabElement}
              </div>
            );
          });
        })}
      </div>
    </div>
  );
});

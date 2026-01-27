import { useState, useEffect, useRef } from 'react';
import { GitBranch, FolderPlus, Terminal, Keyboard } from 'lucide-react';
import { MainTerminal } from './MainTerminal';
import { DrawerTerminal } from '../Drawer/DrawerTerminal';
import { DiffViewer } from '../DiffViewer';
import { SessionTabBar } from './SessionTabBar';
import { TerminalConfig, ConfigError } from '../../hooks/useConfig';
import { ConfigErrorBanner } from '../ConfigErrorBanner';
import { Session, SessionKind, SessionTab, TabIndicators } from '../../types';

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

export function MainPane({
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

            // Handle notifications - update tab state (effect handles sidebar propagation)
            const handleNotification = (title: string, body: string) => {
              // Update per-tab indicator state
              setTabIndicators((prev) => {
                const current = prev.get(tab.id) ?? { notified: false, thinking: false, idle: false };
                const next = new Map(prev);
                next.set(tab.id, { ...current, notified: true });
                return next;
              });

              // Propagate to sidebar with actual title/body for OS notification
              // (effect handles syncing the notified state, this is for immediate OS notification)
              if (onNotification) {
                onNotification(session.id, tab.id, title, body);
              } else {
                // Legacy handlers
                if (session.kind === 'worktree') {
                  onWorktreeNotification?.(session.id, title, body);
                } else if (session.kind === 'project') {
                  onProjectNotification?.(session.id, title, body);
                } else {
                  onScratchNotification?.(session.id, title, body);
                }
              }
            };

            // Handle thinking changes - update tab state (effect handles sidebar propagation)
            const handleThinkingChange = (isThinking: boolean) => {
              setTabIndicators((prev) => {
                const current = prev.get(tab.id) ?? { notified: false, thinking: false, idle: false };
                const next = new Map(prev);
                if (isThinking) {
                  // Clear idle when thinking starts
                  next.set(tab.id, { ...current, thinking: true, idle: false });
                } else {
                  // Set idle when thinking stops (only if was thinking)
                  next.set(tab.id, { ...current, thinking: false, idle: current.thinking });
                }
                return next;
              });
            };

            // Handle cwd changes - only for scratch terminals
            // Store by tab ID so switching tabs updates the displayed cwd
            const handleCwdChange = session.kind === 'scratch'
              ? (cwd: string) => {
                  if (onCwdChange) {
                    onCwdChange(tab.id, cwd);
                  } else {
                    onScratchCwdChange?.(tab.id, cwd);
                  }
                }
              : undefined;

            // Handle title changes - for tab label updates
            const handleTitleChange = (title: string) => {
              onTabTitleChange?.(session.id, tab.id, title);
            };

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
                  onTitleChange={handleTitleChange}
                  onClose={() => onCloseSessionTab(tab.id)}
                  onPtyIdReady={(ptyId) => onPtyIdReady?.(tab.id, ptyId)}
                />
              );
            } else {
              // Regular terminal tab (MainTerminal)
              tabElement = (
                <MainTerminal
                  entityId={tab.id}
                  sessionId={session.id}
                  type={tab.isPrimary ? terminalType : 'scratch'}
                  isActive={isActiveTab}
                  shouldAutoFocus={isActiveTab && shouldAutoFocus}
                  focusTrigger={isActiveTab ? focusTrigger : undefined}
                  terminalConfig={terminalConfig}
                  activityTimeout={activityTimeout}
                  initialCwd={tab.directory ?? (session.kind === 'scratch' && tab.isPrimary ? session.initialCwd : undefined)}
                  onFocus={() => onFocus(session.id, tab.id)}
                  onNotification={handleNotification}
                  onThinkingChange={handleThinkingChange}
                  onCwdChange={handleCwdChange}
                  onTitleChange={handleTitleChange}
                  onPtyIdReady={(ptyId) => onPtyIdReady?.(tab.id, ptyId)}
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
}

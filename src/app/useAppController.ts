import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { listen } from '@tauri-apps/api/event';
import type { DrawerTab } from '../components/Drawer/Drawer';
import type { FontSettingsPatch } from '../components/Settings/AppearanceSettingsModal';
import { useWorktrees } from '../hooks/useWorktrees';
import { useGitStatus } from '../hooks/useGitStatus';
import { useConfig, getAppCommand } from '../hooks/useConfig';
import { useScratchTerminals } from '../hooks/useScratchTerminals';
import { useIndicators } from '../hooks/useIndicators';
import { useDrawerTabs } from '../hooks/useDrawerTabs';
import { useSessionTabs, SessionTab } from '../hooks/useSessionTabs';
import { useSplitActions } from '../contexts/SplitContext';
import { log } from '../lib/log';
import { selectFolder, shutdown, ptyKill, ptyForceKill, stashChanges, stashPop, reorderProjects, reorderWorktrees, expandActionPrompt, ActionPromptContext, touchProject, updateConfig } from '../lib/tauri';
import { ActionContext, ActionId } from '../lib/actions';
import { useActions, ActionHandlers } from '../hooks/useActions';
import { arrayMove } from '@dnd-kit/sortable';
import { useMappings } from '../hooks/useMappings';
import { createActionHandlers } from '../lib/actionHandlers';
import { copyFromActiveTerminal, pasteToActiveTerminal } from '../lib/terminalRegistry';
import { useAppGlobalBindings } from './useAppGlobalBindings';
import { useAppDerivedState } from './useAppDerivedState';
import { useExpandedProjects } from './useExpandedProjects';
import { buildActionHandlers } from './buildActionHandlers';
import { buildAppLayoutProps } from './buildAppLayoutProps';
import { useCommitModal } from './useCommitModal';
import { Project, Worktree, RunningTask, MergeCompleted, Session, SessionKind, ChangedFilesViewMode } from '../types';
import { useToast } from '../hooks/useToast';
import type { ThemeBorderStyle } from '../theme';

const EXPANDED_PROJECTS_KEY = 'shellflow:expandedProjects';
const SELECTED_TASKS_KEY = 'shellflow:selectedTasks';

// Zoom constants
const ZOOM_STEP = 2; // pixels per zoom level
const MIN_ZOOM = -5; // minimum zoom level
const MAX_ZOOM = 10; // maximum zoom level

// Which pane has focus per worktree
type FocusedPane = 'main' | 'drawer';

// Navigation history entry
type NavHistoryEntry = { worktreeId: string | null; projectId: string | null; scratchId: string | null };

export function useAppController() {
  const {
    projects,
    loading: isProjectsLoading,
    addProject,
    hideProject,
    activateProject,
    createWorktree,
    renameWorktree,
    reorderProjectsOptimistic,
    reorderWorktreesOptimistic,
    refresh: refreshProjects,
  } = useWorktrees();

  // Guard to prevent dialog re-entry when escape key bubbles back from native dialog
  const isAddProjectDialogOpen = useRef(false);

  // Get project path first for config loading (derived below after activeWorktreeId is defined)
  const [activeWorktreeId, setActiveWorktreeId] = useState<string | null>(null);

  // Worktree that should auto-enter edit mode for its name (used with focusNewBranchNames config)
  const [autoEditWorktreeId, setAutoEditWorktreeId] = useState<string | null>(null);
  // Scratch terminal that should enter edit mode for its name (triggered by F2)
  const [editingScratchId, setEditingScratchId] = useState<string | null>(null);
  // Element to restore focus to after editing worktree/scratch name
  const focusToRestoreRef = useRef<HTMLElement | null>(null);

  // Active project (when viewing main repo terminal instead of a worktree)
  // If activeWorktreeId is set, activeProjectId indicates which project's worktree is active
  // If activeWorktreeId is null and activeProjectId is set, we're viewing the project's main terminal
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Navigation history for back/forward navigation
  const [navHistory, setNavHistory] = useState<NavHistoryEntry[]>([]);
  const [navHistoryIndex, setNavHistoryIndex] = useState(-1);

  // Computed: can we go back/forward in history?
  const canGoBack = navHistoryIndex > 0;
  const canGoForward = navHistoryIndex < navHistory.length - 1;

  // Active scratch terminal (when viewing a scratch terminal instead of worktree/project)
  const [activeScratchId, setActiveScratchId] = useState<string | null>(null);

  // Scratch terminals - general-purpose terminals not tied to any project
  const {
    scratchTerminals,
    scratchCwds,
    homeDir,
    addScratchTerminal,
    closeScratchTerminal,
    renameScratchTerminal,
    reorderScratchTerminals,
    updateScratchCwd,
    removeScratchCwd,
  } = useScratchTerminals();

  // Open project terminals (main repo shells are kept alive for these)
  const [openProjectIds, setOpenProjectIds] = useState<Set<string>>(new Set());

  // Derive the project path from the active worktree or project (for config loading)
  const activeProjectPath = useMemo(() => {
    if (activeWorktreeId) {
      for (const project of projects) {
        if (project.worktrees.some(w => w.id === activeWorktreeId)) {
          return project.path;
        }
      }
    } else if (activeProjectId) {
      const project = projects.find(p => p.id === activeProjectId);
      if (project) return project.path;
    }
    return undefined;
  }, [activeWorktreeId, activeProjectId, projects]);

  const { config, errors: configErrors } = useConfig(activeProjectPath);

  // Context-aware keyboard mappings
  const { resolveKeyEvent, getShortcut } = useMappings();

  // Toast notifications
  const { toasts, dismissToast, showError } = useToast();

  // Open worktrees (main terminals are kept alive for these)
  const [openWorktreeIds, setOpenWorktreeIds] = useState<Set<string>>(new Set());

  // Global panel open/closed state (shared across all worktrees)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isDrawerExpanded, setIsDrawerExpanded] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);

  // Changed files mode (uncommitted vs branch)
  const [changedFilesMode, setChangedFilesMode] = useState<ChangedFilesViewMode>('uncommitted');

  // Zoom levels per pane type (not persisted across sessions)
  const [mainZoom, setMainZoom] = useState(0);
  const [drawerZoom, setDrawerZoom] = useState(0);

  // Per-worktree drawer tab state
  const {
    drawerTabs,
    drawerActiveTabIds,
    drawerTabCounters,
    drawerPtyIds,
    setDrawerTabs,
    setDrawerActiveTabIds,
    setDrawerTabCounters,
    setDrawerPtyIds,
    updateTabLabel: updateDrawerTabLabel,
  } = useDrawerTabs();

  // Per-session tab state (main pane tabs)
  const {
    sessionTabs,
    sessionPtyIds: sessionTabPtyIds,
    sessionLastActiveTabIds,
    getTabsForSession,
    getActiveTabIdForSession,
    addTab: addSessionTab,
    removeTab: removeSessionTab,
    setActiveTab: setActiveSessionTab,
    reorderTabs: reorderSessionTabs,
    incrementCounter: incrementSessionCounter,
    setPtyId: setSessionPtyId,
    removePtyId: removeSessionPtyId,
    setLastActiveTabId,
    updateTabLabel: updateSessionTabLabel,
    updateTab: updateSessionTab,
    prevTab: prevSessionTab,
    nextTab: nextSessionTab,
    selectTabByIndex: selectSessionTabByIndex,
    clearSessionTabs,
  } = useSessionTabs();


  // Split layout actions for vim-style pane splits within tabs
  // Using useSplitActions() instead of useSplit() prevents App from re-rendering on split state changes
  const {
    initTab: initSplitTab,
    split: splitPane,
    focusDirection: focusSplitDirection,
    hasSplits: tabHasSplits,
    closePane: closeSplitPane,
    getActivePaneId,
  } = useSplitActions();

  // Per-worktree focus state (which pane has focus)
  const [focusStates, setFocusStates] = useState<Map<string, FocusedPane>>(new Map());

  // Counter to trigger focus on main pane (incremented when focus is explicitly requested)
  const [mainFocusTrigger, setMainFocusTrigger] = useState(0);

  // Per-project selected task (persisted to localStorage)
  const [selectedTasksByProject, setSelectedTasksByProject] = useState<Map<string, string>>(() => {
    try {
      const saved = localStorage.getItem(SELECTED_TASKS_KEY);
      if (saved) {
        return new Map(Object.entries(JSON.parse(saved)));
      }
    } catch (e) {
      console.error('Failed to load selected tasks:', e);
    }
    return new Map();
  });

  // Per-worktree running tasks state (supports multiple tasks per worktree)
  const [runningTasks, setRunningTasks] = useState<Map<string, RunningTask[]>>(new Map());


  // Get current project's selected task
  const activeSelectedTask = activeProjectPath ? selectedTasksByProject.get(activeProjectPath) ?? null : null;

  // Active entity ID - worktree takes precedence, then scratch, then project
  // This allows drawer/focus/task state to work for all views
  const activeEntityId = activeWorktreeId ?? activeScratchId ?? activeProjectId;

  // Track previous view for navigation history
  const prevViewRef = useRef<NavHistoryEntry | null>(null);

  // Push to navigation history when view changes (user-initiated navigation)
  useEffect(() => {
    const currentView: NavHistoryEntry = {
      worktreeId: activeWorktreeId,
      projectId: activeProjectId,
      scratchId: activeScratchId,
    };

    // Only push if this is a meaningful navigation (not initial load and view actually changed)
    const prev = prevViewRef.current;
    if (prev !== null) {
      const viewChanged = prev.worktreeId !== currentView.worktreeId ||
                          prev.projectId !== currentView.projectId ||
                          prev.scratchId !== currentView.scratchId;

      // Check if current is not in history already at current index (avoid duplication from back/forward)
      const currentInHistory = navHistory[navHistoryIndex];
      const isNavigatingHistory = currentInHistory &&
        currentInHistory.worktreeId === currentView.worktreeId &&
        currentInHistory.projectId === currentView.projectId &&
        currentInHistory.scratchId === currentView.scratchId;

      if (viewChanged && !isNavigatingHistory) {
        // This is a user-initiated navigation, push to history
        setNavHistory(prev => {
          const truncated = prev.slice(0, navHistoryIndex + 1);
          return [...truncated, currentView];
        });
        setNavHistoryIndex(prev => prev + 1);
      }
    } else {
      // Initialize history with first view
      if (activeEntityId) {
        setNavHistory([currentView]);
        setNavHistoryIndex(0);
      }
    }

    prevViewRef.current = currentView;
  }, [activeWorktreeId, activeProjectId, activeScratchId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Find the running task that matches the selected task (for TaskSelector controls)
  const activeRunningTask = useMemo(() => {
    if (!activeEntityId || !activeSelectedTask) return null;
    const tasks = runningTasks.get(activeEntityId) ?? [];
    return tasks.find(t => t.taskName === activeSelectedTask) ?? null;
  }, [activeEntityId, activeSelectedTask, runningTasks]);

  // Task statuses map for the active entity (for Drawer tab icons)
  const activeTaskStatuses = useMemo(() => {
    const statuses = new Map<string, { status: 'running' | 'stopping' | 'stopped'; exitCode?: number }>();
    if (!activeEntityId) return statuses;
    const tasks = runningTasks.get(activeEntityId) ?? [];
    for (const task of tasks) {
      statuses.set(task.taskName, { status: task.status, exitCode: task.exitCode });
    }
    return statuses;
  }, [activeEntityId, runningTasks]);

  // Persist selected tasks to localStorage
  useEffect(() => {
    const obj = Object.fromEntries(selectedTasksByProject.entries());
    localStorage.setItem(SELECTED_TASKS_KEY, JSON.stringify(obj));
  }, [selectedTasksByProject]);

  // Get current entity's drawer tabs (works for both worktrees and projects)
  const activeDrawerTabs = activeEntityId ? drawerTabs.get(activeEntityId) ?? [] : [];
  const activeDrawerTabId = activeEntityId ? drawerActiveTabIds.get(activeEntityId) ?? null : null;

  // Get current entity's focus state (defaults to 'main')
  const activeFocusState = activeEntityId ? focusStates.get(activeEntityId) ?? 'main' : 'main';

  // Close drawer and right panel when no entity is active (empty/welcome state)
  useEffect(() => {
    if (!activeEntityId) {
      setIsDrawerOpen(false);
      drawerPanelRef.current?.collapse();
      setIsRightPanelOpen(false);
      rightPanelRef.current?.collapse();
    }
  }, [activeEntityId]);

  // Create a drawer tab when drawer is open but current entity has no tabs
  useEffect(() => {
    if (!activeEntityId || !isDrawerOpen) return;
    if (activeDrawerTabs.length > 0) return;

    const currentCounter = drawerTabCounters.get(activeEntityId) ?? 0;
    const newCounter = currentCounter + 1;
    const newTab: DrawerTab = {
      id: `${activeEntityId}-drawer-${newCounter}`,
      label: `Terminal ${newCounter}`,
      type: 'terminal',
    };

    setDrawerTabs((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId, [newTab]);
      return next;
    });
    setDrawerActiveTabIds((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId, newTab.id);
      return next;
    });
    setDrawerTabCounters((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId, newCounter);
      return next;
    });
  }, [activeEntityId, isDrawerOpen, activeDrawerTabs.length, drawerTabCounters]);

  // Modal state
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingMergeId, setPendingMergeId] = useState<string | null>(null);
  const [pendingStashProject, setPendingStashProject] = useState<Project | null>(null);
  const [pendingCloseProject, setPendingCloseProject] = useState<Project | null>(null);
  const [isTaskSwitcherOpen, setIsTaskSwitcherOpen] = useState(false);
  const [isCommandPaletteOpen, setIsCommandPaletteOpen] = useState(false);
  const [isProjectSwitcherOpen, setIsProjectSwitcherOpen] = useState(false);
  const [isThemeSwitcherOpen, setIsThemeSwitcherOpen] = useState(false);
  const [isAppearanceSettingsOpen, setIsAppearanceSettingsOpen] = useState(false);
  // Runtime border style override (cycles through: theme -> subtle -> visible)
  const [runtimeBorderStyle, setRuntimeBorderStyle] = useState<ThemeBorderStyle | null>(null);
  const [isStashing, setIsStashing] = useState(false);
  const [stashError, setStashError] = useState<string | null>(null);
  const [loadingWorktrees, setLoadingWorktrees] = useState<Set<string>>(new Set());

  // Derive unified sessions from scratch terminals, projects, and worktrees
  const sessions = useMemo((): Session[] => {
    const result: Session[] = [];
    let order = 0;

    // Scratch terminals first
    for (const scratch of scratchTerminals) {
      result.push({
        id: scratch.id,
        kind: 'scratch',
        name: scratch.name,
        path: scratchCwds.get(scratch.id) ?? homeDir ?? '',
        order: order++,
        initialCwd: scratch.initialCwd,
      });
    }

    // Projects and their worktrees (interleaved in sidebar visual order)
    for (const project of projects) {
      if (!project.isActive) continue;

      result.push({
        id: project.id,
        kind: 'project',
        name: project.name,
        path: project.path,
        order: order++,
      });

      for (const worktree of project.worktrees) {
        result.push({
          id: worktree.id,
          kind: 'worktree',
          name: worktree.name,
          path: worktree.path,
          order: order++,
          projectId: project.id,
          branch: worktree.branch,
        });
      }
    }

    return result;
  }, [scratchTerminals, scratchCwds, projects, homeDir]);

  // Derive active session ID and kind (for unified session management)
  const activeSessionId = activeWorktreeId ?? activeScratchId ?? activeProjectId;
  const activeSessionKind: SessionKind | null = useMemo(() => {
    if (activeScratchId) return 'scratch';
    if (activeWorktreeId) return 'worktree';
    if (activeProjectId) return 'project';
    return null;
  }, [activeScratchId, activeWorktreeId, activeProjectId]);

  // Derive open session IDs from open worktrees, projects, and scratch terminals
  const openSessionIds = useMemo((): Set<string> => {
    const result = new Set<string>();
    for (const wid of openWorktreeIds) result.add(wid);
    for (const pid of openProjectIds) result.add(pid);
    for (const scratch of scratchTerminals) result.add(scratch.id);
    return result;
  }, [openWorktreeIds, openProjectIds, scratchTerminals]);

  // Get current session's active tab
  const activeSessionTabId = getActiveTabIdForSession(activeSessionId);
  // Note: sessionLastActiveTabIds is passed directly to MainPane for per-session lookup

  // Compute current diff state (whether viewing a diff and which file)
  const activeDiffState = useMemo(() => {
    if (!activeSessionId || !activeSessionTabId) {
      return { isViewingDiff: false, currentFilePath: null };
    }
    const tabs = getTabsForSession(activeSessionId);
    const activeTab = tabs.find(t => t.id === activeSessionTabId);
    if (activeTab?.diff) {
      return { isViewingDiff: true, currentFilePath: activeTab.diff.filePath };
    }
    return { isViewingDiff: false, currentFilePath: null };
  }, [activeSessionId, activeSessionTabId, getTabsForSession]);

  // Create initial session tab when a session becomes active and has no tabs
  useEffect(() => {
    if (!activeSessionId) return;
    const tabs = getTabsForSession(activeSessionId);
    if (tabs.length > 0) return;

    // Determine terminal type based on session kind
    const session = sessions.find(s => s.id === activeSessionId);
    const type = session?.kind === 'worktree' ? 'main' : session?.kind === 'project' ? 'project' : 'scratch';
    const directory = session?.kind === 'scratch' ? session.initialCwd : undefined;

    // Create the primary tab (runs the configured command)
    const counter = incrementSessionCounter(activeSessionId);
    const newTab: SessionTab = {
      id: `${activeSessionId}-session-${counter}`,
      label: `Terminal ${counter}`,
      isPrimary: true,
    };
    addSessionTab(activeSessionId, newTab);

    // Initialize split state for the new tab
    initSplitTab(newTab.id, { type, directory });
  }, [activeSessionId, sessions, getTabsForSession, incrementSessionCounter, addSessionTab, initSplitTab]);

  // Track last active tab when switching away from a session
  const prevActiveSessionIdRef = useRef<string | null>(null);
  useEffect(() => {
    const prevSessionId = prevActiveSessionIdRef.current;
    if (prevSessionId && prevSessionId !== activeSessionId) {
      // Switching away from prevSessionId, record which tab was active
      const lastTab = getActiveTabIdForSession(prevSessionId);
      if (lastTab) {
        setLastActiveTabId(prevSessionId, lastTab);
      }
    }
    prevActiveSessionIdRef.current = activeSessionId;
  }, [activeSessionId, getActiveTabIdForSession, setLastActiveTabId]);

  // Indicator states for worktrees, projects, and scratch terminals
  const {
    notifiedWorktreeIds,
    thinkingWorktreeIds,
    idleWorktreeIds,
    notifiedProjectIds,
    thinkingProjectIds,
    idleProjectIds,
    notifiedScratchIds,
    thinkingScratchIds,
    idleScratchIds,
    handleWorktreeNotification,
    handleWorktreeThinkingChange,
    handleProjectNotification,
    handleProjectThinkingChange,
    handleScratchNotification,
    handleScratchThinkingChange,
    clearNotification,
  } = useIndicators({
    activeSessionId,
    sessions,
  });
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isModifierKeyHeld, setIsModifierKeyHeld] = useState(false);
  const [isCtrlCmdKeyHeld, setIsCtrlCmdKeyHeld] = useState(false);

  // Track when a picker is open to block global shortcuts
  const isPickerOpen = isTaskSwitcherOpen || isCommandPaletteOpen || isProjectSwitcherOpen || isThemeSwitcherOpen || isAppearanceSettingsOpen;
  // Use a ref so the keyboard handler always sees the current value (no stale closures)
  const isPickerOpenRef = useRef(isPickerOpen);
  isPickerOpenRef.current = isPickerOpen;

  // Legacy modal tracking for components that still use it (confirm dialogs, etc.)
  const onModalOpen = useCallback(() => {}, []);
  const onModalClose = useCallback(() => {}, []);

  // Panel refs
  const rightPanelRef = useRef<PanelImperativeHandle>(null);
  const lastRightPanelSize = useRef<number>(280); // Track last open size in pixels
  const drawerPanelRef = useRef<PanelImperativeHandle>(null);
  const mainPanelRef = useRef<PanelImperativeHandle>(null);
  const lastDrawerSize = useRef<number>(250); // Track last open size in pixels
  const preExpandDrawerSize = useRef<number>(250); // Track drawer size before expansion

  const {
    activeWorktree,
    activeProject,
    getEntityDirectory,
    gitStatusTarget,
    openEntitiesInOrder,
    navigableEntitiesInOrder,
    runningTaskCounts,
  } = useAppDerivedState({
    projects,
    activeWorktreeId,
    activeProjectId,
    scratchTerminals,
    openProjectIds,
    openWorktreeIds,
    runningTasks,
  });

  const getCommitContext = useCallback(() => {
    const repoPath = activeWorktree?.path ?? activeProject?.path;
    if (!repoPath) return null;
    return {
      repoPath,
      projectPath: activeProjectPath ?? activeProject?.path ?? null,
      worktreePath: activeWorktree?.path ?? null,
      worktreeId: activeWorktree?.id ?? null,
    };
  }, [activeWorktree, activeProject, activeProjectPath]);

  const commitModal = useCommitModal({
    getContext: getCommitContext,
    commitConfig: config.commit,
  });

  const { expandedProjects, setExpandedProjects, toggleProject } = useExpandedProjects(EXPANDED_PROJECTS_KEY);


  // Create initial scratch terminal on startup if configured
  const hasCreatedInitialScratch = useRef(false);
  useEffect(() => {
    if (!hasCreatedInitialScratch.current && config.scratch.startOnLaunch && scratchTerminals.length === 0) {
      hasCreatedInitialScratch.current = true;
      const newScratch = addScratchTerminal();
      setActiveScratchId(newScratch.id);
    }
  }, [config.scratch.startOnLaunch, scratchTerminals.length, addScratchTerminal]);

  // Listen for worktree ready events
  useEffect(() => {
    const unlistenReady = listen<{ ptyId: string; worktreeId: string }>(
      'pty-ready',
      (event) => {
        setLoadingWorktrees((prev) => {
          const next = new Set(prev);
          next.delete(event.payload.worktreeId);
          return next;
        });
      }
    );

    return () => {
      unlistenReady.then((fn) => fn());
    };
  }, []);

  // Listen for window close requests - trigger graceful shutdown
  useEffect(() => {
    const unlistenClose = listen('close-requested', async () => {
      // Prevent multiple shutdown attempts
      if (isShuttingDown) return;

      // Start the shutdown process - backend will exit the app when done
      // Returns true if there are processes to clean up (show UI)
      const hasProcesses = await shutdown();
      if (hasProcesses) {
        setIsShuttingDown(true);
      }
      // If no processes, app will exit immediately without showing UI
    });

    return () => {
      unlistenClose.then((fn) => fn());
    };
  }, [isShuttingDown]);

  const { files: changedFiles, isGitRepo, loading: changedFilesLoading, branchInfo } = useGitStatus(
    gitStatusTarget,
    { mode: changedFilesMode, projectPath: activeProject?.path }
  );

  // Show mode toggle only when:
  // 1. Active entity is a worktree (not a project/main repo)
  // 2. The worktree is NOT on the base branch
  const showChangedFilesModeToggle = useMemo(() => {
    return !!activeWorktree && branchInfo && !branchInfo.isOnBaseBranch;
  }, [activeWorktree, branchInfo]);

  // Reset mode to 'uncommitted' when toggle becomes hidden
  useEffect(() => {
    if (!showChangedFilesModeToggle && changedFilesMode !== 'uncommitted') {
      setChangedFilesMode('uncommitted');
    }
  }, [showChangedFilesModeToggle, changedFilesMode]);

  // Handle file click in changed files list - open diff tab (reuse existing diff tab if present)
  const handleFileClick = useCallback((filePath: string) => {
    if (!activeSessionId || !gitStatusTarget) return;

    // Extract just the filename for the tab label
    const fileName = filePath.split('/').pop() ?? filePath;

    // Use a consistent diff tab ID per session
    const diffTabId = `${activeSessionId}-diff`;

    // Check if a diff tab already exists for this session
    const currentTabs = getTabsForSession(activeSessionId);
    const existingDiffTab = currentTabs.find(t => t.id === diffTabId);

    const newDiffConfig = {
      filePath,
      mode: changedFilesMode,
      worktreePath: gitStatusTarget.path,
      projectPath: activeProject?.path,
    };

    if (existingDiffTab) {
      // Update the existing diff tab with the new file
      updateSessionTab(activeSessionId, diffTabId, {
        label: fileName,
        diff: newDiffConfig,
      });
      // Switch to the diff tab
      setActiveSessionTab(activeSessionId, diffTabId);
    } else {
      // Create a new diff tab
      const newTab: SessionTab = {
        id: diffTabId,
        label: fileName,
        isPrimary: false,
        diff: newDiffConfig,
      };
      addSessionTab(activeSessionId, newTab);
    }
  }, [activeSessionId, gitStatusTarget, activeProject, changedFilesMode, getTabsForSession, updateSessionTab, setActiveSessionTab, addSessionTab]);

  // Navigate to next changed file in the diff list
  const handleNextChangedFile = useCallback(() => {
    if (!activeDiffState.isViewingDiff || !activeDiffState.currentFilePath || changedFiles.length === 0) return;

    const currentIndex = changedFiles.findIndex(f => f.path === activeDiffState.currentFilePath);
    if (currentIndex === -1) return;

    const nextIndex = (currentIndex + 1) % changedFiles.length;
    handleFileClick(changedFiles[nextIndex].path);
  }, [activeDiffState, changedFiles, handleFileClick]);

  // Navigate to previous changed file in the diff list
  const handlePrevChangedFile = useCallback(() => {
    if (!activeDiffState.isViewingDiff || !activeDiffState.currentFilePath || changedFiles.length === 0) return;

    const currentIndex = changedFiles.findIndex(f => f.path === activeDiffState.currentFilePath);
    if (currentIndex === -1) return;

    const prevIndex = currentIndex === 0 ? changedFiles.length - 1 : currentIndex - 1;
    handleFileClick(changedFiles[prevIndex].path);
  }, [activeDiffState, changedFiles, handleFileClick]);

  // Open diff view with the first changed file (or switch to existing diff tab)
  const handleOpenDiff = useCallback(() => {
    if (changedFiles.length === 0) return;
    handleFileClick(changedFiles[0].path);
  }, [changedFiles, handleFileClick]);

// Toggle between uncommitted and branch diff mode
  const handleToggleDiffMode = useCallback(() => {
    setChangedFilesMode((prev) => (prev === 'uncommitted' ? 'branch' : 'uncommitted'));
  }, []);

  // Dispatch events to coordinate terminal resize during panel toggle
  const dispatchPanelResize = useCallback((doResize: () => void) => {
    // Notify terminals to capture snapshot before resize
    window.dispatchEvent(new Event('panel-resize-start'));

    // Do the resize
    doResize();

    // After layout settles, notify terminals to refit and remove snapshot
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('panel-resize-complete'));
    });
  }, []);

  // Legacy function for cases that just need the complete event
  const dispatchPanelResizeComplete = useCallback(() => {
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('panel-resize-complete'));
    });
  }, []);

  // Toggle drawer handler (used by both keyboard shortcut and button)
  const handleToggleDrawer = useCallback(() => {
    if (!activeEntityId) return;

    const panel = drawerPanelRef.current;
    const mainPanel = mainPanelRef.current;
    const willOpen = !isDrawerOpen;

    // Wrap panel resize in dispatchPanelResize to prevent visual stretch
    dispatchPanelResize(() => {
      if (panel) {
        if (willOpen) {
          panel.resize(lastDrawerSize.current);
        } else {
          panel.collapse();
          // Restore main panel if it was collapsed due to expansion
          if (isDrawerExpanded && mainPanel) {
            mainPanel.resize(200); // Restore to a reasonable default
          }
          setIsDrawerExpanded(false);
        }
      }
    });

    // Create first tab if opening drawer with no tabs for this entity
    if (willOpen) {
      const currentTabs = drawerTabs.get(activeEntityId) ?? [];
      if (currentTabs.length === 0) {
        const currentCounter = drawerTabCounters.get(activeEntityId) ?? 0;
        const newCounter = currentCounter + 1;
        const newTab: DrawerTab = {
          id: `${activeEntityId}-drawer-${newCounter}`,
          label: `Terminal ${newCounter}`,
          type: 'terminal',
        };
        setDrawerTabs((prev) => {
          const next = new Map(prev);
          next.set(activeEntityId, [newTab]);
          return next;
        });
        setDrawerActiveTabIds((prev) => {
          const next = new Map(prev);
          next.set(activeEntityId, newTab.id);
          return next;
        });
        setDrawerTabCounters((prev) => {
          const next = new Map(prev);
          next.set(activeEntityId, newCounter);
          return next;
        });
      }
    }

    setIsDrawerOpen(willOpen);

    // Focus the drawer when opening, main when closing
    setFocusStates((prev) => {
      const target = willOpen ? 'drawer' : 'main';
      if (prev.get(activeEntityId) === target) return prev;
      const next = new Map(prev);
      next.set(activeEntityId, target);
      return next;
    });

    // Directly focus main terminal when closing drawer
    if (!willOpen) {
      const activePaneId = activeSessionTabId ? getActivePaneId(activeSessionTabId) : null;
      if (activePaneId) {
        const textarea = document.querySelector(
          `[data-terminal-id="${activePaneId}"] textarea.xterm-helper-textarea`
        ) as HTMLTextAreaElement | null;
        textarea?.focus();
      }
    }
  }, [activeEntityId, activeSessionTabId, isDrawerOpen, isDrawerExpanded, drawerTabs, drawerTabCounters, getActivePaneId, dispatchPanelResize]);

  // Toggle drawer expansion handler (maximize/restore within main area)
  const handleToggleDrawerExpand = useCallback(() => {
    if (!activeEntityId || !isDrawerOpen) return;

    const drawerPanel = drawerPanelRef.current;
    if (!drawerPanel) return;

    // Notify terminals to capture snapshot before resize
    window.dispatchEvent(new Event('panel-resize-start'));

    if (isDrawerExpanded) {
      // Restore to previous size
      setIsDrawerExpanded(false);
      // Use setTimeout to let maxSize update before resizing
      setTimeout(() => {
        drawerPanel.resize(preExpandDrawerSize.current);
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event('panel-resize-complete'));
        });
      }, 0);
    } else {
      // Save current size and expand to cover main area
      preExpandDrawerSize.current = lastDrawerSize.current;
      setIsDrawerExpanded(true);
      // Focus the drawer when expanding
      setFocusStates((prev) => {
        if (prev.get(activeEntityId) === 'drawer') return prev;
        const next = new Map(prev);
        next.set(activeEntityId, 'drawer');
        return next;
      });
      // Use setTimeout to let maxSize update before resizing
      setTimeout(() => {
        drawerPanel.resize("100%");
        requestAnimationFrame(() => {
          window.dispatchEvent(new Event('panel-resize-complete'));
        });
      }, 0);
    }
  }, [activeEntityId, isDrawerOpen, isDrawerExpanded]);

  // Toggle right panel handler
  const handleToggleRightPanel = useCallback(() => {
    if (!activeEntityId) return;

    const panel = rightPanelRef.current;
    const willOpen = !isRightPanelOpen;

    // Wrap panel resize in dispatchPanelResize to prevent visual stretch
    dispatchPanelResize(() => {
      if (panel) {
        if (willOpen) {
          panel.resize(lastRightPanelSize.current);
        } else {
          panel.collapse();
        }
      }
    });

    setIsRightPanelOpen(willOpen);
  }, [activeEntityId, isRightPanelOpen, dispatchPanelResize]);


  // Sync state when right panel is collapsed/expanded via dragging
  const handleRightPanelResize = useCallback((size: { inPixels: number }) => {
    // Track last open size (only when not collapsed)
    if (size.inPixels >= 150) {
      lastRightPanelSize.current = size.inPixels;
    }

    const isCollapsed = size.inPixels === 0;
    setIsRightPanelOpen((prev) => {
      if (prev === !isCollapsed) return prev; // No change needed
      return !isCollapsed;
    });
  }, []);

  // Sync state when drawer is collapsed/expanded via dragging
  const handleDrawerResize = useCallback((size: { inPixels: number }) => {
    // Track last open size (only when not collapsed and not in expanded mode)
    if (size.inPixels >= 100 && !isDrawerExpanded) {
      lastDrawerSize.current = size.inPixels;
    }

    const isCollapsed = size.inPixels === 0;
    setIsDrawerOpen((prev) => {
      if (prev === !isCollapsed) return prev; // No change needed
      return !isCollapsed;
    });
  }, [isDrawerExpanded]);

  // Add new drawer tab handler
  const handleAddDrawerTab = useCallback(() => {
    if (!activeEntityId) return;

    const currentCounter = drawerTabCounters.get(activeEntityId) ?? 0;
    const newCounter = currentCounter + 1;
    const newTab: DrawerTab = {
      id: `${activeEntityId}-drawer-${newCounter}`,
      label: `Terminal ${newCounter}`,
      type: 'terminal',
    };

    setDrawerTabs((prev) => {
      const currentTabs = prev.get(activeEntityId) ?? [];
      const next = new Map(prev);
      next.set(activeEntityId, [...currentTabs, newTab]);
      return next;
    });
    setDrawerActiveTabIds((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId, newTab.id);
      return next;
    });
    setDrawerTabCounters((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId, newCounter);
      return next;
    });

    // Focus the drawer when adding a new tab
    setFocusStates((prev) => {
      if (prev.get(activeEntityId) === 'drawer') return prev;
      const next = new Map(prev);
      next.set(activeEntityId, 'drawer');
      return next;
    });
  }, [activeEntityId, drawerTabCounters]);

  // Open a command (like an editor) in the drawer
  const handleOpenInDrawer = useCallback((directory: string, command: string) => {
    if (!activeEntityId) return;

    const currentCounter = drawerTabCounters.get(activeEntityId) ?? 0;
    const newCounter = currentCounter + 1;

    // Extract the command name for the label (e.g., "nvim" from "nvim /path/to/file")
    const cmdName = command.split(' ')[0].split('/').pop() ?? 'Terminal';

    const newTab: DrawerTab = {
      id: `${activeEntityId}-drawer-${newCounter}`,
      label: cmdName,
      type: 'terminal',
      command,
      directory,
    };

    setDrawerTabs((prev) => {
      const currentTabs = prev.get(activeEntityId) ?? [];
      const next = new Map(prev);
      next.set(activeEntityId, [...currentTabs, newTab]);
      return next;
    });
    setDrawerActiveTabIds((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId, newTab.id);
      return next;
    });
    setDrawerTabCounters((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId, newCounter);
      return next;
    });

    // Open the drawer directly (don't use handleToggleDrawer which would create a default tab)
    if (!isDrawerOpen) {
      const panel = drawerPanelRef.current;
      if (panel) {
        panel.resize(lastDrawerSize.current);
      }
      setIsDrawerOpen(true);
      dispatchPanelResizeComplete();
    }
    setFocusStates((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId, 'drawer');
      return next;
    });
  }, [activeEntityId, drawerTabCounters, isDrawerOpen, dispatchPanelResizeComplete]);

  // Open a command (like an editor) in a new session tab
  const handleOpenInTab = useCallback((directory: string, command: string) => {
    if (!activeSessionId) return;

    const counter = incrementSessionCounter(activeSessionId);

    // Extract the command name for the label (e.g., "nvim" from "nvim /path/to/file")
    const cmdName = command.split(' ')[0].split('/').pop() ?? 'Terminal';

    const newTab: SessionTab = {
      id: `${activeSessionId}-session-${counter}`,
      label: cmdName,
      isPrimary: false,
      command,
      directory,
    };

    addSessionTab(activeSessionId, newTab);

    // Focus the main pane
    setFocusStates((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId ?? activeSessionId, 'main');
      return next;
    });
  }, [activeSessionId, activeEntityId, incrementSessionCounter, addSessionTab]);

  // Session tab handlers (main pane tabs)
  const handleAddSessionTab = useCallback(() => {
    if (!activeSessionId) return;

    // Determine the working directory for the new tab:
    // - For project/worktree sessions: always use the project/worktree path
    // - For scratch sessions: use the current tab's cwd (inherited from active tab)
    let directory: string | undefined;
    if (activeSessionKind === 'scratch') {
      // For scratch, inherit the current tab's cwd
      directory = activeSessionTabId ? scratchCwds.get(activeSessionTabId) : undefined;
    } else {
      // For project/worktree, always use the entity's path
      directory = getEntityDirectory(activeSessionId);
    }

    const counter = incrementSessionCounter(activeSessionId);
    const newTab: SessionTab = {
      id: `${activeSessionId}-session-${counter}`,
      label: `Terminal ${counter}`,
      isPrimary: false, // Additional tabs are not primary (run shell, not configured command)
      directory,
    };
    addSessionTab(activeSessionId, newTab);

    // Initialize split state for the new tab (non-primary tabs always use 'scratch' type for shell)
    initSplitTab(newTab.id, { type: 'scratch', directory });
  }, [activeSessionId, activeSessionKind, activeSessionTabId, scratchCwds, getEntityDirectory, incrementSessionCounter, addSessionTab, initSplitTab]);

  // Will be defined after close handlers - just a placeholder reference for now
  const handleCloseSessionTabRef = useRef<(tabId: string) => void>(() => {});
  const handleCloseCurrentSessionRef = useRef<() => void>(() => {});

  const handleSelectSessionTab = useCallback((tabId: string) => {
    if (!activeSessionId) return;
    setActiveSessionTab(activeSessionId, tabId);
  }, [activeSessionId, setActiveSessionTab]);

  const handleReorderSessionTabs = useCallback((oldIndex: number, newIndex: number) => {
    if (!activeSessionId) return;
    reorderSessionTabs(activeSessionId, oldIndex, newIndex);
  }, [activeSessionId, reorderSessionTabs]);

  const handleRenameSessionTab = useCallback((tabId: string, newLabel: string) => {
    if (!activeSessionId) return;
    const trimmed = newLabel.trim();
    const tabs = getTabsForSession(activeSessionId);
    const tab = tabs.find((t) => t.id === tabId);
    if (!tab) return;
    const nextCustomLabel = trimmed.length === 0 || trimmed === tab.label ? undefined : trimmed;
    if (tab.customLabel === nextCustomLabel) return;
    updateSessionTab(activeSessionId, tabId, { customLabel: nextCustomLabel });
  }, [activeSessionId, getTabsForSession, updateSessionTab]);

  const handlePrevSessionTab = useCallback(() => {
    if (!activeSessionId) return;
    prevSessionTab(activeSessionId);
  }, [activeSessionId, prevSessionTab]);

  const handleNextSessionTab = useCallback(() => {
    if (!activeSessionId) return;
    nextSessionTab(activeSessionId);
  }, [activeSessionId, nextSessionTab]);

  const handleSelectSessionTabByIndex = useCallback((index: number) => {
    if (!activeSessionId) return;
    selectSessionTabByIndex(activeSessionId, index);
  }, [activeSessionId, selectSessionTabByIndex]);

  // Trigger an action for a worktree (creates action tab in drawer)
  const handleTriggerAction = useCallback(async (
    worktreeId: string,
    projectPath: string,
    actionType: string,
    context: ActionPromptContext
  ) => {
    try {
      // Expand the prompt using the backend
      const expandedPrompt = await expandActionPrompt(actionType, context, projectPath);

      // Generate a unique tab ID
      const currentCounter = drawerTabCounters.get(worktreeId) ?? 0;
      const newCounter = currentCounter + 1;
      const tabId = `${worktreeId}-action-${newCounter}`;

      // Create the action tab
      const newTab: DrawerTab = {
        id: tabId,
        label: 'Resolve Conflicts',
        type: 'action',
        actionType,
        actionPrompt: expandedPrompt,
        mergeOptions: context.mergeOptions,
        strategy: context.strategy,
      };

      // Add the tab
      setDrawerTabs((prev) => {
        const currentTabs = prev.get(worktreeId) ?? [];
        const next = new Map(prev);
        next.set(worktreeId, [...currentTabs, newTab]);
        return next;
      });

      // Update counter
      setDrawerTabCounters((prev) => {
        const next = new Map(prev);
        next.set(worktreeId, newCounter);
        return next;
      });

      // Set active tab
      setDrawerActiveTabIds((prev) => {
        const next = new Map(prev);
        next.set(worktreeId, tabId);
        return next;
      });

      // Open drawer and focus it
      if (!isDrawerOpen) {
        drawerPanelRef.current?.resize(lastDrawerSize.current);
        setIsDrawerOpen(true);
      }
      setFocusStates((prev) => {
        const next = new Map(prev);
        next.set(worktreeId, 'drawer');
        return next;
      });

      // Switch to the worktree if not already active
      if (activeWorktreeId !== worktreeId) {
        setActiveWorktreeId(worktreeId);
        // Also open the worktree if not open
        setOpenWorktreeIds((prev) => {
          if (prev.has(worktreeId)) return prev;
          const next = new Set(prev);
          next.add(worktreeId);
          return next;
        });
      }
    } catch (err) {
      console.error('Failed to trigger action:', err);
    }
  }, [drawerTabCounters, activeWorktreeId, isDrawerOpen]);

  // Select drawer tab handler
  const handleSelectDrawerTab = useCallback((tabId: string) => {
    if (!activeEntityId) return;
    setDrawerActiveTabIds((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId, tabId);
      return next;
    });
    // Also set focus to drawer when clicking a tab
    setFocusStates((prev) => {
      if (prev.get(activeEntityId) === 'drawer') return prev;
      const next = new Map(prev);
      next.set(activeEntityId, 'drawer');
      return next;
    });
  }, [activeEntityId]);

  // Close drawer tab handler
  const handleCloseDrawerTab = useCallback((tabId: string, entityId?: string) => {
    const targetEntityId = entityId ?? activeEntityId;
    if (!targetEntityId) return;

    // Kill the PTY for this tab if it exists (for terminal tabs)
    const ptyId = drawerPtyIds.get(tabId);
    if (ptyId) {
      ptyKill(ptyId);
      setDrawerPtyIds((prev) => {
        const next = new Map(prev);
        next.delete(tabId);
        return next;
      });
    }

    const currentTabs = drawerTabs.get(targetEntityId) ?? [];
    const remaining = currentTabs.filter(t => t.id !== tabId);

    // If closing the last tab for the active entity, collapse the drawer panel and focus main
    if (remaining.length === 0 && targetEntityId === activeEntityId) {
      drawerPanelRef.current?.collapse();
      // Restore main panel if it was collapsed due to expansion
      if (isDrawerExpanded) {
        mainPanelRef.current?.resize(200);
        setIsDrawerExpanded(false);
      }
      setIsDrawerOpen(false);
      // Focus back to main pane when closing last drawer tab
      setFocusStates((prev) => {
        if (prev.get(targetEntityId) === 'main') return prev;
        const next = new Map(prev);
        next.set(targetEntityId, 'main');
        return next;
      });
      // Directly focus main terminal
      const activePaneId = activeSessionTabId ? getActivePaneId(activeSessionTabId) : null;
      if (activePaneId) {
        const textarea = document.querySelector(
          `[data-terminal-id="${activePaneId}"] textarea.xterm-helper-textarea`
        ) as HTMLTextAreaElement | null;
        textarea?.focus();
      }
    }

    setDrawerTabs((prev) => {
      const next = new Map(prev);
      next.set(targetEntityId, remaining);
      return next;
    });

    // Update active tab if needed
    const currentActiveTabId = drawerActiveTabIds.get(targetEntityId);
    if (currentActiveTabId === tabId && remaining.length > 0) {
      setDrawerActiveTabIds((prev) => {
        const next = new Map(prev);
        next.set(targetEntityId, remaining[remaining.length - 1].id);
        return next;
      });
    } else if (remaining.length === 0) {
      setDrawerActiveTabIds((prev) => {
        const next = new Map(prev);
        next.delete(targetEntityId);
        return next;
      });
    }
  }, [activeEntityId, activeSessionTabId, isDrawerExpanded, drawerTabs, drawerActiveTabIds, drawerPtyIds, getActivePaneId]);

  // Register drawer terminal PTY ID
  const handleDrawerPtyIdReady = useCallback((tabId: string, ptyId: string) => {
    setDrawerPtyIds((prev) => {
      const next = new Map(prev);
      next.set(tabId, ptyId);
      return next;
    });
  }, []);

  // Reorder drawer tabs handler
  const handleReorderDrawerTabs = useCallback((oldIndex: number, newIndex: number) => {
    if (!activeEntityId) return;

    setDrawerTabs((prev) => {
      const tabs = prev.get(activeEntityId);
      if (!tabs) return prev;

      const reordered = arrayMove(tabs, oldIndex, newIndex);
      const next = new Map(prev);
      next.set(activeEntityId, reordered);
      return next;
    });
  }, [activeEntityId]);

  // Reorder projects handler - optimistic update for smooth DnD
  const handleReorderProjects = useCallback((projectIds: string[]) => {
    // Optimistic: update local state immediately
    reorderProjectsOptimistic(projectIds);
    // Persist to backend (fire-and-forget, no need to await refresh since we already updated locally)
    reorderProjects(projectIds).catch((err) => {
      console.error('Failed to reorder projects:', err);
      // On error, refresh to get actual server state
      refreshProjects();
    });
  }, [reorderProjectsOptimistic, refreshProjects]);

  // Reorder worktrees handler - optimistic update for smooth DnD
  const handleReorderWorktrees = useCallback((projectId: string, worktreeIds: string[]) => {
    // Optimistic: update local state immediately
    reorderWorktreesOptimistic(projectId, worktreeIds);
    // Persist to backend (fire-and-forget)
    reorderWorktrees(projectId, worktreeIds).catch((err) => {
      console.error('Failed to reorder worktrees:', err);
      // On error, refresh to get actual server state
      refreshProjects();
    });
  }, [reorderWorktreesOptimistic, refreshProjects]);

  // Focus state handlers - track which pane has focus per worktree
  const handleMainPaneFocused = useCallback((worktreeId: string) => {
    setFocusStates((prev) => {
      if (prev.get(worktreeId) === 'main') return prev;
      const next = new Map(prev);
      next.set(worktreeId, 'main');
      return next;
    });
  }, []);

  const handleDrawerFocused = useCallback((worktreeId: string) => {
    setFocusStates((prev) => {
      if (prev.get(worktreeId) === 'drawer') return prev;
      const next = new Map(prev);
      next.set(worktreeId, 'drawer');
      return next;
    });
  }, []);

  // Focus main pane of the currently active entity
  const handleFocusMain = useCallback(() => {
    const entityId = activeWorktreeId ?? activeScratchId ?? activeProjectId;
    if (entityId) {
      setFocusStates((prev) => {
        if (prev.get(entityId) === 'main') return prev;
        const next = new Map(prev);
        next.set(entityId, 'main');
        return next;
      });
      // Always increment trigger to ensure focus happens even if state was already 'main'
      setMainFocusTrigger((prev) => prev + 1);
    }
  }, [activeWorktreeId, activeScratchId, activeProjectId]);

  // Switch focus between main and drawer panes
  const handleSwitchFocus = useCallback(() => {
    if (!activeEntityId) {
      log.info('[handleSwitchFocus] No active entity, aborting');
      return;
    }

    const currentFocus = focusStates.get(activeEntityId) ?? 'main';
    const newFocus = currentFocus === 'main' ? 'drawer' : 'main';
    log.info('[handleSwitchFocus] Switching focus', { activeEntityId, currentFocus, newFocus, isDrawerOpen });

    // If switching to drawer and it's not open, open it
    if (newFocus === 'drawer' && !isDrawerOpen) {
      const panel = drawerPanelRef.current;
      if (panel) {
        panel.resize(lastDrawerSize.current);
      }

      // Create first tab if none exist
      const currentTabs = drawerTabs.get(activeEntityId) ?? [];
      if (currentTabs.length === 0) {
        const currentCounter = drawerTabCounters.get(activeEntityId) ?? 0;
        const newCounter = currentCounter + 1;
        const newTab: DrawerTab = {
          id: `${activeEntityId}-drawer-${newCounter}`,
          label: `Terminal ${newCounter}`,
          type: 'terminal',
        };
        setDrawerTabs((prev) => {
          const next = new Map(prev);
          next.set(activeEntityId, [newTab]);
          return next;
        });
        setDrawerActiveTabIds((prev) => {
          const next = new Map(prev);
          next.set(activeEntityId, newTab.id);
          return next;
        });
        setDrawerTabCounters((prev) => {
          const next = new Map(prev);
          next.set(activeEntityId, newCounter);
          return next;
        });
      }

      setIsDrawerOpen(true);
      dispatchPanelResizeComplete();
    }

    setFocusStates((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId, newFocus);
      return next;
    });

    // Focus the terminal textarea directly (must be synchronous to preserve user gesture context)
    if (newFocus === 'drawer') {
      log.info('[handleSwitchFocus] Focusing drawer');
      const activeTabId = drawerActiveTabIds.get(activeEntityId) ?? drawerTabs.get(activeEntityId)?.[0]?.id;
      if (activeTabId) {
        const textarea = document.querySelector(
          `[data-terminal-id="${activeTabId}"] textarea.xterm-helper-textarea`
        ) as HTMLTextAreaElement | null;
        log.info('[handleSwitchFocus] Drawer textarea', { activeTabId, found: !!textarea });
        textarea?.focus();
      }
    } else {
      log.info('[handleSwitchFocus] Focusing main');
      // Get the active pane ID from the split state
      const activePaneId = activeSessionTabId ? getActivePaneId(activeSessionTabId) : null;
      if (activePaneId) {
        const textarea = document.querySelector(
          `[data-terminal-id="${activePaneId}"] textarea.xterm-helper-textarea`
        ) as HTMLTextAreaElement | null;
        log.info('[handleSwitchFocus] Main textarea', { activePaneId, found: !!textarea });
        textarea?.focus();
      }
    }
  }, [activeEntityId, activeSessionTabId, focusStates, isDrawerOpen, drawerTabs, drawerTabCounters, drawerActiveTabIds, getActivePaneId, dispatchPanelResizeComplete]);

  // Navigate back in history (Cmd+[)
  const handleNavigateBack = useCallback(() => {
    if (!canGoBack) return;

    const targetIndex = navHistoryIndex - 1;
    const targetEntry = navHistory[targetIndex];
    if (!targetEntry) return;

    // Validate target is still valid
    const { worktreeId, projectId, scratchId } = targetEntry;

    if (worktreeId && openWorktreeIds.has(worktreeId)) {
      setActiveWorktreeId(worktreeId);
      setActiveScratchId(null);
      if (projectId) setActiveProjectId(projectId);
      setNavHistoryIndex(targetIndex);
    } else if (scratchId && scratchTerminals.some(s => s.id === scratchId)) {
      setActiveWorktreeId(null);
      setActiveProjectId(null);
      setActiveScratchId(scratchId);
      setNavHistoryIndex(targetIndex);
    } else if (projectId && openProjectIds.has(projectId)) {
      setActiveWorktreeId(null);
      setActiveScratchId(null);
      setActiveProjectId(projectId);
      setNavHistoryIndex(targetIndex);
    }
    // If target is invalid, don't navigate
  }, [canGoBack, navHistoryIndex, navHistory, openWorktreeIds, openProjectIds, scratchTerminals]);

  // Navigate forward in history (Cmd+])
  const handleNavigateForward = useCallback(() => {
    if (!canGoForward) return;

    const targetIndex = navHistoryIndex + 1;
    const targetEntry = navHistory[targetIndex];
    if (!targetEntry) return;

    // Validate target is still valid
    const { worktreeId, projectId, scratchId } = targetEntry;

    if (worktreeId && openWorktreeIds.has(worktreeId)) {
      setActiveWorktreeId(worktreeId);
      setActiveScratchId(null);
      if (projectId) setActiveProjectId(projectId);
      setNavHistoryIndex(targetIndex);
    } else if (scratchId && scratchTerminals.some(s => s.id === scratchId)) {
      setActiveWorktreeId(null);
      setActiveProjectId(null);
      setActiveScratchId(scratchId);
      setNavHistoryIndex(targetIndex);
    } else if (projectId && openProjectIds.has(projectId)) {
      setActiveWorktreeId(null);
      setActiveScratchId(null);
      setActiveProjectId(projectId);
      setNavHistoryIndex(targetIndex);
    }
    // If target is invalid, don't navigate
  }, [canGoForward, navHistoryIndex, navHistory, openWorktreeIds, openProjectIds, scratchTerminals]);

  // Zoom handlers
  const handleZoomIn = useCallback(() => {
    if (activeFocusState === 'drawer') {
      setDrawerZoom(z => Math.min(z + 1, MAX_ZOOM));
    } else {
      setMainZoom(z => Math.min(z + 1, MAX_ZOOM));
    }
  }, [activeFocusState]);

  const handleZoomOut = useCallback(() => {
    if (activeFocusState === 'drawer') {
      setDrawerZoom(z => Math.max(z - 1, MIN_ZOOM));
    } else {
      setMainZoom(z => Math.max(z - 1, MIN_ZOOM));
    }
  }, [activeFocusState]);

  const handleZoomReset = useCallback(() => {
    if (activeFocusState === 'drawer') {
      setDrawerZoom(0);
    } else {
      setMainZoom(0);
    }
  }, [activeFocusState]);

  const handleUpdateConfig = useCallback((patch: Record<string, unknown>) => {
    updateConfig(patch).catch((err) => {
      console.error('Failed to update config:', err);
    });
  }, []);

  const handleThemeChange = useCallback((themeName: string) => {
    handleUpdateConfig({ theme: themeName });
  }, [handleUpdateConfig]);

  const handleBorderStyleChange = useCallback((style: ThemeBorderStyle) => {
    setRuntimeBorderStyle(style);
    handleUpdateConfig({ themeBorderStyle: style });
  }, [handleUpdateConfig]);

  const handleFontSettingsChange = useCallback((patch: FontSettingsPatch) => {
    const mainPatch: Record<string, unknown> = {};
    if (patch.fontFamily !== undefined) mainPatch.fontFamily = patch.fontFamily;
    if (patch.fontSize !== undefined) mainPatch.fontSize = patch.fontSize;
    if (patch.fontLigatures !== undefined) mainPatch.fontLigatures = patch.fontLigatures;
    if (patch.webgl !== undefined) mainPatch.webgl = patch.webgl;

    if (Object.keys(mainPatch).length === 0) return;

    handleUpdateConfig({
      main: mainPatch,
      drawer: mainPatch,
    });
  }, [handleUpdateConfig]);

  // Cycle through border styles: theme -> subtle -> visible -> theme
  const handleCycleBorderStyle = useCallback(() => {
    const current = runtimeBorderStyle ?? config.themeBorderStyle ?? 'subtle';
    const next: ThemeBorderStyle = current === 'theme' ? 'subtle' : current === 'subtle' ? 'visible' : 'theme';
    handleBorderStyleChange(next);
  }, [runtimeBorderStyle, config.themeBorderStyle, handleBorderStyleChange]);

  // Effective border style (runtime override or config)
  const effectiveBorderStyle = runtimeBorderStyle ?? config.themeBorderStyle ?? 'subtle';

  // Adjusted terminal configs with zoom applied
  const mainTerminalConfig = useMemo(() => ({
    ...config.main,
    fontSize: config.main.fontSize + (mainZoom * ZOOM_STEP),
  }), [config.main, mainZoom]);

  const drawerTerminalConfig = useMemo(() => ({
    ...config.drawer,
    fontSize: config.drawer.fontSize + (drawerZoom * ZOOM_STEP),
  }), [config.drawer, drawerZoom]);

  // Task handlers
  const handleSelectTask = useCallback((taskName: string) => {
    if (!activeProjectPath) return;
    setSelectedTasksByProject((prev) => {
      const next = new Map(prev);
      next.set(activeProjectPath, taskName);
      return next;
    });
  }, [activeProjectPath]);

  const handleStartTask = useCallback(async (taskNameOverride?: string) => {
    const taskName = taskNameOverride ?? activeSelectedTask;
    console.log('[handleStartTask] Called with:', { taskNameOverride, activeSelectedTask, taskName, activeEntityId });
    if (!activeEntityId || !taskName) {
      console.log('[handleStartTask] Early return: missing activeEntityId or taskName');
      return;
    }

    // Find the task config to get the kind
    const task = config.tasks.find((t) => t.name === taskName);
    console.log('[handleStartTask] Found task config:', task, 'from tasks:', config.tasks);
    if (!task) {
      console.log('[handleStartTask] Early return: task not found in config');
      return;
    }

    // Check if this task is already running
    const entityTasks = runningTasks.get(activeEntityId) ?? [];
    const existingTask = entityTasks.find(t => t.taskName === taskName && t.status === 'running');
    if (existingTask) {
      // Task is already running, just switch to its tab (if not silent)
      if (!task.silent) {
        const tabId = `${activeEntityId}-task-${taskName}`;
        setDrawerActiveTabIds((prev) => {
          const next = new Map(prev);
          next.set(activeEntityId, tabId);
          return next;
        });
        if (!isDrawerOpen) {
          drawerPanelRef.current?.resize(lastDrawerSize.current);
          setIsDrawerOpen(true);
        }
      }
      return;
    }

    // For silent tasks, spawn directly without UI but still track it
    if (task.silent) {
      const { spawnTask } = await import('../lib/tauri');
      try {
        const ptyId = await spawnTask(activeEntityId, taskName);
        // Track the silent task so we can stop it
        setRunningTasks((prev) => {
          const next = new Map(prev);
          const existing = prev.get(activeEntityId) ?? [];
          // Remove any stopped instance of this task, add new running one
          const filtered = existing.filter(t => t.taskName !== taskName || t.status === 'running');
          next.set(activeEntityId, [...filtered, { taskName, ptyId, kind: task.kind ?? 'command', status: 'running', worktreeId: activeEntityId }]);
          return next;
        });
      } catch (err) {
        console.error('Failed to start silent task:', err);
      }
      return;
    }

    // Create a new task tab with unique ID (allows restart)
    const tabId = `${activeEntityId}-task-${taskName}-${Date.now()}`;
    const newTab: DrawerTab = {
      id: tabId,
      label: taskName,
      type: 'task',
      taskName,
    };

    // Remove any existing tab for this task, then add new one
    setDrawerTabs((prev) => {
      const currentTabs = prev.get(activeEntityId) ?? [];
      // Remove old task tab if exists (any tab with same taskName)
      const filteredTabs = currentTabs.filter((t) => t.taskName !== taskName);
      const next = new Map(prev);
      next.set(activeEntityId, [...filteredTabs, newTab]);
      return next;
    });
    setDrawerActiveTabIds((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId, tabId);
      return next;
    });

    // Open drawer if not already open
    if (!isDrawerOpen) {
      drawerPanelRef.current?.resize(lastDrawerSize.current);
      setIsDrawerOpen(true);
    }

    // Mark task as running (ptyId will be set by TaskTerminal)
    setRunningTasks((prev) => {
      const next = new Map(prev);
      const existing = prev.get(activeEntityId) ?? [];
      // Remove any stopped instance of this task, add new running one
      const filtered = existing.filter(t => t.taskName !== taskName || t.status === 'running');
      next.set(activeEntityId, [...filtered, { taskName, ptyId: '', kind: task.kind ?? 'command', status: 'running', worktreeId: activeEntityId }]);
      return next;
    });

    // Focus the drawer
    setFocusStates((prev) => {
      const next = new Map(prev);
      next.set(activeEntityId, 'drawer');
      return next;
    });
  }, [activeEntityId, activeSelectedTask, config.tasks, isDrawerOpen, runningTasks]);

  const handleStopTask = useCallback(() => {
    if (!activeEntityId || !activeSelectedTask) return;

    const entityTasks = runningTasks.get(activeEntityId) ?? [];
    const taskToStop = entityTasks.find(t => t.taskName === activeSelectedTask && t.status === 'running');
    if (!taskToStop) return;

    console.log('[handleStopTask] taskToStop:', taskToStop);

    // Kill the PTY if we have an ID
    if (taskToStop.ptyId) {
      console.log('[handleStopTask] Killing PTY:', taskToStop.ptyId);
      // Notify terminal about the signal
      window.dispatchEvent(new CustomEvent('pty-signal', {
        detail: { ptyId: taskToStop.ptyId, signal: 'SIGTERM' }
      }));
      ptyKill(taskToStop.ptyId);
    } else {
      console.warn('[handleStopTask] No ptyId available!');
    }

    // Mark task as stopping (not stopped yet - waiting for process to exit)
    setRunningTasks((prev) => {
      const next = new Map(prev);
      const existing = prev.get(activeEntityId) ?? [];
      const updated = existing.map(t =>
        t.taskName === activeSelectedTask && t.status === 'running'
          ? { ...t, status: 'stopping' as const }
          : t
      );
      next.set(activeEntityId, updated);
      return next;
    });
  }, [activeEntityId, activeSelectedTask, runningTasks]);

  const handleForceKillTask = useCallback(() => {
    console.log('[handleForceKillTask] Called with:', { activeEntityId, activeSelectedTask });
    if (!activeEntityId || !activeSelectedTask) {
      console.log('[handleForceKillTask] Early return: missing activeEntityId or activeSelectedTask');
      return;
    }

    const entityTasks = runningTasks.get(activeEntityId) ?? [];
    const taskToKill = entityTasks.find(t => t.taskName === activeSelectedTask && t.status === 'stopping');
    console.log('[handleForceKillTask] entityTasks:', entityTasks, 'taskToKill:', taskToKill);
    if (!taskToKill) {
      console.log('[handleForceKillTask] Early return: no task with status "stopping" found');
      return;
    }

    // Force kill the PTY with SIGKILL
    if (taskToKill.ptyId) {
      console.log('[handleForceKillTask] Calling ptyForceKill with ptyId:', taskToKill.ptyId);
      // Notify terminal about the signal
      window.dispatchEvent(new CustomEvent('pty-signal', {
        detail: { ptyId: taskToKill.ptyId, signal: 'SIGKILL' }
      }));
      ptyForceKill(taskToKill.ptyId);
    } else {
      console.log('[handleForceKillTask] No ptyId on task!');
    }

    // Immediately update state since force kill is guaranteed to terminate
    // Exit code 137 = 128 + 9 (SIGKILL)
    setRunningTasks((prev) => {
      const next = new Map(prev);
      const existing = prev.get(activeEntityId) ?? [];
      const updated = existing.map(t =>
        t.taskName === activeSelectedTask ? { ...t, status: 'stopped' as const, exitCode: 137 } : t
      );
      next.set(activeEntityId, updated);
      return next;
    });
  }, [activeEntityId, activeSelectedTask, runningTasks]);

  // Toggle task: run if not running, stop if running, force kill if stopping
  const handleToggleTask = useCallback(() => {
    if (!activeEntityId || !activeSelectedTask) return;

    const entityTasks = runningTasks.get(activeEntityId) ?? [];
    const runningTask = entityTasks.find(t => t.taskName === activeSelectedTask);
    if (runningTask?.status === 'running') {
      handleStopTask();
    } else if (runningTask?.status === 'stopping') {
      handleForceKillTask();
    } else {
      handleStartTask();
    }
  }, [activeEntityId, activeSelectedTask, runningTasks, handleStartTask, handleStopTask, handleForceKillTask]);

  // Task switcher handlers
  const handleToggleTaskSwitcher = useCallback(() => {
    if (!activeEntityId || config.tasks.length === 0) return;
    setIsTaskSwitcherOpen(prev => {
      if (!prev) {
        // Close other pickers when opening
        setIsCommandPaletteOpen(false);
        setIsProjectSwitcherOpen(false);
        setIsThemeSwitcherOpen(false);
        setIsAppearanceSettingsOpen(false);
      }
      return !prev;
    });
  }, [activeEntityId, config.tasks.length]);

  // Command palette handlers
  const handleToggleCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(prev => {
      if (!prev) {
        // Close other pickers when opening
        setIsTaskSwitcherOpen(false);
        setIsProjectSwitcherOpen(false);
        setIsThemeSwitcherOpen(false);
        setIsAppearanceSettingsOpen(false);
      }
      return !prev;
    });
  }, []);

  // Project switcher handlers
  const handleToggleProjectSwitcher = useCallback(() => {
    setIsProjectSwitcherOpen(prev => {
      if (!prev) {
        // Close other pickers when opening
        setIsTaskSwitcherOpen(false);
        setIsCommandPaletteOpen(false);
        setIsThemeSwitcherOpen(false);
        setIsAppearanceSettingsOpen(false);
      }
      return !prev;
    });
  }, []);

  const handleOpenCommitModal = useCallback(() => {
    const opened = commitModal.open();
    if (!opened) {
      showError('当前没有可提交的仓库。');
    }
  }, [commitModal, showError]);

  const handleOpenAppearanceSettings = useCallback(() => {
    setIsAppearanceSettingsOpen(true);
    setIsTaskSwitcherOpen(false);
    setIsCommandPaletteOpen(false);
    setIsProjectSwitcherOpen(false);
    setIsThemeSwitcherOpen(false);
  }, []);

  const handleCloseAppearanceSettings = useCallback(() => {
    setIsAppearanceSettingsOpen(false);
  }, []);

  const handleOpenThemeSwitcher = useCallback(() => {
    setIsThemeSwitcherOpen(true);
    setIsTaskSwitcherOpen(false);
    setIsCommandPaletteOpen(false);
    setIsProjectSwitcherOpen(false);
    setIsAppearanceSettingsOpen(false);
  }, []);

  const handleProjectSwitcherSelect = useCallback(async (projectId: string) => {
    const project = projects.find(p => p.id === projectId);
    if (!project) return;

    // Update last accessed time (also reactivates closed projects on backend)
    await touchProject(projectId);

    // Optimistically update local state to mirror backend (sets isActive = true)
    activateProject(projectId);

    // Navigate to the project
    setOpenProjectIds((prev) => {
      if (prev.has(projectId)) return prev;
      return new Set([...prev, projectId]);
    });
    setActiveWorktreeId(null);
    setActiveScratchId(null);
    setActiveProjectId(projectId);
    setIsProjectSwitcherOpen(false);

    // Expand the project in the sidebar
    setExpandedProjects((prev) => new Set([...prev, projectId]));
  }, [projects, activateProject]);

  const handleTaskExit = useCallback((worktreeId: string, taskName: string, exitCode: number) => {
    setRunningTasks((prev) => {
      const existing = prev.get(worktreeId);
      if (!existing) return prev;
      const next = new Map(prev);
      const updated = existing.map(t =>
        t.taskName === taskName ? { ...t, status: 'stopped' as const, exitCode } : t
      );
      next.set(worktreeId, updated);
      return next;
    });
  }, []);

  const handleTaskPtyIdReady = useCallback((worktreeId: string, taskName: string, ptyId: string) => {
    console.log('[handleTaskPtyIdReady] worktreeId:', worktreeId, 'taskName:', taskName, 'ptyId:', ptyId);
    setRunningTasks((prev) => {
      const existing = prev.get(worktreeId);
      if (!existing) return prev;
      const next = new Map(prev);
      // Find the task with matching name that doesn't have a ptyId yet
      const updated = existing.map(t =>
        t.taskName === taskName && !t.ptyId ? { ...t, ptyId } : t
      );
      next.set(worktreeId, updated);
      return next;
    });
  }, []);

  // Global listener for pty-exit events (handles silent tasks and force kills)
  useEffect(() => {
    let unlisten: (() => void) | null = null;

    listen<{ ptyId: string; exitCode: number }>('pty-exit', (event) => {
      // Find which worktree/task this ptyId belongs to and update status
      setRunningTasks((prev) => {
        for (const [worktreeId, tasks] of prev.entries()) {
          const taskIndex = tasks.findIndex(t => t.ptyId === event.payload.ptyId);
          if (taskIndex !== -1) {
            const next = new Map(prev);
            const updated = [...tasks];
            updated[taskIndex] = { ...updated[taskIndex], status: 'stopped', exitCode: event.payload.exitCode };
            next.set(worktreeId, updated);
            return next;
          }
        }
        return prev;
      });
    }).then((fn) => {
      unlisten = fn;
    });

    return () => {
      unlisten?.();
    };
  }, []);

  // Worktree handlers
  const handleRefreshProjects = useCallback(() => {
    void refreshProjects({ syncFromGit: true });
  }, [refreshProjects]);

  const handleAddProject = useCallback(async () => {
    // Prevent re-entry when escape key bubbles back from native dialog
    if (isAddProjectDialogOpen.current) {
      return;
    }
    isAddProjectDialogOpen.current = true;
    try {
      const path = await selectFolder();
      if (path) {
        try {
          const project = await addProject(path);
          // Ensure project is marked as active in backend state
          await touchProject(project.id);
          setExpandedProjects((prev) => new Set([...prev, project.id]));
          // Activate the newly added project immediately
          setOpenProjectIds((prev) => new Set([...prev, project.id]));
          setActiveWorktreeId(null);
          setActiveProjectId(project.id);
        } catch (err) {
          console.error('Failed to add project:', err);
        }
      }
    } finally {
      isAddProjectDialogOpen.current = false;
    }
  }, [addProject]);

  const handleAddWorktree = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) {
        return;
      }
      setExpandedProjects((prev) => new Set([...prev, projectId]));

      try {
        const worktree = await createWorktree(project.path);
        setLoadingWorktrees((prev) => new Set([...prev, worktree.id]));
        setOpenWorktreeIds((prev) => new Set([...prev, worktree.id]));
        setActiveWorktreeId(worktree.id);
        setActiveScratchId(null);
        // Auto-focus branch name for editing if configured
        if (config.worktree.focusNewBranchNames) {
          // For new worktrees, don't set a focusToRestoreRef - the worktree didn't exist before,
          // so there's no valid prior focus within it. We'll fall back to onFocusMain().
          focusToRestoreRef.current = null;
          setAutoEditWorktreeId(worktree.id);
        }
      } catch (err) {
        const errorMessage = String(err);
        // Check if this is an uncommitted changes error
        if (errorMessage.includes('uncommitted changes')) {
          setStashError(null); // Clear any previous error
          setPendingStashProject(project);
        } else {
          console.error('Failed to create worktree:', err);
          showError(`Failed to create worktree: ${errorMessage}`);
        }
      }
    },
    [projects, createWorktree, config.worktree.focusNewBranchNames, showError]
  );

  const handleStashAndCreate = useCallback(async () => {
    if (!pendingStashProject) return;

    const project = pendingStashProject;
    setIsStashing(true);

    let stashId: string | null = null;

    try {
      // Stash the changes and get the stash ID
      stashId = await stashChanges(project.path);

      // Create the worktree
      const worktree = await createWorktree(project.path);
      setActiveScratchId(null);

      // Pop the stash to restore changes
      await stashPop(project.path, stashId);

      // Update UI state
      setLoadingWorktrees((prev) => new Set([...prev, worktree.id]));
      setOpenWorktreeIds((prev) => new Set([...prev, worktree.id]));
      setActiveWorktreeId(worktree.id);
      setPendingStashProject(null);
      // Auto-focus branch name for editing if configured
      if (config.worktree.focusNewBranchNames) {
        // For new worktrees, don't set a focusToRestoreRef - the worktree didn't exist before,
        // so there's no valid prior focus within it. We'll fall back to onFocusMain().
        focusToRestoreRef.current = null;
        setAutoEditWorktreeId(worktree.id);
      }
    } catch (err) {
      console.error('[handleStashAndCreate] Failed:', err);
      setStashError(String(err));
      // Try to restore the stash if worktree creation failed
      if (stashId) {
        try {
          await stashPop(project.path, stashId);
        } catch {
          // Stash pop might fail if we never stashed successfully
        }
      }
    } finally {
      setIsStashing(false);
    }
  }, [pendingStashProject, createWorktree, config.worktree.focusNewBranchNames]);

  const handleCancelStash = useCallback(() => {
    setPendingStashProject(null);
    setStashError(null);
  }, []);

  const handleSelectWorktree = useCallback((worktree: Worktree) => {
    // Mark the project as active and auto-open its project terminal
    const project = projects.find((p) => p.worktrees.some((w) => w.id === worktree.id));
    if (project) {
      // Update last accessed timestamp
      touchProject(project.id).catch(() => {});
      // Navigation history is handled by the useEffect that tracks view changes
      setActiveProjectId(project.id);
      // Auto-open project terminal so cmd+0 can switch to it
      setOpenProjectIds((prev) => {
        if (prev.has(project.id)) return prev;
        return new Set([...prev, project.id]);
      });
      // Expand the project in the sidebar
      setExpandedProjects((prev) => new Set([...prev, project.id]));
    }
    setOpenWorktreeIds((prev) => {
      if (prev.has(worktree.id)) return prev;
      return new Set([...prev, worktree.id]);
    });
    setActiveWorktreeId(worktree.id);
    setActiveScratchId(null);
  }, [projects]);

  const handleSelectProject = useCallback((project: Project) => {
    // Update last accessed timestamp
    touchProject(project.id).catch(() => {});
    // Add to open projects if not already
    setOpenProjectIds((prev) => {
      if (prev.has(project.id)) return prev;
      return new Set([...prev, project.id]);
    });
    // Navigation history is handled by the useEffect that tracks view changes
    // Clear worktree and scratch selection, set project as active
    setActiveWorktreeId(null);
    setActiveScratchId(null);
    setActiveProjectId(project.id);
    // Expand the project in the sidebar
    setExpandedProjects((prev) => new Set([...prev, project.id]));
  }, []);

  // Scratch terminal handlers
  const handleAddScratchTerminal = useCallback(() => {
    // Get the cwd of the currently active scratch tab (if any) to start the new terminal there
    const currentCwd = activeScratchId && activeSessionTabId
      ? scratchCwds.get(activeSessionTabId)
      : undefined;
    const newScratch = addScratchTerminal(currentCwd);
    // Navigation history is handled by the useEffect that tracks view changes
    // Select the new scratch terminal
    setActiveWorktreeId(null);
    setActiveProjectId(null);
    setActiveScratchId(newScratch.id);
  }, [addScratchTerminal, activeScratchId, activeSessionTabId, scratchCwds]);

  const handleSelectScratch = useCallback((scratchId: string) => {
    // Navigation history is handled by the useEffect that tracks view changes
    setActiveWorktreeId(null);
    setActiveProjectId(null);
    setActiveScratchId(scratchId);
  }, []);

  const handleCloseScratch = useCallback((scratchId: string) => {
    // Clean up cwds for all tabs in this scratch session (cwds are keyed by tab ID)
    const tabs = getTabsForSession(scratchId);
    for (const tab of tabs) {
      removeScratchCwd(tab.id);
    }
    // Close the scratch terminal (removes from list)
    closeScratchTerminal(scratchId);
    // Clean up drawer tabs and focus state for this scratch terminal
    setDrawerTabs((prev) => {
      const next = new Map(prev);
      next.delete(scratchId);
      return next;
    });
    setDrawerActiveTabIds((prev) => {
      const next = new Map(prev);
      next.delete(scratchId);
      return next;
    });
    setDrawerTabCounters((prev) => {
      const next = new Map(prev);
      next.delete(scratchId);
      return next;
    });
    setFocusStates((prev) => {
      const next = new Map(prev);
      next.delete(scratchId);
      return next;
    });
    // If this was the active scratch terminal, switch to another entity
    if (activeScratchId === scratchId) {
      const remainingScratch = scratchTerminals.filter((s) => s.id !== scratchId);
      if (remainingScratch.length > 0) {
        setActiveScratchId(remainingScratch[remainingScratch.length - 1].id);
      } else if (openWorktreeIds.size > 0) {
        // Switch to an open worktree
        const firstWorktreeId = Array.from(openWorktreeIds)[0];
        setActiveWorktreeId(firstWorktreeId);
        setActiveScratchId(null);
        // Find and set the project for this worktree
        for (const project of projects) {
          if (project.worktrees.some(w => w.id === firstWorktreeId)) {
            setActiveProjectId(project.id);
            break;
          }
        }
      } else if (openProjectIds.size > 0) {
        setActiveScratchId(null);
        setActiveProjectId(Array.from(openProjectIds)[0]);
      } else {
        setActiveScratchId(null);
      }
    }
  }, [closeScratchTerminal, activeScratchId, scratchTerminals, openWorktreeIds, openProjectIds, projects, getTabsForSession, removeScratchCwd]);

  const handleRenameScratch = useCallback((scratchId: string, newName: string) => {
    renameScratchTerminal(scratchId, newName);
  }, [renameScratchTerminal]);

  // Handle cwd change for scratch terminal tabs (keyed by tab ID, not session ID)
  const handleScratchCwdChange = useCallback((tabId: string, cwd: string) => {
    updateScratchCwd(tabId, cwd);
  }, [updateScratchCwd]);

  const handleReorderScratchTerminals = useCallback((scratchIds: string[]) => {
    reorderScratchTerminals(scratchIds);
  }, [reorderScratchTerminals]);

  // Show confirmation modal before closing a project
  const handleCloseProject = useCallback((projectOrId: Project | string) => {
    const project = typeof projectOrId === 'string'
      ? projects.find(p => p.id === projectOrId)
      : projectOrId;
    if (!project) return;
    setPendingCloseProject(project);
  }, [projects]);

  // Actually close the project (called after confirmation)
  // "Close" means: dispose sessions and collapse in sidebar (project remains visible)
  // This does NOT hide the project - use hideProject for that
  const confirmCloseProject = useCallback(async () => {
    const project = pendingCloseProject;
    if (!project) return;

    setPendingCloseProject(null);

    try {
      const projectWorktreeIds = new Set(project.worktrees.map((w) => w.id));

      // Collapse the project in the sidebar
      setExpandedProjects((prev) => {
        const next = new Set(prev);
        next.delete(project.id);
        return next;
      });

      // Clean up UI state for project's worktrees (AFTER backend call completes)
      setOpenWorktreeIds((prev) => {
        const next = new Set(prev);
        for (const id of projectWorktreeIds) {
          next.delete(id);
        }
        return next;
      });
      setDrawerTabs((prev) => {
        const next = new Map(prev);
        for (const id of projectWorktreeIds) {
          next.delete(id);
        }
        // Also clean up project-level drawer tabs
        next.delete(project.id);
        return next;
      });
      setDrawerActiveTabIds((prev) => {
        const next = new Map(prev);
        for (const id of projectWorktreeIds) {
          next.delete(id);
        }
        next.delete(project.id);
        return next;
      });
      setDrawerTabCounters((prev) => {
        const next = new Map(prev);
        for (const id of projectWorktreeIds) {
          next.delete(id);
        }
        next.delete(project.id);
        return next;
      });
      setFocusStates((prev) => {
        const next = new Map(prev);
        for (const id of projectWorktreeIds) {
          next.delete(id);
        }
        next.delete(project.id);
        return next;
      });

      // Clean up session tabs and kill PTYs for the closed project and its worktrees
      // This ensures we don't leave orphan PTYs running
      const sessionIdsToClose = [project.id, ...projectWorktreeIds];
      for (const sessionId of sessionIdsToClose) {
        const tabs = getTabsForSession(sessionId);
        for (const tab of tabs) {
          const ptyId = sessionTabPtyIds.get(tab.id);
          if (ptyId) {
            ptyKill(ptyId);
            removeSessionPtyId(tab.id);
          }
        }
        clearSessionTabs(sessionId);
      }

      // Close from open projects
      setOpenProjectIds((prev) => {
        const next = new Set(prev);
        next.delete(project.id);
        return next;
      });

      // Update active selection if needed - IMPORTANT: select a replacement BEFORE clearing
      // to avoid a render cycle where activeSessionId is null (which unmounts all terminals)
      const needsNewSelection =
        (activeWorktreeId && projectWorktreeIds.has(activeWorktreeId)) ||
        (activeProjectId === project.id);

      if (needsNewSelection) {
        // Find the remaining open projects (excluding the one we're closing)
        const remainingProjects = Array.from(openProjectIds).filter(id => id !== project.id);
        // Find the remaining open worktrees (excluding ones from the closed project)
        const remainingWorktrees = Array.from(openWorktreeIds).filter(id => !projectWorktreeIds.has(id));

        // Priority: first remaining worktree, then remaining project, then scratch terminal
        if (remainingWorktrees.length > 0) {
          setActiveWorktreeId(remainingWorktrees[0]);
          // Find the project that owns this worktree
          const owningProject = projects.find(p =>
            p.worktrees.some(w => w.id === remainingWorktrees[0])
          );
          if (owningProject) {
            setActiveProjectId(owningProject.id);
          }
        } else if (remainingProjects.length > 0) {
          setActiveWorktreeId(null);
          setActiveProjectId(remainingProjects[0]);
        } else if (scratchTerminals.length > 0) {
          setActiveWorktreeId(null);
          setActiveProjectId(null);
          setActiveScratchId(scratchTerminals[0].id);
        } else {
          setActiveWorktreeId(null);
          setActiveProjectId(null);
          setActiveScratchId(null);
        }
      }

      // Close drawer and right panel when no entities remain open
      const remainingOpenWorktrees = Array.from(openWorktreeIds).filter(
        id => !projectWorktreeIds.has(id)
      );
      const remainingOpenProjects = Array.from(openProjectIds).filter(
        id => id !== project.id
      );
      if (remainingOpenWorktrees.length === 0 && remainingOpenProjects.length === 0 && scratchTerminals.length === 0) {
        setIsDrawerOpen(false);
        drawerPanelRef.current?.collapse();
        setIsRightPanelOpen(false);
        rightPanelRef.current?.collapse();
      }
    } catch (err) {
      console.error('Failed to close project:', err);
    }
  }, [pendingCloseProject, activeWorktreeId, activeProjectId, openWorktreeIds, openProjectIds, scratchTerminals, projects, getTabsForSession, sessionTabPtyIds, removeSessionPtyId, clearSessionTabs]);

  // Hide a project - removes from sidebar but keeps in project list
  // This first closes the project (disposes sessions), then hides it
  const handleHideProject = useCallback(async (projectOrId: Project | string) => {
    const project = typeof projectOrId === 'string'
      ? projects.find(p => p.id === projectOrId)
      : projectOrId;
    if (!project) return;

    // First close the project (dispose sessions, clean up UI)
    // We do this inline rather than calling handleCloseProject to avoid the confirmation modal
    const projectWorktreeIds = new Set(project.worktrees.map((w) => w.id));

    // Clean up UI state
    setOpenWorktreeIds((prev) => {
      const next = new Set(prev);
      for (const id of projectWorktreeIds) {
        next.delete(id);
      }
      return next;
    });
    setDrawerTabs((prev) => {
      const next = new Map(prev);
      for (const id of projectWorktreeIds) {
        next.delete(id);
      }
      next.delete(project.id);
      return next;
    });
    setDrawerActiveTabIds((prev) => {
      const next = new Map(prev);
      for (const id of projectWorktreeIds) {
        next.delete(id);
      }
      next.delete(project.id);
      return next;
    });
    setDrawerTabCounters((prev) => {
      const next = new Map(prev);
      for (const id of projectWorktreeIds) {
        next.delete(id);
      }
      next.delete(project.id);
      return next;
    });
    setFocusStates((prev) => {
      const next = new Map(prev);
      for (const id of projectWorktreeIds) {
        next.delete(id);
      }
      next.delete(project.id);
      return next;
    });

    // Kill PTYs
    const sessionIdsToClose = [project.id, ...projectWorktreeIds];
    for (const sessionId of sessionIdsToClose) {
      const tabs = getTabsForSession(sessionId);
      for (const tab of tabs) {
        const ptyId = sessionTabPtyIds.get(tab.id);
        if (ptyId) {
          ptyKill(ptyId);
          removeSessionPtyId(tab.id);
        }
      }
      clearSessionTabs(sessionId);
    }

    // Remove from open projects
    setOpenProjectIds((prev) => {
      const next = new Set(prev);
      next.delete(project.id);
      return next;
    });

    // Update active selection if needed
    const needsNewSelection =
      (activeWorktreeId && projectWorktreeIds.has(activeWorktreeId)) ||
      (activeProjectId === project.id);

    if (needsNewSelection) {
      const remainingProjects = Array.from(openProjectIds).filter(id => id !== project.id);
      const remainingWorktrees = Array.from(openWorktreeIds).filter(id => !projectWorktreeIds.has(id));

      if (remainingWorktrees.length > 0) {
        setActiveWorktreeId(remainingWorktrees[0]);
        const owningProject = projects.find(p => p.worktrees.some(w => w.id === remainingWorktrees[0]));
        if (owningProject) {
          setActiveProjectId(owningProject.id);
        }
      } else if (remainingProjects.length > 0) {
        setActiveWorktreeId(null);
        setActiveProjectId(remainingProjects[0]);
      } else if (scratchTerminals.length > 0) {
        setActiveWorktreeId(null);
        setActiveProjectId(null);
        setActiveScratchId(scratchTerminals[0].id);
      } else {
        setActiveWorktreeId(null);
        setActiveProjectId(null);
        setActiveScratchId(null);
      }
    }

    // Close panels if nothing remains
    const remainingOpenWorktrees = Array.from(openWorktreeIds).filter(id => !projectWorktreeIds.has(id));
    const remainingOpenProjects = Array.from(openProjectIds).filter(id => id !== project.id);
    if (remainingOpenWorktrees.length === 0 && remainingOpenProjects.length === 0 && scratchTerminals.length === 0) {
      setIsDrawerOpen(false);
      drawerPanelRef.current?.collapse();
      setIsRightPanelOpen(false);
      rightPanelRef.current?.collapse();
    }

    // Now hide via backend (sets isActive = false)
    await hideProject(project.id);
  }, [projects, activeWorktreeId, activeProjectId, openWorktreeIds, openProjectIds, scratchTerminals, getTabsForSession, sessionTabPtyIds, removeSessionPtyId, clearSessionTabs, hideProject]);

  const handleCloseWorktree = useCallback(
    (worktreeId: string) => {
      setOpenWorktreeIds((prev) => {
        const next = new Set(prev);
        next.delete(worktreeId);
        return next;
      });
      // Clean up drawer tabs and focus state for this worktree
      setDrawerTabs((prev) => {
        const next = new Map(prev);
        next.delete(worktreeId);
        return next;
      });
      setDrawerActiveTabIds((prev) => {
        const next = new Map(prev);
        next.delete(worktreeId);
        return next;
      });
      setDrawerTabCounters((prev) => {
        const next = new Map(prev);
        next.delete(worktreeId);
        return next;
      });
      setFocusStates((prev) => {
        const next = new Map(prev);
        next.delete(worktreeId);
        return next;
      });
      if (activeWorktreeId === worktreeId) {
        const remaining = Array.from(openWorktreeIds).filter(id => id !== worktreeId);
        setActiveWorktreeId(remaining.length > 0 ? remaining[remaining.length - 1] : null);
        // Close drawer and right panel when no worktrees remain
        if (remaining.length === 0) {
          setIsDrawerOpen(false);
          drawerPanelRef.current?.collapse();
          setIsRightPanelOpen(false);
          rightPanelRef.current?.collapse();
        }
      }
    },
    [activeWorktreeId, openWorktreeIds]
  );

  const handleDeleteWorktree = useCallback((worktreeId: string) => {
    setPendingDeleteId(worktreeId);
  }, []);

  const handleDeleteComplete = useCallback(
    (worktreeId: string) => {
      // Clean up UI state (backend already deleted the worktree)
      setOpenWorktreeIds((prev) => {
        const next = new Set(prev);
        next.delete(worktreeId);
        return next;
      });
      // Clean up drawer tabs and focus state for this worktree
      setDrawerTabs((prev) => {
        const next = new Map(prev);
        next.delete(worktreeId);
        return next;
      });
      setDrawerActiveTabIds((prev) => {
        const next = new Map(prev);
        next.delete(worktreeId);
        return next;
      });
      setDrawerTabCounters((prev) => {
        const next = new Map(prev);
        next.delete(worktreeId);
        return next;
      });
      setFocusStates((prev) => {
        const next = new Map(prev);
        next.delete(worktreeId);
        return next;
      });
      if (activeWorktreeId === worktreeId) {
        const remaining = Array.from(openWorktreeIds).filter(id => id !== worktreeId);
        setActiveWorktreeId(remaining.length > 0 ? remaining[remaining.length - 1] : null);
        // Close drawer and right panel when no worktrees remain
        if (remaining.length === 0) {
          setIsDrawerOpen(false);
          drawerPanelRef.current?.collapse();
          setIsRightPanelOpen(false);
          rightPanelRef.current?.collapse();
        }
      }

      // Refresh projects list to reflect the deletion
      refreshProjects();
      setPendingDeleteId(null);
    },
    [activeWorktreeId, openWorktreeIds, projects, refreshProjects]
  );


  const handleMergeWorktree = useCallback((worktreeId: string) => {
    setPendingMergeId(worktreeId);
  }, []);

  const handleRenameBranch = useCallback((worktreeId: string) => {
    focusToRestoreRef.current = document.activeElement as HTMLElement | null;
    setAutoEditWorktreeId(worktreeId);
  }, []);

  const handleMergeComplete = useCallback(
    (worktreeId: string, deletedWorktree: boolean) => {
      if (deletedWorktree) {
        setOpenWorktreeIds((prev) => {
          const next = new Set(prev);
          next.delete(worktreeId);
          return next;
        });
        if (activeWorktreeId === worktreeId) {
          const remaining = Array.from(openWorktreeIds).filter(id => id !== worktreeId);
          setActiveWorktreeId(remaining.length > 0 ? remaining[remaining.length - 1] : null);
        }
        refreshProjects();
      }
      setPendingMergeId(null);
    },
    [activeWorktreeId, openWorktreeIds, refreshProjects]
  );

  // Listen for merge-completed events (from action terminal's "Complete" button)
  useEffect(() => {
    const unlistenMerge = listen<MergeCompleted>('merge-completed', (event) => {
      const { worktreeId, success, deletedWorktree } = event.payload;

      if (success) {
        // Update UI state
        handleMergeComplete(worktreeId, deletedWorktree);

        // Close any action tabs for this worktree
        const tabs = drawerTabs.get(worktreeId) ?? [];
        const actionTab = tabs.find(t => t.type === 'action');
        if (actionTab) {
          handleCloseDrawerTab(actionTab.id, worktreeId);
        }
      }
    });

    return () => {
      unlistenMerge.then((fn) => fn());
    };
  }, [handleMergeComplete, drawerTabs, handleCloseDrawerTab]);

  // Session tab close handlers (defined here so they can reference close handlers above)
  const handleCloseCurrentSession = useCallback(() => {
    if (activeScratchId) {
      handleCloseScratch(activeScratchId);
    } else if (activeWorktreeId) {
      handleCloseWorktree(activeWorktreeId);
    } else if (activeProjectId) {
      handleCloseProject(activeProjectId);
    }
  }, [activeScratchId, activeWorktreeId, activeProjectId, handleCloseScratch, handleCloseWorktree, handleCloseProject]);

  const handleCloseSessionTab = useCallback((tabId: string) => {
    if (!activeSessionId) return;

    const tabs = getTabsForSession(activeSessionId);
    const remaining = tabs.filter(t => t.id !== tabId);

    // If closing the last tab, close the entire session instead
    // Don't kill PTY here - handleCloseCurrentSession may show a confirmation modal
    // and we don't want to kill the PTY until confirmed
    if (remaining.length === 0) {
      handleCloseCurrentSession();
      return;
    }

    // Kill the PTY for this tab if it exists
    const ptyId = sessionTabPtyIds.get(tabId);
    if (ptyId) {
      ptyKill(ptyId);
      removeSessionPtyId(tabId);
    }

    // Clean up cwd for scratch terminal tabs (cwds are keyed by tab ID)
    if (activeScratchId) {
      removeScratchCwd(tabId);
    }

    removeSessionTab(activeSessionId, tabId);
  }, [activeSessionId, activeScratchId, getTabsForSession, sessionTabPtyIds, removeSessionTab, removeSessionPtyId, removeScratchCwd, handleCloseCurrentSession]);

  // Update refs so callbacks in earlier code can use these
  useEffect(() => {
    handleCloseSessionTabRef.current = handleCloseSessionTab;
    handleCloseCurrentSessionRef.current = handleCloseCurrentSession;
  }, [handleCloseSessionTab, handleCloseCurrentSession]);

  // === Action System ===
  // Build the context that determines action availability
  const actionContext: ActionContext = useMemo(() => ({
    activeProjectId,
    activeWorktreeId,
    activeScratchId,
    activeEntityId,
    isDrawerOpen,
    isDrawerFocused: activeFocusState === 'drawer',
    activeDrawerTabId,
    openEntityCount: openEntitiesInOrder.length,
    canGoBack,
    canGoForward,
    activeSelectedTask,
    taskCount: config.tasks.length,
    isViewingDiff: activeDiffState.isViewingDiff,
    changedFilesCount: changedFiles.length,
    hasSplits: activeSessionTabId ? tabHasSplits(activeSessionTabId) : false,
  }), [activeProjectId, activeWorktreeId, activeScratchId, activeEntityId, isDrawerOpen, activeFocusState, activeDrawerTabId, openEntitiesInOrder.length, canGoBack, canGoForward, activeSelectedTask, config.tasks.length, activeDiffState.isViewingDiff, changedFiles.length, activeSessionTabId, tabHasSplits]);

  // Dynamic labels for command palette based on configured apps and state
  const commandPaletteLabelOverrides = useMemo(() => {
    const overrides: Partial<Record<ActionId, string>> = {};

    const fileManagerCommand = getAppCommand(config.apps.fileManager);
    const terminalCommand = getAppCommand(config.apps.terminal);
    const editorCommand = getAppCommand(config.apps.editor);

    if (fileManagerCommand) {
      overrides['app::openInFinder'] = `Open in ${fileManagerCommand}`;
    }
    if (terminalCommand) {
      overrides['app::openInTerminal'] = `Open in ${terminalCommand}`;
    }
    if (editorCommand) {
      overrides['app::openInEditor'] = `Open in ${editorCommand}`;
    }

    // Show current and next border style
    const nextStyle: Record<ThemeBorderStyle, ThemeBorderStyle> = {
      theme: 'subtle',
      subtle: 'visible',
      visible: 'theme',
    };
    overrides['view::cycleBorderStyle'] = `Border Style: ${effectiveBorderStyle} → ${nextStyle[effectiveBorderStyle]}`;

    return overrides;
  }, [config.apps.fileManager, config.apps.terminal, config.apps.editor, effectiveBorderStyle]);

  // Helper to get current entity index in openEntitiesInOrder
  const getCurrentEntityIndex = useCallback(() => {
    const currentEntityId = activeWorktreeId ?? activeScratchId ?? (activeProjectId && !activeWorktreeId ? activeProjectId : null);
    const currentEntityType = activeWorktreeId ? 'worktree' : activeScratchId ? 'scratch' : activeProjectId ? 'project' : null;
    return currentEntityId && currentEntityType
      ? openEntitiesInOrder.findIndex(e => e.id === currentEntityId && e.type === currentEntityType)
      : -1;
  }, [activeWorktreeId, activeScratchId, activeProjectId, openEntitiesInOrder]);

  // Helper to select an entity at a given index
  const selectEntityAtIndex = useCallback((index: number) => {
    const entity = openEntitiesInOrder[index];
    if (!entity) return;
    if (entity.type === 'scratch') {
      setActiveWorktreeId(null);
      setActiveProjectId(null);
      setActiveScratchId(entity.id);
    } else if (entity.type === 'project') {
      setActiveWorktreeId(null);
      setActiveScratchId(null);
      setActiveProjectId(entity.id);
    } else {
      // For worktrees, also set the project context
      const project = projects.find(p => p.worktrees.some(w => w.id === entity.id));
      if (project) {
        setActiveProjectId(project.id);
      }
      setActiveWorktreeId(entity.id);
      setActiveScratchId(null);
    }
  }, [openEntitiesInOrder, projects]);

  // Build the handlers for each action (namespaced format)
  const actionHandlers: ActionHandlers = useMemo(() => buildActionHandlers({
    activeProjectId,
    activeWorktreeId,
    activeScratchId,
    activeDrawerTabId,
    activeFocusState,
    isDrawerOpen,
    activeEntityId,
    projects,
    scratchCwds,
    appsConfig: config.apps,
    openEntitiesInOrder,
    getCurrentEntityIndex,
    selectEntityAtIndex,
    focusToRestoreRef,
    setEditingScratchId,
    setIsDrawerOpen,
    handleRefreshProjects,
    handleAddProject,
    handleToggleProjectSwitcher,
    handleOpenCommitModal,
    handleAddWorktree,
    handleAddScratchTerminal,
    handleAddSessionTab,
    handleCloseDrawerTab,
    handleCloseScratch,
    handleCloseWorktree,
    handleCloseProject,
    handleAddDrawerTab,
    handleOpenInDrawer,
    handleOpenInTab,
    handleOpenThemeSwitcher,
    handleToggleCommandPalette,
    handleToggleDrawer,
    handleToggleDrawerExpand,
    handleToggleRightPanel,
    handleCycleBorderStyle,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    handleNavigateBack,
    handleNavigateForward,
    handleSwitchFocus,
    handleRenameBranch,
    handleMergeWorktree,
    handleDeleteWorktree,
    handleToggleTask,
    handleToggleTaskSwitcher,
    handleOpenDiff,
    handleNextChangedFile,
    handlePrevChangedFile,
    handleToggleDiffMode,
  }), [
    activeProjectId, activeWorktreeId, activeScratchId, activeDrawerTabId, isDrawerOpen, activeFocusState,
    projects, config.apps, activeEntityId, scratchCwds,
    handleRefreshProjects, handleAddProject, handleAddWorktree, handleAddScratchTerminal, handleCloseDrawerTab, handleCloseProject,
    handleAddDrawerTab, handleOpenInDrawer, handleOpenInTab, handleAddSessionTab,
    handleCloseWorktree, handleCloseScratch,
    handleToggleDrawer, handleToggleDrawerExpand, handleToggleRightPanel, handleToggleProjectSwitcher,
    handleOpenThemeSwitcher, handleOpenCommitModal,
    handleZoomIn, handleZoomOut, handleZoomReset, handleCycleBorderStyle, handleNavigateBack, handleNavigateForward, handleSwitchFocus,
    handleRenameBranch, handleMergeWorktree, handleDeleteWorktree, handleToggleTask, handleToggleTaskSwitcher,
    handleOpenDiff, handleNextChangedFile, handlePrevChangedFile, handleToggleDiffMode,
    getCurrentEntityIndex, selectEntityAtIndex,
  ]);

  // The action system hook
  const actions = useActions(actionContext, actionHandlers);
  // Ref for menu listener to avoid re-subscribing on every actions change
  const executeByMenuIdRef = useRef(actions.executeByMenuId);
  executeByMenuIdRef.current = actions.executeByMenuId;

  // Context-aware action handlers (new system)
  const contextActionHandlers = useMemo(() => createActionHandlers({
    // Drawer actions
    onCloseDrawerTab: () => activeDrawerTabId && handleCloseDrawerTab(activeDrawerTabId),
    onToggleDrawer: handleToggleDrawer,
    onExpandDrawer: handleToggleDrawerExpand,
    onPrevDrawerTab: () => {
      if (isDrawerOpen && activeDrawerTabs.length > 1) {
        const currentIndex = activeDrawerTabs.findIndex(tab => tab.id === activeDrawerTabId);
        if (currentIndex !== -1) {
          const prevIndex = currentIndex === 0 ? activeDrawerTabs.length - 1 : currentIndex - 1;
          handleSelectDrawerTab(activeDrawerTabs[prevIndex].id);
        }
      }
    },
    onNextDrawerTab: () => {
      if (isDrawerOpen && activeDrawerTabs.length > 1) {
        const currentIndex = activeDrawerTabs.findIndex(tab => tab.id === activeDrawerTabId);
        if (currentIndex !== -1) {
          const nextIndex = currentIndex === activeDrawerTabs.length - 1 ? 0 : currentIndex + 1;
          handleSelectDrawerTab(activeDrawerTabs[nextIndex].id);
        }
      }
    },
    onAddDrawerTab: handleAddDrawerTab,
    onSelectDrawerTab: (index: number) => {
      if (isDrawerOpen && index < activeDrawerTabs.length) {
        handleSelectDrawerTab(activeDrawerTabs[index].id);
      }
    },

    // Session tab actions (main pane tabs)
    onNewSessionTab: handleAddSessionTab,
    onCloseSessionTab: () => activeSessionTabId && handleCloseSessionTab(activeSessionTabId),
    onCloseSession: handleCloseCurrentSession,
    onPrevSessionTab: handlePrevSessionTab,
    onNextSessionTab: handleNextSessionTab,
    onSelectSessionTab: handleSelectSessionTabByIndex,

    // Scratch actions
    onCloseScratch: () => activeScratchId && handleCloseScratch(activeScratchId),
    onNewScratch: handleAddScratchTerminal,
    onRenameSession: () => {
      if (activeScratchId) {
        focusToRestoreRef.current = document.activeElement as HTMLElement | null;
        setEditingScratchId(activeScratchId);
      }
    },

    // Worktree actions
    onCloseWorktree: () => activeWorktreeId && handleCloseWorktree(activeWorktreeId),
    onNewWorktree: () => activeProjectId && handleAddWorktree(activeProjectId),
    onRenameBranch: () => {
      if (activeWorktreeId) {
        focusToRestoreRef.current = document.activeElement as HTMLElement | null;
        setAutoEditWorktreeId(activeWorktreeId);
      }
    },

    // Project actions
    onCloseProject: () => activeProjectId && handleCloseProject(activeProjectId),
    onRefreshProjects: handleRefreshProjects,

    // Navigation actions
    onNavigatePrev: () => actionHandlers['navigate::prev']?.(),
    onNavigateNext: () => actionHandlers['navigate::next']?.(),
    onNavigateBack: handleNavigateBack,
    onNavigateForward: handleNavigateForward,
    onNavigateToProject: () => {
      // Switch from worktree/scratch to project view
      // Navigation history is handled by the useEffect that tracks view changes
      if ((activeWorktreeId || activeScratchId) && activeProjectId) {
        setActiveWorktreeId(null);
        setActiveScratchId(null);
      }
    },
    onNavigateToEntity: (index: number) => selectEntityAtIndex(index),

    // Focus actions
    onSwitchFocus: handleSwitchFocus,

    // View actions
    onZoomIn: handleZoomIn,
    onZoomOut: handleZoomOut,
    onZoomReset: handleZoomReset,

    // Panel actions
    onToggleRightPanel: handleToggleRightPanel,

    // Palette actions
    onTogglePalette: handleToggleCommandPalette,
    onClosePalette: () => {
      if (isCommandPaletteOpen) handleToggleCommandPalette();
      if (isTaskSwitcherOpen) handleToggleTaskSwitcher();
      if (isProjectSwitcherOpen) handleToggleProjectSwitcher();
    },
    onToggleProjectSwitcher: handleToggleProjectSwitcher,

    // Task actions
    onToggleTaskSwitcher: handleToggleTaskSwitcher,
    onRunTask: handleToggleTask,

    // Terminal copy/paste via terminal registry
    onTerminalCopy: () => {
      // Returns true if copied (had selection), false to let Ctrl+C through as interrupt
      return copyFromActiveTerminal();
    },
    onTerminalPaste: () => {
      pasteToActiveTerminal();
    },

    // Modal actions
    onCloseModal: () => {
      if (pendingCloseProject) setPendingCloseProject(null);
      if (pendingDeleteId) setPendingDeleteId(null);
      if (pendingMergeId) setPendingMergeId(null);
    },

    // Diff navigation actions
    onOpenDiff: handleOpenDiff,
    onNextChangedFile: handleNextChangedFile,
    onPrevChangedFile: handlePrevChangedFile,
    onToggleDiffMode: handleToggleDiffMode,

    // Pane actions (vim-style splits and navigation)
    onPaneSplitHorizontal: () => {
      console.log('[SPLIT:App] onPaneSplitHorizontal called', { activeSessionTabId });
      if (activeSessionTabId) {
        splitPane(activeSessionTabId, 'horizontal');
      }
    },
    onPaneSplitVertical: () => {
      console.log('[SPLIT:App] onPaneSplitVertical called', { activeSessionTabId });
      if (activeSessionTabId) {
        splitPane(activeSessionTabId, 'vertical');
      }
    },
    onPaneFocusLeft: () => {
      if (activeSessionTabId) {
        focusSplitDirection(activeSessionTabId, 'left');
      }
    },
    onPaneFocusDown: () => {
      if (activeSessionTabId) {
        focusSplitDirection(activeSessionTabId, 'down');
      }
    },
    onPaneFocusUp: () => {
      if (activeSessionTabId) {
        focusSplitDirection(activeSessionTabId, 'up');
      }
    },
    onPaneFocusRight: () => {
      if (activeSessionTabId) {
        focusSplitDirection(activeSessionTabId, 'right');
      }
    },
    onPaneClose: () => {
      if (!activeSessionTabId) return;
      const hasSplits = tabHasSplits(activeSessionTabId);
      if (hasSplits) {
        const activePaneId = getActivePaneId(activeSessionTabId);
        if (activePaneId) {
          closeSplitPane(activeSessionTabId, activePaneId);
        }
      } else {
        // No splits - close the tab
        handleCloseSessionTab(activeSessionTabId);
      }
    },
  }), [
    activeDrawerTabId, activeDrawerTabs, isDrawerOpen, activeScratchId, activeWorktreeId, activeProjectId,
    activeSessionTabId,
    handleCloseDrawerTab, handleToggleDrawer, handleToggleDrawerExpand, handleSelectDrawerTab, handleAddDrawerTab,
    handleAddSessionTab, handleCloseSessionTab, handleCloseCurrentSession, handlePrevSessionTab, handleNextSessionTab, handleSelectSessionTabByIndex,
    handleCloseScratch, handleAddScratchTerminal, handleCloseWorktree, handleAddWorktree, handleCloseProject, handleRefreshProjects,
    handleNavigateBack, handleNavigateForward, handleSwitchFocus, handleZoomIn, handleZoomOut, handleZoomReset,
    handleToggleRightPanel, handleToggleCommandPalette, handleToggleTaskSwitcher, handleToggleProjectSwitcher,
    handleToggleTask, selectEntityAtIndex, actionHandlers,
    isCommandPaletteOpen, isTaskSwitcherOpen, isProjectSwitcherOpen,
    pendingCloseProject, pendingDeleteId, pendingMergeId,
    handleOpenDiff, handleNextChangedFile, handlePrevChangedFile, handleToggleDiffMode,
    splitPane, focusSplitDirection, tabHasSplits, getActivePaneId, closeSplitPane,
  ]);

  useAppGlobalBindings({
    activeSessionId,
    activeSessionKind,
    activeScratchId,
    activeWorktreeId,
    activeProjectId,
    activeFocusState,
    isDrawerOpen,
    isRightPanelOpen,
    isCommandPaletteOpen,
    isTaskSwitcherOpen,
    isProjectSwitcherOpen,
    pendingCloseProject,
    pendingDeleteId,
    pendingMergeId,
    pendingStashProject,
    isAppearanceSettingsOpen,
    openEntityCount: openEntitiesInOrder.length,
    canGoBack,
    canGoForward,
    isDiffViewOpen: activeDiffState.isViewingDiff,
    hasSplits: activeSessionTabId ? tabHasSplits(activeSessionTabId) : false,
    resolveKeyEvent,
    contextActionHandlers,
    isPickerOpenRef,
    executeByMenuIdRef,
    actionContext,
    setIsModifierKeyHeld,
    setIsCtrlCmdKeyHeld,
  });

  const pendingDeleteInfo = pendingDeleteId
    ? (() => {
        for (const project of projects) {
          const worktree = project.worktrees.find((w) => w.id === pendingDeleteId);
          if (worktree) {
            return { worktree, projectPath: project.path };
          }
        }
        return null;
      })()
    : null;

  const pendingMergeInfo = pendingMergeId
    ? (() => {
        for (const project of projects) {
          const worktree = project.worktrees.find((w) => w.id === pendingMergeId);
          if (worktree) {
            return { worktree, projectPath: project.path };
          }
        }
        return null;
      })()
    : null;

  const { themeProps, overlaysProps, pickersProps, layoutProps, toastProps } = buildAppLayoutProps({
    projects,
    activeProjectId,
    activeWorktreeId,
    activeScratchId,
    activeWorktree,
    scratchTerminals,
    openProjectIds,
    openWorktreeIds,
    openEntitiesInOrder,
    isCtrlCmdKeyHeld,
    isPickerOpen,
    loadingWorktrees,
    notifiedWorktreeIds,
    thinkingWorktreeIds,
    idleWorktreeIds,
    notifiedProjectIds,
    thinkingProjectIds,
    idleProjectIds,
    notifiedScratchIds,
    thinkingScratchIds,
    idleScratchIds,
    runningTaskCounts,
    expandedProjects,
    isDrawerOpen,
    isDrawerExpanded,
    isRightPanelOpen,
    tasks: config.tasks,
    activeSelectedTask,
    activeRunningTask,
    runningTasks,
    terminalFontFamily: config.main.fontFamily,
    appsConfig: config.apps,
    showIdleCheck: config.indicators.showIdleCheck,
    activeScratchCwd: activeScratchId && activeSessionTabId ? scratchCwds.get(activeSessionTabId) ?? null : null,
    homeDir,
    branchInfo,
    changedFilesCount: changedFiles.length,
    changedFilesMode,
    autoEditWorktreeId,
    editingScratchId,
    focusToRestoreRef,
    onFocusMain: handleFocusMain,
    onToggleProject: toggleProject,
    onSelectProject: handleSelectProject,
    onSelectWorktree: handleSelectWorktree,
    onRefreshProjects: handleRefreshProjects,
    isProjectsLoading,
    onAddProject: handleAddProject,
    onAddWorktree: handleAddWorktree,
    onDeleteWorktree: handleDeleteWorktree,
    onCloseWorktree: handleCloseWorktree,
    onCloseProject: handleCloseProject,
    onHideProject: handleHideProject,
    onMergeWorktree: handleMergeWorktree,
    onToggleRightPanel: handleToggleRightPanel,
    onSelectTask: handleSelectTask,
    onStartTask: handleStartTask,
    onStopTask: handleStopTask,
    onForceKillTask: handleForceKillTask,
    onRenameWorktree: renameWorktree,
    onReorderProjects: handleReorderProjects,
    onReorderWorktrees: handleReorderWorktrees,
    onAddScratchTerminal: handleAddScratchTerminal,
    onSelectScratch: handleSelectScratch,
    onCloseScratch: handleCloseScratch,
    onRenameScratch: handleRenameScratch,
    onReorderScratchTerminals: handleReorderScratchTerminals,
    onAutoEditConsumed: () => setAutoEditWorktreeId(null),
    onEditingScratchConsumed: () => setEditingScratchId(null),
    onOpenInTab: handleOpenInTab,
    onOpenAppearanceSettings: handleOpenAppearanceSettings,
    onOpenCommitModal: handleOpenCommitModal,
    sessions,
    openSessionIds,
    activeSessionId,
    allSessionTabs: sessionTabs,
    activeSessionTabId,
    sessionLastActiveTabIds,
    isCtrlKeyHeld: isModifierKeyHeld,
    onSelectSessionTab: handleSelectSessionTab,
    onCloseSessionTab: handleCloseSessionTab,
    onAddSessionTab: handleAddSessionTab,
    onReorderSessionTabs: handleReorderSessionTabs,
    onRenameSessionTab: handleRenameSessionTab,
    terminalConfig: mainTerminalConfig,
    editorConfig: config.main,
    activityTimeout: config.indicators.activityTimeout,
    unfocusedPaneOpacity: isDrawerOpen && activeFocusState === 'drawer' ? 1 : config.panes.unfocusedOpacity,
    shouldAutoFocus: activeFocusState === 'main',
    focusTrigger: mainFocusTrigger,
    configErrors,
    onFocus: handleMainPaneFocused,
    onWorktreeNotification: handleWorktreeNotification,
    onWorktreeThinkingChange: handleWorktreeThinkingChange,
    onProjectNotification: handleProjectNotification,
    onProjectThinkingChange: handleProjectThinkingChange,
    onScratchNotification: handleScratchNotification,
    onScratchThinkingChange: handleScratchThinkingChange,
    onScratchCwdChange: handleScratchCwdChange,
    onClearNotification: clearNotification,
    onTabTitleChange: updateSessionTabLabel,
    onPtyIdReady: setSessionPtyId,
    drawerTabs,
    activeDrawerTabs,
    activeDrawerTabId,
    activeTaskStatuses,
    onSelectDrawerTab: handleSelectDrawerTab,
    onCloseDrawerTab: handleCloseDrawerTab,
    onAddDrawerTab: handleAddDrawerTab,
    onToggleExpand: handleToggleDrawerExpand,
    onReorderDrawerTabs: handleReorderDrawerTabs,
    changedFiles,
    isGitRepo,
    loading: changedFilesLoading,
    onModeChange: setChangedFilesMode,
    showModeToggle: showChangedFilesModeToggle ?? false,
    onFileClick: handleFileClick,
    selectedFile: activeDiffState.currentFilePath,
    onOpenDiff: handleOpenDiff,
    actionContext,
    getShortcut,
    labelOverrides: commandPaletteLabelOverrides,
    navigableEntitiesInOrder,
    onExecuteAction: (actionId: ActionId) => actions.execute(actionId),
    onRunTask: (taskName: string) => {
      handleSelectTask(taskName);
      handleStartTask(taskName);
    },
    onNavigate: (type: 'scratch' | 'project' | 'worktree', id: string) => {
      if (type === 'scratch') {
        handleSelectScratch(id);
      } else if (type === 'project') {
        const project = projects.find(p => p.id === id);
        if (project) {
          handleSelectProject(project);
        }
      } else if (type === 'worktree') {
        for (const project of projects) {
          const worktree = project.worktrees.find(w => w.id === id);
          if (worktree) {
            handleSelectWorktree(worktree);
            break;
          }
        }
      }
    },
    onCloseCommandPalette: () => setIsCommandPaletteOpen(false),
    onCloseTaskSwitcher: () => setIsTaskSwitcherOpen(false),
    onCloseProjectSwitcher: () => setIsProjectSwitcherOpen(false),
    onCloseThemeSwitcher: () => setIsThemeSwitcherOpen(false),
    onCloseAppearanceSettings: handleCloseAppearanceSettings,
    onProjectSwitcherSelect: handleProjectSwitcherSelect,
    onThemeChange: handleThemeChange,
    onBorderStyleChange: handleBorderStyleChange,
    onFontChange: handleFontSettingsChange,
    onModalOpen,
    onModalClose,
    isCommitModalOpen: commitModal.isOpen,
    commitMessage: commitModal.message,
    commitBranchName: commitModal.branchName,
    commitSuggestedBranchName: commitModal.suggestedBranchName,
    commitCurrentBranch: commitModal.currentBranch,
    commitError: commitModal.error,
    commitBusy: commitModal.isBusy,
    commitBusyLabel: commitModal.busyLabel,
    commitHasCommitted: commitModal.hasCommitted,
    commitCanMergeToMain: commitModal.canMergeToMain,
    commitCanCreateBranch: commitModal.canCreateBranch,
    commitCanRenameBranch: commitModal.canRenameBranch,
    onCommitMessageChange: commitModal.setMessage,
    onCommitBranchNameChange: commitModal.setBranchName,
    onCommitAutoGenerate: commitModal.generate,
    onCommitUseSuggestedBranch: commitModal.useSuggestedBranch,
    onCommitSubmit: commitModal.commit,
    onCommitCreateBranch: commitModal.createBranch,
    onCommitPushBranch: commitModal.pushBranch,
    onCommitMergeToMain: commitModal.mergeToMain,
    onCommitPushMain: commitModal.pushMain,
    onCommitClose: commitModal.close,
    isTaskSwitcherOpen,
    isCommandPaletteOpen,
    isProjectSwitcherOpen,
    isThemeSwitcherOpen,
    isAppearanceSettingsOpen,
    isShuttingDown,
    pendingDeleteInfo,
    pendingCloseProject,
    pendingMergeInfo,
    pendingStashProject,
    stashError,
    isStashing,
    onClearPendingDelete: () => setPendingDeleteId(null),
    onClearPendingCloseProject: () => setPendingCloseProject(null),
    onClearPendingMerge: () => setPendingMergeId(null),
    onDeleteComplete: handleDeleteComplete,
    onConfirmCloseProject: confirmCloseProject,
    onMergeComplete: handleMergeComplete,
    onTriggerAction: handleTriggerAction,
    onStashAndCreate: handleStashAndCreate,
    onCancelStash: handleCancelStash,
    mainPanelRef,
    drawerPanelRef,
    rightPanelRef,
    activeEntityId,
    activeFocusState,
    drawerTerminalConfig,
    getEntityDirectory,
    onTaskPtyIdReady: handleTaskPtyIdReady,
    onTaskExit: handleTaskExit,
    onDrawerFocused: handleDrawerFocused,
    onDrawerPtyIdReady: handleDrawerPtyIdReady,
    onDrawerTabTitleChange: updateDrawerTabLabel,
    onDrawerResize: handleDrawerResize,
    onRightPanelResize: handleRightPanelResize,
    config,
    effectiveBorderStyle,
    toasts,
    onDismissToast: dismissToast,
  });

  return {
    themeProps,
    config,
    overlaysProps,
    pickersProps,
    layoutProps,
    toastProps,
  };
}

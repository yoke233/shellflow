import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, PanelImperativeHandle } from 'react-resizable-panels';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { Sidebar } from './components/Sidebar/Sidebar';
import { MainPane } from './components/MainPane/MainPane';
import { RightPanel } from './components/RightPanel/RightPanel';
import { Drawer, DrawerTab } from './components/Drawer/Drawer';
import { DrawerTerminal } from './components/Drawer/DrawerTerminal';
import { TaskTerminal } from './components/Drawer/TaskTerminal';
import { ActionTerminal } from './components/Drawer/ActionTerminal';
import { DeleteWorktreeModal } from './components/DeleteWorktreeModal';
import { ConfirmModal } from './components/ConfirmModal';
import { MergeModal } from './components/MergeModal';
import { StashModal } from './components/StashModal';
import { ShutdownScreen } from './components/ShutdownScreen';
import { TaskSwitcher } from './components/TaskSwitcher/TaskSwitcher';
import { CommandPalette } from './components/CommandPalette';
import { ThemeSwitcher } from './components/ThemeSwitcher';
import { ProjectSwitcher } from './components/ProjectSwitcher';
import { useWorktrees } from './hooks/useWorktrees';
import { useGitStatus } from './hooks/useGitStatus';
import { useConfig, getAppCommand, getAppTarget } from './hooks/useConfig';
import { useScratchTerminals } from './hooks/useScratchTerminals';
import { useIndicators } from './hooks/useIndicators';
import { useDrawerTabs } from './hooks/useDrawerTabs';
import { useSessionTabs, SessionTab } from './hooks/useSessionTabs';
import { selectFolder, shutdown, ptyKill, ptyForceKill, stashChanges, stashPop, reorderProjects, reorderWorktrees, expandActionPrompt, ActionPromptContext, updateActionAvailability, touchProject } from './lib/tauri';
import { openUrl } from '@tauri-apps/plugin-opener';
import { ActionContext, ActionId, getMenuAvailability } from './lib/actions';
import { useActions, ActionHandlers } from './hooks/useActions';
import { arrayMove } from '@dnd-kit/sortable';
import { useMappings } from './hooks/useMappings';
import { getActiveContexts, type ContextState } from './lib/contexts';
import { createActionHandlers, executeAction } from './lib/actionHandlers';
import { copyFromActiveTerminal, pasteToActiveTerminal } from './lib/terminalRegistry';
import { Project, Worktree, RunningTask, MergeCompleted, Session, SessionKind, ChangedFilesViewMode } from './types';
import { ToastContainer } from './components/Toast';
import { useToast } from './hooks/useToast';
import { ThemeProvider, ThemeBorderStyle } from './theme';

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

/** Substitute `{{ path }}` in a command template, or append path if no template. */
function substitutePathTemplate(command: string, path: string): string {
  if (command.includes('{{ path }}')) {
    return command.replace(/\{\{ path \}\}/g, `"${path}"`);
  }
  return `${command} "${path}"`;
}

function App() {
  const { projects, addProject, hideProject, activateProject, createWorktree, renameWorktree, reorderProjectsOptimistic, reorderWorktreesOptimistic, refresh: refreshProjects } = useWorktrees();

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

    // Create the primary tab (runs the configured command)
    const counter = incrementSessionCounter(activeSessionId);
    const newTab: SessionTab = {
      id: `${activeSessionId}-session-${counter}`,
      label: `Terminal ${counter}`,
      isPrimary: true,
    };
    addSessionTab(activeSessionId, newTab);
  }, [activeSessionId, getTabsForSession, incrementSessionCounter, addSessionTab]);

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
  const isPickerOpen = isTaskSwitcherOpen || isCommandPaletteOpen || isProjectSwitcherOpen || isThemeSwitcherOpen;
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

  // Derived values
  const activeWorktree = useMemo(() => {
    if (!activeWorktreeId) return null;
    for (const project of projects) {
      const wt = project.worktrees.find(w => w.id === activeWorktreeId);
      if (wt) return wt;
    }
    return null;
  }, [activeWorktreeId, projects]);

  // Get the active project object
  const activeProject = useMemo(() => {
    if (!activeProjectId) return null;
    return projects.find(p => p.id === activeProjectId) ?? null;
  }, [activeProjectId, projects]);

  // Helper to get entity directory from ID (for drawer terminals)
  // Returns undefined for scratch terminals (uses home directory)
  const getEntityDirectory = useCallback((entityId: string): string | undefined => {
    // Check worktrees
    for (const project of projects) {
      const worktree = project.worktrees.find(w => w.id === entityId);
      if (worktree) return worktree.path;
    }
    // Check projects
    const project = projects.find(p => p.id === entityId);
    if (project) return project.path;
    // Scratch terminals - return undefined to use home directory
    return undefined;
  }, [projects]);

  // Git status target - either the active worktree or project
  const gitStatusTarget = useMemo(() => {
    if (activeWorktree) return activeWorktree;
    if (activeProject) return { id: activeProject.id, path: activeProject.path };
    return null;
  }, [activeWorktree, activeProject]);

  // Open worktrees in sidebar order (for keyboard navigation)
  const openWorktreesInOrder = useMemo(() => {
    return projects
      .flatMap(p => p.worktrees)
      .filter(w => openWorktreeIds.has(w.id))
      .map(w => w.id);
  }, [projects, openWorktreeIds]);

  // Open entities in sidebar order - scratch terminals first, then projects/worktrees
  // Used for unified keyboard navigation (1-9, j/k)
  // Projects are interleaved with their worktrees in sidebar order
  const openEntitiesInOrder = useMemo(() => {
    const scratchIds = scratchTerminals.map(s => ({ type: 'scratch' as const, id: s.id }));

    // Build project/worktree list in sidebar visual order
    const projectAndWorktreeIds: Array<{ type: 'project' | 'worktree'; id: string }> = [];
    for (const project of projects) {
      // Include project if project terminal is open
      if (openProjectIds.has(project.id)) {
        projectAndWorktreeIds.push({ type: 'project' as const, id: project.id });
      }
      // Include open worktrees from this project
      for (const worktree of project.worktrees) {
        if (openWorktreeIds.has(worktree.id)) {
          projectAndWorktreeIds.push({ type: 'worktree' as const, id: worktree.id });
        }
      }
    }

    return [...scratchIds, ...projectAndWorktreeIds];
  }, [scratchTerminals, projects, openProjectIds, openWorktreeIds]);

  // All navigable entities in sidebar order - for command palette navigation
  // Includes ALL active projects and their worktrees (not just open ones)
  const navigableEntitiesInOrder = useMemo(() => {
    const scratchIds = scratchTerminals.map(s => ({ type: 'scratch' as const, id: s.id }));

    // Build project/worktree list in sidebar visual order
    const projectAndWorktreeIds: Array<{ type: 'project' | 'worktree'; id: string }> = [];
    for (const project of projects) {
      if (!project.isActive) continue;
      // Include all active projects
      projectAndWorktreeIds.push({ type: 'project' as const, id: project.id });
      // Include all worktrees from active projects
      for (const worktree of project.worktrees) {
        projectAndWorktreeIds.push({ type: 'worktree' as const, id: worktree.id });
      }
    }

    return [...scratchIds, ...projectAndWorktreeIds];
  }, [scratchTerminals, projects]);

  // Worktrees with running tasks and their counts (for sidebar indicator)
  const runningTaskCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const [worktreeId, tasks] of runningTasks.entries()) {
      const runningCount = tasks.filter(t => t.status === 'running').length;
      if (runningCount > 0) {
        counts.set(worktreeId, runningCount);
      }
    }
    return counts;
  }, [runningTasks]);

  // Expanded projects - persisted to localStorage
  const hasInitialized = useRef(localStorage.getItem(EXPANDED_PROJECTS_KEY) !== null);

  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(EXPANDED_PROJECTS_KEY);
      if (saved) {
        return new Set(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load expanded projects:', e);
    }
    return new Set();
  });

  // Expand all projects by default on first run only
  useEffect(() => {
    if (!hasInitialized.current && projects.length > 0) {
      hasInitialized.current = true;
      setExpandedProjects(new Set(projects.map((p) => p.id)));
    }
  }, [projects]);

  // Create initial scratch terminal on startup if configured
  const hasCreatedInitialScratch = useRef(false);
  useEffect(() => {
    if (!hasCreatedInitialScratch.current && config.scratch.startOnLaunch && scratchTerminals.length === 0) {
      hasCreatedInitialScratch.current = true;
      const newScratch = addScratchTerminal();
      setActiveScratchId(newScratch.id);
    }
  }, [config.scratch.startOnLaunch, scratchTerminals.length, addScratchTerminal]);

  // Persist expanded projects to localStorage
  useEffect(() => {
    localStorage.setItem(EXPANDED_PROJECTS_KEY, JSON.stringify([...expandedProjects]));
  }, [expandedProjects]);

  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

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

  // Dispatch event to trigger immediate terminal resize after panel toggle
  const dispatchPanelResizeComplete = useCallback(() => {
    // Use requestAnimationFrame to let the DOM update first
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

    dispatchPanelResizeComplete();
  }, [activeEntityId, isDrawerOpen, isDrawerExpanded, drawerTabs, drawerTabCounters, dispatchPanelResizeComplete]);

  // Toggle drawer expansion handler (maximize/restore within main area)
  const handleToggleDrawerExpand = useCallback(() => {
    if (!activeEntityId || !isDrawerOpen) return;

    const drawerPanel = drawerPanelRef.current;
    if (!drawerPanel) return;

    if (isDrawerExpanded) {
      // Restore to previous size
      setIsDrawerExpanded(false);
      // Use setTimeout to let maxSize update before resizing
      setTimeout(() => {
        drawerPanel.resize(preExpandDrawerSize.current);
        dispatchPanelResizeComplete();
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
        dispatchPanelResizeComplete();
      }, 0);
    }
  }, [activeEntityId, isDrawerOpen, isDrawerExpanded, dispatchPanelResizeComplete]);

  // Toggle right panel handler
  const handleToggleRightPanel = useCallback(() => {
    if (!activeEntityId) return;

    const panel = rightPanelRef.current;
    const willOpen = !isRightPanelOpen;

    if (panel) {
      if (willOpen) {
        panel.resize(lastRightPanelSize.current);
      } else {
        panel.collapse();
      }
    }

    setIsRightPanelOpen(willOpen);
    dispatchPanelResizeComplete();
  }, [activeEntityId, isRightPanelOpen, dispatchPanelResizeComplete]);


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
  }, [activeSessionId, activeSessionKind, activeSessionTabId, scratchCwds, getEntityDirectory, incrementSessionCounter, addSessionTab]);

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
  }, [activeEntityId, isDrawerExpanded, drawerTabs, drawerActiveTabIds, drawerPtyIds]);

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
    if (!activeEntityId) return;

    const currentFocus = focusStates.get(activeEntityId) ?? 'main';
    const newFocus = currentFocus === 'main' ? 'drawer' : 'main';

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
  }, [activeEntityId, focusStates, isDrawerOpen, drawerTabs, drawerTabCounters, dispatchPanelResizeComplete]);

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

  // Cycle through border styles: theme -> subtle -> visible -> theme
  const handleCycleBorderStyle = useCallback(() => {
    const current = runtimeBorderStyle ?? config.themeBorderStyle ?? 'subtle';
    const next: ThemeBorderStyle = current === 'theme' ? 'subtle' : current === 'subtle' ? 'visible' : 'theme';
    setRuntimeBorderStyle(next);
  }, [runtimeBorderStyle, config.themeBorderStyle]);

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
      const { spawnTask } = await import('./lib/tauri');
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
      }
      return !prev;
    });
  }, [activeEntityId, config.tasks.length]);

  const handleTaskSwitcherSelect = useCallback((taskName: string) => {
    handleSelectTask(taskName);
    setIsTaskSwitcherOpen(false);
  }, [handleSelectTask]);

  const handleTaskSwitcherRun = useCallback((taskName: string) => {
    handleSelectTask(taskName);
    handleStartTask(taskName);
    setIsTaskSwitcherOpen(false);
  }, [handleSelectTask, handleStartTask]);

  // Command palette handlers
  const handleToggleCommandPalette = useCallback(() => {
    setIsCommandPaletteOpen(prev => {
      if (!prev) {
        // Close other pickers when opening
        setIsTaskSwitcherOpen(false);
        setIsProjectSwitcherOpen(false);
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
      }
      return !prev;
    });
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

    // If closing the last tab, close the entire session instead
    if (remaining.length === 0) {
      handleCloseCurrentSession();
      return;
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
  }), [activeProjectId, activeWorktreeId, activeScratchId, activeEntityId, isDrawerOpen, activeFocusState, activeDrawerTabId, openEntitiesInOrder.length, canGoBack, canGoForward, activeSelectedTask, config.tasks.length, activeDiffState.isViewingDiff, changedFiles.length]);

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
    overrides.cycleBorderStyle = `Border Style: ${effectiveBorderStyle} → ${nextStyle[effectiveBorderStyle]}`;

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
  const actionHandlers: ActionHandlers = useMemo(() => ({
    'app::quit': () => {
      // Trigger graceful shutdown - same as menu quit
      getCurrentWindow().emit('close-requested');
    },
    'app::addProject': handleAddProject,
    'palette::projectSwitcher': handleToggleProjectSwitcher,
    'worktree::new': () => activeProjectId && handleAddWorktree(activeProjectId),
    'scratch::new': handleAddScratchTerminal,
    'session::newTab': handleAddSessionTab,
    'session::closeTab': () => {
      // Priority: drawer tab (if focused) > scratch terminal > worktree > project terminal
      if (isDrawerOpen && activeFocusState === 'drawer' && activeDrawerTabId) {
        handleCloseDrawerTab(activeDrawerTabId);
      } else if (activeScratchId) {
        handleCloseScratch(activeScratchId);
      } else if (activeWorktreeId) {
        handleCloseWorktree(activeWorktreeId);
      } else if (activeProjectId) {
        handleCloseProject(activeProjectId);
      }
    },
    'app::openInFinder': () => {
      let path: string | undefined;
      if (activeWorktreeId) {
        path = projects.flatMap(p => p.worktrees).find(w => w.id === activeWorktreeId)?.path;
      } else if (activeScratchId) {
        path = scratchCwds.get(activeScratchId);
      } else if (activeProjectId) {
        path = projects.find(p => p.id === activeProjectId)?.path;
      }
      if (path) invoke('open_folder', { path });
    },
    'app::openInTerminal': () => {
      const target = getAppTarget(config.apps.terminal);
      const command = getAppCommand(config.apps.terminal);

      // Get the path
      let path: string | undefined;
      if (activeWorktreeId) {
        path = projects.flatMap(p => p.worktrees).find(w => w.id === activeWorktreeId)?.path;
      } else if (activeScratchId) {
        path = scratchCwds.get(activeScratchId);
      } else if (activeProjectId) {
        path = projects.find(p => p.id === activeProjectId)?.path;
      }
      if (!path) return;

      if (target === 'drawer') {
        // Open a new shell tab in the drawer (no command = shell)
        if (activeEntityId) {
          handleAddDrawerTab();
          if (!isDrawerOpen) setIsDrawerOpen(true);
        }
      } else if (target === 'tab') {
        // Open a new main area tab with shell
        handleAddSessionTab();
      } else {
        // external target - use open_in_terminal with optional command
        invoke('open_in_terminal', { path, app: command ?? null });
      }
    },
    'app::openInEditor': () => {
      const command = getAppCommand(config.apps.editor);
      // Editor defaults to 'terminal' when not configured (same as Sidebar default)
      const target = config.apps.editor ? getAppTarget(config.apps.editor) : getAppTarget(undefined, 'terminal');
      const terminalCommand = getAppCommand(config.apps.terminal);

      // Get the path
      let path: string | undefined;
      if (activeWorktreeId) {
        path = projects.flatMap(p => p.worktrees).find(w => w.id === activeWorktreeId)?.path;
      } else if (activeScratchId) {
        path = scratchCwds.get(activeScratchId);
      } else if (activeProjectId) {
        path = projects.find(p => p.id === activeProjectId)?.path;
      }
      if (!path) return;

      if (!command) {
        console.error('No editor configured');
        return;
      }

      if (target === 'drawer') {
        // Open in shellflow's drawer with template substitution
        handleOpenInDrawer(path, substitutePathTemplate(command, path));
      } else if (target === 'tab') {
        // Open in a new session tab with template substitution
        handleOpenInTab(path, substitutePathTemplate(command, path));
      } else {
        // External or terminal target - handled by backend (which also does template substitution)
        invoke('open_in_editor', {
          path,
          app: command,
          target,
          terminalApp: terminalCommand ?? null,
        });
      }
    },
    'app::openSettings': () => {
      (async () => {
        const command = getAppCommand(config.apps.editor);
        const target = config.apps.editor ? getAppTarget(config.apps.editor) : getAppTarget(undefined, 'terminal');
        const terminalCommand = getAppCommand(config.apps.terminal);

        try {
          const path = await invoke<string>('get_config_file_path', { fileType: 'settings' });

          if (!command) {
            console.error('No editor configured');
            return;
          }

          if (target === 'drawer') {
            handleOpenInDrawer(path, substitutePathTemplate(command, path));
          } else if (target === 'tab') {
            handleOpenInTab(path, substitutePathTemplate(command, path));
          } else {
            invoke('open_in_editor', {
              path,
              app: command,
              target,
              terminalApp: terminalCommand ?? null,
            });
          }
        } catch (err) {
          console.error('Failed to open settings:', err);
        }
      })();
    },
    'app::openMappings': () => {
      (async () => {
        const command = getAppCommand(config.apps.editor);
        const target = config.apps.editor ? getAppTarget(config.apps.editor) : getAppTarget(undefined, 'terminal');
        const terminalCommand = getAppCommand(config.apps.terminal);

        try {
          const path = await invoke<string>('get_config_file_path', { fileType: 'mappings' });

          if (!command) {
            console.error('No editor configured');
            return;
          }

          if (target === 'drawer') {
            handleOpenInDrawer(path, substitutePathTemplate(command, path));
          } else if (target === 'tab') {
            handleOpenInTab(path, substitutePathTemplate(command, path));
          } else {
            invoke('open_in_editor', {
              path,
              app: command,
              target,
              terminalApp: terminalCommand ?? null,
            });
          }
        } catch (err) {
          console.error('Failed to open mappings:', err);
        }
      })();
    },
    'project::close': () => {
      if (activeProjectId && !activeWorktreeId) {
        handleCloseProject(activeProjectId);
      }
    },
    'palette::toggle': handleToggleCommandPalette,
    'drawer::toggle': handleToggleDrawer,
    'drawer::expand': handleToggleDrawerExpand,
    'rightPanel::toggle': handleToggleRightPanel,
    'view::switchTheme': () => setIsThemeSwitcherOpen(true),
    'view::cycleBorderStyle': handleCycleBorderStyle,
    'view::zoomIn': handleZoomIn,
    'view::zoomOut': handleZoomOut,
    'view::zoomReset': handleZoomReset,
    'navigate::prev': () => {
      if (openEntitiesInOrder.length === 0) return;
      const currentIndex = getCurrentEntityIndex();
      const prevIndex = currentIndex !== -1
        ? (currentIndex === 0 ? openEntitiesInOrder.length - 1 : currentIndex - 1)
        : openEntitiesInOrder.length - 1;
      selectEntityAtIndex(prevIndex);
    },
    'navigate::next': () => {
      if (openEntitiesInOrder.length === 0) return;
      const currentIndex = getCurrentEntityIndex();
      const nextIndex = currentIndex !== -1
        ? (currentIndex === openEntitiesInOrder.length - 1 ? 0 : currentIndex + 1)
        : 0;
      selectEntityAtIndex(nextIndex);
    },
    'navigate::back': handleNavigateBack,
    'navigate::forward': handleNavigateForward,
    'focus::switch': handleSwitchFocus,
    'navigate::toEntity1': () => selectEntityAtIndex(0),
    'navigate::toEntity2': () => selectEntityAtIndex(1),
    'navigate::toEntity3': () => selectEntityAtIndex(2),
    'navigate::toEntity4': () => selectEntityAtIndex(3),
    'navigate::toEntity5': () => selectEntityAtIndex(4),
    'navigate::toEntity6': () => selectEntityAtIndex(5),
    'navigate::toEntity7': () => selectEntityAtIndex(6),
    'navigate::toEntity8': () => selectEntityAtIndex(7),
    'navigate::toEntity9': () => selectEntityAtIndex(8),
    'worktree::renameBranch': () => activeWorktreeId && handleRenameBranch(activeWorktreeId),
    'scratch::renameSession': () => {
      if (activeScratchId) {
        focusToRestoreRef.current = document.activeElement as HTMLElement | null;
        setEditingScratchId(activeScratchId);
      }
    },
    'worktree::merge': () => activeWorktreeId && handleMergeWorktree(activeWorktreeId),
    'worktree::delete': () => activeWorktreeId && handleDeleteWorktree(activeWorktreeId),
    'task::run': handleToggleTask,
    'task::switcher': handleToggleTaskSwitcher,
    // Diff navigation
    'diff::nextFile': handleNextChangedFile,
    'diff::prevFile': handlePrevChangedFile,
    // Help menu
    'app::helpDocs': () => openUrl('https://github.com/shkm/shellflow#readme'),
    'app::helpReportIssue': () => openUrl('https://github.com/shkm/shellflow/issues/new'),
    'app::helpReleaseNotes': () => openUrl('https://github.com/shkm/shellflow/releases'),
  }), [
    activeProjectId, activeWorktreeId, activeScratchId, activeDrawerTabId, isDrawerOpen, activeFocusState,
    openWorktreesInOrder, projects, config.apps, activeEntityId, scratchCwds,
    handleAddProject, handleAddWorktree, handleAddScratchTerminal, handleCloseDrawerTab, handleCloseProject,
    handleAddDrawerTab, handleOpenInDrawer, handleOpenInTab, handleAddSessionTab,
    handleCloseWorktree, handleCloseScratch,
    handleToggleDrawer, handleToggleDrawerExpand, handleToggleRightPanel, handleToggleProjectSwitcher,
    handleZoomIn, handleZoomOut, handleZoomReset, handleCycleBorderStyle, handleNavigateBack, handleNavigateForward, handleSwitchFocus,
    handleRenameBranch, handleMergeWorktree, handleDeleteWorktree, handleToggleTask, handleToggleTaskSwitcher,
    handleNextChangedFile, handlePrevChangedFile,
    getCurrentEntityIndex, selectEntityAtIndex,
  ]);

  // The action system hook
  const actions = useActions(actionContext, actionHandlers);

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
    onNextChangedFile: handleNextChangedFile,
    onPrevChangedFile: handlePrevChangedFile,
  }), [
    activeDrawerTabId, activeDrawerTabs, isDrawerOpen, activeScratchId, activeWorktreeId, activeProjectId,
    activeSessionTabId,
    handleCloseDrawerTab, handleToggleDrawer, handleToggleDrawerExpand, handleSelectDrawerTab, handleAddDrawerTab,
    handleAddSessionTab, handleCloseSessionTab, handleCloseCurrentSession, handlePrevSessionTab, handleNextSessionTab, handleSelectSessionTabByIndex,
    handleCloseScratch, handleAddScratchTerminal, handleCloseWorktree, handleAddWorktree, handleCloseProject,
    handleNavigateBack, handleNavigateForward, handleSwitchFocus, handleZoomIn, handleZoomOut, handleZoomReset,
    handleToggleRightPanel, handleToggleCommandPalette, handleToggleTaskSwitcher, handleToggleProjectSwitcher,
    handleToggleTask, selectEntityAtIndex, actionHandlers,
    isCommandPaletteOpen, isTaskSwitcherOpen, isProjectSwitcherOpen,
    pendingCloseProject, pendingDeleteId, pendingMergeId,
    handleNextChangedFile, handlePrevChangedFile,
  ]);

  // Context-aware keyboard shortcuts (new system)
  // This runs before the legacy handler and handles cmd-w and other context-dependent shortcuts
  useEffect(() => {
    const handleContextKeyDown = (e: KeyboardEvent) => {
      // Build context state from current app state
      const contextState: ContextState = {
        activeSessionId,
        activeSessionKind,
        activeScratchId,
        activeWorktreeId,
        activeProjectId,
        focusState: activeFocusState,
        isDrawerOpen,
        isRightPanelOpen,
        isCommandPaletteOpen,
        isTaskSwitcherOpen,
        isProjectSwitcherOpen,
        hasOpenModal: !!(pendingCloseProject || pendingDeleteId || pendingMergeId),
        openEntityCount: openEntitiesInOrder.length,
        canGoBack,
        canGoForward,
        isDiffViewOpen: activeDiffState.isViewingDiff,
      };

      // Get active contexts
      const contexts = getActiveContexts(contextState);

      // Try to resolve the key event to an action
      const binding = resolveKeyEvent(e, contexts);

      if (binding) {
        // Execute the action
        const handled = executeAction(binding.actionId, binding.args, contextActionHandlers);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          console.log(`[ContextKeys] ${binding.actionId} (context: ${binding.context ?? 'global'})`);
        }
      }
    };

    // Use capture phase with higher priority than the legacy handler
    window.addEventListener('keydown', handleContextKeyDown, true);

    return () => {
      window.removeEventListener('keydown', handleContextKeyDown, true);
    };
  }, [
    activeScratchId, activeWorktreeId, activeProjectId, activeFocusState,
    isDrawerOpen, isRightPanelOpen, isCommandPaletteOpen, isTaskSwitcherOpen, isProjectSwitcherOpen,
    pendingCloseProject, pendingDeleteId, pendingMergeId,
    openEntitiesInOrder.length, canGoBack, canGoForward,
    resolveKeyEvent, contextActionHandlers,
  ]);

  // Modifier key tracking (for UI feedback like showing shortcut numbers)
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Track modifier key state (cmd on mac, ctrl on other) - for tab indicators
      if ((isMac && e.metaKey) || (!isMac && e.ctrlKey)) {
        setIsModifierKeyHeld(true);
      }
      // Track Ctrl+Cmd for sidebar indicators (macOS only, ctrl+ctrl on other platforms)
      if (e.ctrlKey && ((isMac && e.metaKey) || (!isMac && e.ctrlKey))) {
        setIsCtrlCmdKeyHeld(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Clear modifier key state when released
      if ((isMac && e.key === 'Meta') || (!isMac && e.key === 'Control')) {
        setIsModifierKeyHeld(false);
      }
      // Clear Ctrl+Cmd state when either is released
      if (e.key === 'Control' || (isMac && e.key === 'Meta')) {
        setIsCtrlCmdKeyHeld(false);
      }
    };

    // Clear modifier state when window loses focus
    const handleBlur = () => {
      setIsModifierKeyHeld(false);
      setIsCtrlCmdKeyHeld(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, []);

  // Listen for menu bar actions from the backend
  useEffect(() => {
    const unlistenMenu = listen<string>('menu-action', (event) => {
      // When a picker is open, ignore menu actions (except picker toggles handled via keyboard)
      if (isPickerOpenRef.current) {
        return;
      }
      // Use the action system to execute menu actions
      // The action system handles availability checking internally
      actions.executeByMenuId(event.payload);
    });

    return () => {
      unlistenMenu.then((fn) => fn());
    };
  }, [actions]);

  // Sync action availability to menu bar
  useEffect(() => {
    const menuAvailability = getMenuAvailability(actionContext);
    updateActionAvailability(menuAvailability);
  }, [actionContext]);

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

  return (
    <ThemeProvider themeConfig={config.theme} borderStyle={effectiveBorderStyle}>
    <div className="h-screen w-screen overflow-hidden flex flex-col" style={{ backgroundColor: 'var(--body-bg)' }}>
      {/* Shutdown screen overlay */}
      <ShutdownScreen isVisible={isShuttingDown} />

      {pendingDeleteInfo && (
        <DeleteWorktreeModal
          worktree={pendingDeleteInfo.worktree}
          projectPath={pendingDeleteInfo.projectPath}
          defaultConfig={config.worktree.delete}
          onClose={() => setPendingDeleteId(null)}
          onDeleteComplete={handleDeleteComplete}
          onModalOpen={onModalOpen}
          onModalClose={onModalClose}
        />
      )}

      {pendingCloseProject && (
        <ConfirmModal
          title="Close Project"
          message={`Are you sure you want to close "${pendingCloseProject.name}"?`}
          confirmLabel="Close"
          onConfirm={confirmCloseProject}
          onCancel={() => setPendingCloseProject(null)}
          onModalOpen={onModalOpen}
          onModalClose={onModalClose}
        />
      )}

      {pendingMergeInfo && (
        <MergeModal
          worktree={pendingMergeInfo.worktree}
          projectPath={pendingMergeInfo.projectPath}
          defaultConfig={config.worktree.merge}
          onClose={() => setPendingMergeId(null)}
          onMergeComplete={handleMergeComplete}
          onTriggerAction={(actionType, context) => {
            handleTriggerAction(
              pendingMergeInfo.worktree.id,
              pendingMergeInfo.projectPath,
              actionType,
              context
            );
          }}
          onModalOpen={onModalOpen}
          onModalClose={onModalClose}
        />
      )}

      {pendingStashProject && (
        <StashModal
          projectName={pendingStashProject.name}
          onStashAndCreate={handleStashAndCreate}
          onCancel={() => {
            setPendingStashProject(null);
            setStashError(null);
          }}
          isLoading={isStashing}
          error={stashError}
          onModalOpen={onModalOpen}
          onModalClose={onModalClose}
        />
      )}

      {isTaskSwitcherOpen && activeEntityId && (
        <TaskSwitcher
          tasks={config.tasks}
          selectedTask={activeSelectedTask}
          runningTasks={runningTasks.get(activeEntityId) ?? []}
          onSelect={handleTaskSwitcherSelect}
          onRun={handleTaskSwitcherRun}
          onClose={() => setIsTaskSwitcherOpen(false)}
          onModalOpen={onModalOpen}
          onModalClose={onModalClose}
        />
      )}

      {isCommandPaletteOpen && (
        <CommandPalette
          actionContext={actionContext}
          getShortcut={getShortcut}
          labelOverrides={commandPaletteLabelOverrides}
          tasks={config.tasks}
          projects={projects}
          scratchTerminals={scratchTerminals}
          openEntitiesInOrder={navigableEntitiesInOrder}
          onExecute={(actionId) => actions.execute(actionId)}
          onRunTask={(taskName) => {
            handleSelectTask(taskName);
            handleStartTask(taskName);
          }}
          onNavigate={(type, id) => {
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
          }}
          onClose={() => setIsCommandPaletteOpen(false)}
          onModalOpen={onModalOpen}
          onModalClose={onModalClose}
        />
      )}

      {isProjectSwitcherOpen && (
        <ProjectSwitcher
          projects={projects}
          activeProjectId={activeProjectId}
          onSelect={handleProjectSwitcherSelect}
          onClose={() => setIsProjectSwitcherOpen(false)}
          onModalOpen={onModalOpen}
          onModalClose={onModalClose}
        />
      )}

      {isThemeSwitcherOpen && (
        <ThemeSwitcher
          onClose={() => setIsThemeSwitcherOpen(false)}
          onModalOpen={onModalOpen}
          onModalClose={onModalClose}
        />
      )}

      {/* Main content - horizontal layout */}
      <PanelGroup
        orientation="horizontal"
        className="flex-1"
      >
        {/* Sidebar */}
        <Panel defaultSize="200px" minSize="150px" maxSize="350px">
          <div className="h-full w-full">
            <Sidebar
              projects={projects}
              activeProjectId={activeProjectId}
              activeWorktreeId={activeWorktreeId}
              activeScratchId={activeScratchId}
              activeWorktree={activeWorktree}
              scratchTerminals={scratchTerminals}
              openProjectIds={openProjectIds}
              openWorktreeIds={openWorktreeIds}
              openEntitiesInOrder={openEntitiesInOrder}
              isModifierKeyHeld={isCtrlCmdKeyHeld && !isPickerOpen}
              loadingWorktrees={loadingWorktrees}
              notifiedWorktreeIds={notifiedWorktreeIds}
              thinkingWorktreeIds={thinkingWorktreeIds}
              idleWorktreeIds={idleWorktreeIds}
              notifiedProjectIds={notifiedProjectIds}
              thinkingProjectIds={thinkingProjectIds}
              idleProjectIds={idleProjectIds}
              notifiedScratchIds={notifiedScratchIds}
              thinkingScratchIds={thinkingScratchIds}
              idleScratchIds={idleScratchIds}
              runningTaskCounts={runningTaskCounts}
              expandedProjects={expandedProjects}
              isDrawerOpen={isDrawerOpen}
              isRightPanelOpen={isRightPanelOpen}
              tasks={config.tasks}
              selectedTask={activeSelectedTask}
              runningTask={activeRunningTask && activeEntityId ? { ...activeRunningTask, worktreeId: activeEntityId, kind: config.tasks.find(t => t.name === activeRunningTask.taskName)?.kind ?? 'command' } : null}
              allRunningTasks={activeEntityId ? runningTasks.get(activeEntityId) ?? [] : []}
              terminalFontFamily={config.main.fontFamily}
              appsConfig={config.apps}
              showIdleCheck={config.indicators.showIdleCheck}
              activeScratchCwd={activeScratchId && activeSessionTabId ? scratchCwds.get(activeSessionTabId) ?? null : null}
              homeDir={homeDir}
              autoEditWorktreeId={autoEditWorktreeId}
              editingScratchId={editingScratchId}
              focusToRestoreRef={focusToRestoreRef}
              onFocusMain={handleFocusMain}
              onToggleProject={toggleProject}
              onSelectProject={handleSelectProject}
              onSelectWorktree={handleSelectWorktree}
              onAddProject={handleAddProject}
              onAddWorktree={handleAddWorktree}
              onDeleteWorktree={handleDeleteWorktree}
              onCloseWorktree={handleCloseWorktree}
              onCloseProject={handleCloseProject}
              onHideProject={handleHideProject}
              onMergeWorktree={handleMergeWorktree}
              onToggleDrawer={handleToggleDrawer}
              onToggleRightPanel={handleToggleRightPanel}
              onSelectTask={handleSelectTask}
              onStartTask={handleStartTask}
              onStopTask={handleStopTask}
              onForceKillTask={handleForceKillTask}
              onRenameWorktree={renameWorktree}
              onReorderProjects={handleReorderProjects}
              onReorderWorktrees={handleReorderWorktrees}
              onAddScratchTerminal={handleAddScratchTerminal}
              onSelectScratch={handleSelectScratch}
              onCloseScratch={handleCloseScratch}
              onRenameScratch={handleRenameScratch}
              onReorderScratchTerminals={handleReorderScratchTerminals}
              onAutoEditConsumed={() => setAutoEditWorktreeId(null)}
              onEditingScratchConsumed={() => setEditingScratchId(null)}
              onOpenInDrawer={handleOpenInDrawer}
              onOpenInTab={handleOpenInTab}
            />
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-resize-handle hover:bg-resize-handle-hover transition-colors focus:outline-none !cursor-col-resize" />

        {/* Main Pane with Drawer - vertical layout */}
        <Panel minSize="300px">
          <PanelGroup
            orientation="vertical"
            className="h-full"
          >
            <Panel panelRef={mainPanelRef} minSize="0px" collapsible collapsedSize="0px">
              <div
                className="h-full transition-opacity duration-150"
                style={{ opacity: activeFocusState === 'drawer' ? config.unfocusedOpacity : 1 }}
              >
                <MainPane
                  sessions={sessions}
                  openSessionIds={openSessionIds}
                  activeSessionId={activeSessionId}
                  allSessionTabs={sessionTabs}
                  activeSessionTabId={activeSessionTabId}
                  sessionLastActiveTabIds={sessionLastActiveTabIds}
                  isCtrlKeyHeld={isModifierKeyHeld && !isPickerOpen}
                  onSelectSessionTab={handleSelectSessionTab}
                  onCloseSessionTab={handleCloseSessionTab}
                  onAddSessionTab={handleAddSessionTab}
                  onReorderSessionTabs={handleReorderSessionTabs}
                  terminalConfig={mainTerminalConfig}
                  editorConfig={config.main}
                  activityTimeout={config.indicators.activityTimeout}
                  shouldAutoFocus={activeFocusState === 'main'}
                  focusTrigger={mainFocusTrigger}
                  configErrors={configErrors}
                  onFocus={handleMainPaneFocused}
                  onWorktreeNotification={handleWorktreeNotification}
                  onWorktreeThinkingChange={handleWorktreeThinkingChange}
                  onProjectNotification={handleProjectNotification}
                  onProjectThinkingChange={handleProjectThinkingChange}
                  onScratchNotification={handleScratchNotification}
                  onScratchThinkingChange={handleScratchThinkingChange}
                  onScratchCwdChange={handleScratchCwdChange}
                  onClearNotification={clearNotification}
                  onTabTitleChange={updateSessionTabLabel}
                  onPtyIdReady={setSessionPtyId}
                />
              </div>
            </Panel>

            {/* Drawer Panel - collapsible */}
            <PanelResizeHandle
              className={`transition-colors focus:outline-none !cursor-row-resize ${
                isDrawerOpen && !isDrawerExpanded
                  ? 'h-px bg-resize-handle hover:bg-resize-handle-hover'
                  : 'h-0 pointer-events-none'
              }`}
            />
            <Panel
              panelRef={drawerPanelRef}
              defaultSize="0px"
              minSize="100px"
              maxSize={isDrawerExpanded ? "100%" : "70%"}
              collapsible
              collapsedSize="0px"
              onResize={handleDrawerResize}
            >
              <div
                className="h-full overflow-hidden transition-opacity duration-150"
                style={{ opacity: activeFocusState === 'main' ? config.unfocusedOpacity : 1 }}
              >
                <Drawer
                  isOpen={isDrawerOpen}
                  isExpanded={isDrawerExpanded}
                  worktreeId={activeEntityId}
                  tabs={activeDrawerTabs}
                  activeTabId={activeDrawerTabId}
                  taskStatuses={activeTaskStatuses}
                  isCtrlKeyHeld={isModifierKeyHeld && !isPickerOpen}
                  onSelectTab={handleSelectDrawerTab}
                  onCloseTab={handleCloseDrawerTab}
                  onAddTab={handleAddDrawerTab}
                  onToggleExpand={handleToggleDrawerExpand}
                  onReorderTabs={handleReorderDrawerTabs}
                >
                  {/* Render ALL terminals for ALL entities to keep them alive */}
                  {Array.from(drawerTabs.entries()).flatMap(([entityId, tabs]) =>
                    tabs.map((tab) => (
                      <div
                        key={tab.id}
                        className={`absolute inset-0 ${
                          entityId === activeEntityId &&
                          isDrawerOpen &&
                          tab.id === activeDrawerTabId
                            ? 'visible z-10'
                            : 'invisible z-0 pointer-events-none'
                        }`}
                      >
                        {tab.type === 'task' && tab.taskName ? (
                          <TaskTerminal
                            id={tab.id}
                            entityId={entityId}
                            taskName={tab.taskName}
                            isActive={
                              entityId === activeEntityId &&
                              isDrawerOpen &&
                              tab.id === activeDrawerTabId
                            }
                            shouldAutoFocus={
                              entityId === activeEntityId &&
                              isDrawerOpen &&
                              tab.id === activeDrawerTabId &&
                              activeFocusState === 'drawer'
                            }
                            terminalConfig={drawerTerminalConfig}
                            onPtyIdReady={(ptyId) => handleTaskPtyIdReady(entityId, tab.taskName!, ptyId)}
                            onTaskExit={(exitCode) => handleTaskExit(entityId, tab.taskName!, exitCode)}
                            onFocus={() => handleDrawerFocused(entityId)}
                          />
                        ) : tab.type === 'action' && tab.actionPrompt ? (
                          <ActionTerminal
                            id={tab.id}
                            worktreeId={entityId}
                            actionType={tab.actionType}
                            actionPrompt={tab.actionPrompt}
                            mergeOptions={tab.mergeOptions}
                            strategy={tab.strategy}
                            isActive={
                              entityId === activeEntityId &&
                              isDrawerOpen &&
                              tab.id === activeDrawerTabId
                            }
                            shouldAutoFocus={
                              entityId === activeEntityId &&
                              isDrawerOpen &&
                              tab.id === activeDrawerTabId &&
                              activeFocusState === 'drawer'
                            }
                            terminalConfig={drawerTerminalConfig}
                            onFocus={() => handleDrawerFocused(entityId)}
                          />
                        ) : (
                          <DrawerTerminal
                            id={tab.id}
                            entityId={entityId}
                            directory={tab.directory ?? getEntityDirectory(entityId)}
                            command={tab.command}
                            isActive={
                              entityId === activeEntityId &&
                              isDrawerOpen &&
                              tab.id === activeDrawerTabId
                            }
                            shouldAutoFocus={
                              entityId === activeEntityId &&
                              isDrawerOpen &&
                              tab.id === activeDrawerTabId &&
                              activeFocusState === 'drawer'
                            }
                            terminalConfig={drawerTerminalConfig}
                            onClose={() => handleCloseDrawerTab(tab.id, entityId)}
                            onFocus={() => handleDrawerFocused(entityId)}
                            onPtyIdReady={(ptyId) => handleDrawerPtyIdReady(tab.id, ptyId)}
                            onTitleChange={(title) => updateDrawerTabLabel(entityId, tab.id, title)}
                          />
                        )}
                      </div>
                    ))
                  )}
                </Drawer>
              </div>
            </Panel>
          </PanelGroup>
        </Panel>

        {/* Right Panel - collapsible (only for worktrees/projects, not scratch) */}
        <PanelResizeHandle
          className={`w-px transition-colors focus:outline-none !cursor-col-resize ${
            (activeWorktreeId || (activeProjectId && !activeScratchId)) && isRightPanelOpen
              ? 'bg-resize-handle hover:bg-resize-handle-hover'
              : 'bg-transparent pointer-events-none'
          }`}
        />
        <Panel
          panelRef={rightPanelRef}
          defaultSize="0px"
          minSize="150px"
          maxSize="450px"
          collapsible
          collapsedSize="0px"
          onResize={handleRightPanelResize}
        >
          <div className="h-full w-full overflow-hidden">
            <RightPanel
              changedFiles={changedFiles}
              isGitRepo={isGitRepo}
              loading={changedFilesLoading}
              mode={changedFilesMode}
              onModeChange={setChangedFilesMode}
              showModeToggle={showChangedFilesModeToggle ?? false}
              onFileClick={handleFileClick}
              selectedFile={activeDiffState.currentFilePath}
            />
          </div>
        </Panel>
      </PanelGroup>

      {/* Toast notifications */}
      <ToastContainer toasts={toasts} onDismiss={dismissToast} />
    </div>
    </ThemeProvider>
  );
}

export default App;

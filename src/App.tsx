import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, PanelImperativeHandle } from 'react-resizable-panels';
import { listen } from '@tauri-apps/api/event';
import { Sidebar } from './components/Sidebar/Sidebar';
import { MainPane } from './components/MainPane/MainPane';
import { RightPanel } from './components/RightPanel/RightPanel';
import { Drawer, DrawerTab } from './components/Drawer/Drawer';
import { DrawerTerminal } from './components/Drawer/DrawerTerminal';
import { TaskTerminal } from './components/Drawer/TaskTerminal';
import { ActionTerminal } from './components/Drawer/ActionTerminal';
import { ConfirmModal } from './components/ConfirmModal';
import { DeleteWorktreeModal } from './components/DeleteWorktreeModal';
import { MergeModal } from './components/MergeModal';
import { StashModal } from './components/StashModal';
import { ShutdownScreen } from './components/ShutdownScreen';
import { TaskSwitcher } from './components/TaskSwitcher/TaskSwitcher';
import { useWorktrees } from './hooks/useWorktrees';
import { useGitStatus } from './hooks/useGitStatus';
import { useConfig } from './hooks/useConfig';
import { selectFolder, shutdown, ptyKill, ptyForceKill, stashChanges, stashPop, reorderProjects, reorderWorktrees, expandActionPrompt, ActionPromptContext } from './lib/tauri';
import { arrayMove } from '@dnd-kit/sortable';
import { sendOsNotification } from './lib/notifications';
import { matchesShortcut } from './lib/keyboard';
import { Project, Worktree, RunningTask, MergeCompleted } from './types';

const EXPANDED_PROJECTS_KEY = 'onemanband:expandedProjects';
const SHOW_ACTIVE_ONLY_KEY = 'onemanband:showActiveOnly';
const ACTIVE_PROJECTS_KEY = 'onemanband:activeProjects';
const SELECTED_TASKS_KEY = 'onemanband:selectedTasks';

// Zoom constants
const ZOOM_STEP = 2; // pixels per zoom level
const MIN_ZOOM = -5; // minimum zoom level
const MAX_ZOOM = 10; // maximum zoom level

// Which pane has focus per worktree
type FocusedPane = 'main' | 'drawer';

function App() {
  const { projects, addProject, removeProject, createWorktree, renameWorktree, reorderProjectsOptimistic, reorderWorktreesOptimistic, refresh: refreshProjects } = useWorktrees();


  // Get project path first for config loading (derived below after activeWorktreeId is defined)
  const [activeWorktreeId, setActiveWorktreeId] = useState<string | null>(null);

  // Active project (when viewing main repo terminal instead of a worktree)
  // If activeWorktreeId is set, activeProjectId indicates which project's worktree is active
  // If activeWorktreeId is null and activeProjectId is set, we're viewing the project's main terminal
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

  // Previous view state (for cmd+' to toggle back)
  const [previousView, setPreviousView] = useState<{ worktreeId: string | null; projectId: string | null } | null>(null);

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

  // Open worktrees (main terminals are kept alive for these)
  const [openWorktreeIds, setOpenWorktreeIds] = useState<Set<string>>(new Set());

  // Global panel open/closed state (shared across all worktrees)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isDrawerExpanded, setIsDrawerExpanded] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);

  // Zoom levels per pane type (not persisted across sessions)
  const [mainZoom, setMainZoom] = useState(0);
  const [drawerZoom, setDrawerZoom] = useState(0);

  // Per-worktree drawer tab state
  const [drawerTabs, setDrawerTabs] = useState<Map<string, DrawerTab[]>>(new Map());
  const [drawerActiveTabIds, setDrawerActiveTabIds] = useState<Map<string, string>>(new Map());
  const [drawerTabCounters, setDrawerTabCounters] = useState<Map<string, number>>(new Map());

  // Per-worktree focus state (which pane has focus)
  const [focusStates, setFocusStates] = useState<Map<string, FocusedPane>>(new Map());

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

  // Track PTY IDs for drawer terminals (tab ID -> PTY ID)
  const [drawerPtyIds, setDrawerPtyIds] = useState<Map<string, string>>(new Map());

  // Get current project's selected task
  const activeSelectedTask = activeProjectPath ? selectedTasksByProject.get(activeProjectPath) ?? null : null;

  // Active entity ID - worktree takes precedence, otherwise use project
  // This allows drawer/focus/task state to work for both views
  const activeEntityId = activeWorktreeId ?? activeProjectId;

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
  const [pendingRemoveProject, setPendingRemoveProject] = useState<Project | null>(null);
  const [pendingMergeId, setPendingMergeId] = useState<string | null>(null);
  const [pendingStashProject, setPendingStashProject] = useState<Project | null>(null);
  const [isTaskSwitcherOpen, setIsTaskSwitcherOpen] = useState(false);
  const [isStashing, setIsStashing] = useState(false);
  const [stashError, setStashError] = useState<string | null>(null);
  const [loadingWorktrees, setLoadingWorktrees] = useState<Set<string>>(new Set());
  const [notifiedWorktreeIds, setNotifiedWorktreeIds] = useState<Set<string>>(new Set());
  const [thinkingWorktreeIds, setThinkingWorktreeIds] = useState<Set<string>>(new Set());
  const [idleWorktreeIds, setIdleWorktreeIds] = useState<Set<string>>(new Set());
  const [notifiedProjectIds, setNotifiedProjectIds] = useState<Set<string>>(new Set());
  const [thinkingProjectIds, setThinkingProjectIds] = useState<Set<string>>(new Set());
  const [idleProjectIds, setIdleProjectIds] = useState<Set<string>>(new Set());
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isModifierKeyHeld, setIsModifierKeyHeld] = useState(false);

  // Centralized modal open tracking - modals register themselves on mount/unmount
  const [modalCount, setModalCount] = useState(0);
  const onModalOpen = useCallback(() => setModalCount(c => c + 1), []);
  const onModalClose = useCallback(() => setModalCount(c => c - 1), []);
  const isModalOpen = modalCount > 0;

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

  // Persist expanded projects to localStorage
  useEffect(() => {
    localStorage.setItem(EXPANDED_PROJECTS_KEY, JSON.stringify([...expandedProjects]));
  }, [expandedProjects]);

  // Show active projects only toggle - persisted to localStorage
  const [showActiveOnly, setShowActiveOnly] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(SHOW_ACTIVE_ONLY_KEY);
      if (saved !== null) {
        return JSON.parse(saved);
      }
    } catch (e) {
      console.error('Failed to load showActiveOnly:', e);
    }
    return false;
  });

  // Persist showActiveOnly to localStorage
  useEffect(() => {
    localStorage.setItem(SHOW_ACTIVE_ONLY_KEY, JSON.stringify(showActiveOnly));
  }, [showActiveOnly]);

  // Track projects marked as active (persisted to localStorage)
  // This prevents hiding a project we're actively working in
  const [sessionTouchedProjects, setSessionTouchedProjects] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(ACTIVE_PROJECTS_KEY);
      if (saved) {
        return new Set(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load active projects:', e);
    }
    return new Set();
  });

  // Persist active projects to localStorage
  useEffect(() => {
    localStorage.setItem(ACTIVE_PROJECTS_KEY, JSON.stringify([...sessionTouchedProjects]));
  }, [sessionTouchedProjects]);

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

  const { files: changedFiles } = useGitStatus(gitStatusTarget);

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

  // Worktree notification handler
  const handleWorktreeNotification = useCallback((worktreeId: string, title: string, body: string) => {
    setNotifiedWorktreeIds((prev) => new Set([...prev, worktreeId]));
    // Only send OS notification if this worktree is not active
    if (worktreeId !== activeWorktreeId) {
      // Use worktree name as title if not provided
      const notificationTitle = title || (() => {
        for (const project of projects) {
          const wt = project.worktrees.find(w => w.id === worktreeId);
          if (wt) return wt.name;
        }
        return 'One Man Band';
      })();
      sendOsNotification(notificationTitle, body);
    }
  }, [activeWorktreeId, projects]);

  // Clear notification and idle state when worktree becomes active
  useEffect(() => {
    if (activeWorktreeId) {
      if (notifiedWorktreeIds.has(activeWorktreeId)) {
        setNotifiedWorktreeIds((prev) => {
          const next = new Set(prev);
          next.delete(activeWorktreeId);
          return next;
        });
      }
      if (idleWorktreeIds.has(activeWorktreeId)) {
        setIdleWorktreeIds((prev) => {
          const next = new Set(prev);
          next.delete(activeWorktreeId);
          return next;
        });
      }
    }
  }, [activeWorktreeId, notifiedWorktreeIds, idleWorktreeIds]);

  // Worktree thinking state handler (for showing loading indicator when Claude is thinking)
  const handleWorktreeThinkingChange = useCallback((worktreeId: string, isThinking: boolean) => {
    setThinkingWorktreeIds((prev) => {
      if (isThinking) {
        // Clear idle when thinking starts
        setIdleWorktreeIds((idlePrev) => {
          if (!idlePrev.has(worktreeId)) return idlePrev;
          const next = new Set(idlePrev);
          next.delete(worktreeId);
          return next;
        });
        if (prev.has(worktreeId)) return prev;
        return new Set([...prev, worktreeId]);
      } else {
        // Set idle when thinking stops (only if was thinking)
        if (prev.has(worktreeId)) {
          setIdleWorktreeIds((idlePrev) => {
            if (idlePrev.has(worktreeId)) return idlePrev;
            return new Set([...idlePrev, worktreeId]);
          });
        }
        if (!prev.has(worktreeId)) return prev;
        const next = new Set(prev);
        next.delete(worktreeId);
        return next;
      }
    });
  }, []);

  // Project notification handler
  const handleProjectNotification = useCallback((projectId: string, title: string, body: string) => {
    setNotifiedProjectIds((prev) => new Set([...prev, projectId]));
    // Only send OS notification if this project is not active (or a worktree is active)
    if (activeWorktreeId || projectId !== activeProjectId) {
      const notificationTitle = title || (() => {
        const project = projects.find(p => p.id === projectId);
        return project?.name ?? 'One Man Band';
      })();
      sendOsNotification(notificationTitle, body);
    }
  }, [activeWorktreeId, activeProjectId, projects]);

  // Clear notification and idle state when project becomes active
  useEffect(() => {
    if (!activeWorktreeId && activeProjectId) {
      if (notifiedProjectIds.has(activeProjectId)) {
        setNotifiedProjectIds((prev) => {
          const next = new Set(prev);
          next.delete(activeProjectId);
          return next;
        });
      }
      if (idleProjectIds.has(activeProjectId)) {
        setIdleProjectIds((prev) => {
          const next = new Set(prev);
          next.delete(activeProjectId);
          return next;
        });
      }
    }
  }, [activeWorktreeId, activeProjectId, notifiedProjectIds, idleProjectIds]);

  // Project thinking state handler
  const handleProjectThinkingChange = useCallback((projectId: string, isThinking: boolean) => {
    setThinkingProjectIds((prev) => {
      if (isThinking) {
        // Clear idle when thinking starts
        setIdleProjectIds((idlePrev) => {
          if (!idlePrev.has(projectId)) return idlePrev;
          const next = new Set(idlePrev);
          next.delete(projectId);
          return next;
        });
        if (prev.has(projectId)) return prev;
        return new Set([...prev, projectId]);
      } else {
        // Set idle when thinking stops (only if was thinking)
        if (prev.has(projectId)) {
          setIdleProjectIds((idlePrev) => {
            if (idlePrev.has(projectId)) return idlePrev;
            return new Set([...idlePrev, projectId]);
          });
        }
        if (!prev.has(projectId)) return prev;
        const next = new Set(prev);
        next.delete(projectId);
        return next;
      }
    });
  }, []);

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

  // Switch to previous view (cmd+' toggle)
  const handleSwitchToPreviousView = useCallback(() => {
    if (!previousView) return;

    // Check if previous view is still valid (worktree/project still exists and is open)
    const prevWorktreeId = previousView.worktreeId;
    const prevProjectId = previousView.projectId;

    // Save current view before switching
    const currentView = { worktreeId: activeWorktreeId, projectId: activeProjectId };

    if (prevWorktreeId && openWorktreeIds.has(prevWorktreeId)) {
      // Switch to previous worktree
      setActiveWorktreeId(prevWorktreeId);
      // Update project context if needed
      if (prevProjectId) {
        setActiveProjectId(prevProjectId);
      }
      setPreviousView(currentView);
    } else if (prevProjectId && openProjectIds.has(prevProjectId)) {
      // Switch to previous project view
      setActiveWorktreeId(null);
      setActiveProjectId(prevProjectId);
      setPreviousView(currentView);
    }
    // If previous view is no longer valid, do nothing
  }, [previousView, activeWorktreeId, activeProjectId, openWorktreeIds, openProjectIds]);

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

  // Adjusted terminal configs with zoom applied
  const mainTerminalConfig = useMemo(() => ({
    ...config.main,
    fontSize: config.main.fontSize + (mainZoom * ZOOM_STEP),
  }), [config.main, mainZoom]);

  const drawerTerminalConfig = useMemo(() => ({
    ...config.terminal,
    fontSize: config.terminal.fontSize + (drawerZoom * ZOOM_STEP),
  }), [config.terminal, drawerZoom]);

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
    setIsTaskSwitcherOpen(prev => !prev);
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
    const path = await selectFolder();
    if (path) {
      try {
        const project = await addProject(path);
        setExpandedProjects((prev) => new Set([...prev, project.id]));
        // Activate the newly added project immediately
        setSessionTouchedProjects((prev) => new Set([...prev, project.id]));
        setOpenProjectIds((prev) => new Set([...prev, project.id]));
        setActiveWorktreeId(null);
        setActiveProjectId(project.id);
      } catch (err) {
        console.error('Failed to add project:', err);
      }
    }
  }, [addProject]);

  const handleAddWorktree = useCallback(
    async (projectId: string) => {
      console.log('[handleAddWorktree] Called with projectId:', projectId);
      const project = projects.find((p) => p.id === projectId);
      if (!project) {
        console.log('[handleAddWorktree] Project not found');
        return;
      }
      console.log('[handleAddWorktree] Found project:', project.name, 'path:', project.path);

      setExpandedProjects((prev) => new Set([...prev, projectId]));
      // Mark project as touched this session so it stays visible
      setSessionTouchedProjects((prev) => new Set([...prev, projectId]));

      console.log('[handleAddWorktree] About to call createWorktree...');
      try {
        const worktree = await createWorktree(project.path);
        console.log('[handleAddWorktree] createWorktree succeeded:', worktree.name);
        setLoadingWorktrees((prev) => new Set([...prev, worktree.id]));
        setOpenWorktreeIds((prev) => new Set([...prev, worktree.id]));
        setActiveWorktreeId(worktree.id);
      } catch (err) {
        const errorMessage = String(err);
        console.log('[handleAddWorktree] Error caught:', errorMessage);
        console.log('[handleAddWorktree] Error type:', typeof err);
        console.log('[handleAddWorktree] Error object:', err);
        // Check if this is an uncommitted changes error
        if (errorMessage.includes('uncommitted changes')) {
          console.log('[handleAddWorktree] Showing stash modal for project:', project.name);
          setStashError(null); // Clear any previous error
          setPendingStashProject(project);
        } else {
          console.error('Failed to create worktree:', err);
        }
      }
    },
    [projects, createWorktree]
  );

  const handleStashAndCreate = useCallback(async () => {
    if (!pendingStashProject) return;

    const project = pendingStashProject;
    setIsStashing(true);
    console.log('[handleStashAndCreate] Starting for project:', project.path);

    let stashId: string | null = null;

    try {
      // Stash the changes and get the stash ID
      console.log('[handleStashAndCreate] Stashing changes...');
      stashId = await stashChanges(project.path);
      console.log('[handleStashAndCreate] Stash successful with id:', stashId);

      // Create the worktree
      console.log('[handleStashAndCreate] Creating worktree...');
      const worktree = await createWorktree(project.path);
      console.log('[handleStashAndCreate] Worktree created:', worktree.name);

      // Pop the stash to restore changes
      console.log('[handleStashAndCreate] Popping stash with id:', stashId);
      await stashPop(project.path, stashId);
      console.log('[handleStashAndCreate] Stash popped');

      // Update UI state
      setLoadingWorktrees((prev) => new Set([...prev, worktree.id]));
      setOpenWorktreeIds((prev) => new Set([...prev, worktree.id]));
      setActiveWorktreeId(worktree.id);
      setPendingStashProject(null);
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
  }, [pendingStashProject, createWorktree]);

  const handleSelectWorktree = useCallback((worktree: Worktree) => {
    // Mark the project as active and auto-open its project terminal
    const project = projects.find((p) => p.worktrees.some((w) => w.id === worktree.id));
    if (project) {
      setSessionTouchedProjects((prev) => new Set([...prev, project.id]));
      // Save current view as previous before switching (only if actually changing)
      if (activeWorktreeId !== worktree.id) {
        setPreviousView({ worktreeId: activeWorktreeId, projectId: activeProjectId });
      }
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
  }, [projects, activeWorktreeId, activeProjectId]);

  const handleSelectProject = useCallback((project: Project) => {
    // Mark the project as active (touched this session)
    setSessionTouchedProjects((prev) => new Set([...prev, project.id]));
    // Add to open projects if not already
    setOpenProjectIds((prev) => {
      if (prev.has(project.id)) return prev;
      return new Set([...prev, project.id]);
    });
    // Save current view as previous before switching
    setPreviousView({ worktreeId: activeWorktreeId, projectId: activeProjectId });
    // Clear worktree selection, set project as active
    setActiveWorktreeId(null);
    setActiveProjectId(project.id);
  }, [activeWorktreeId, activeProjectId]);

  const handleCloseProject = useCallback((projectId: string) => {
    setOpenProjectIds((prev) => {
      const next = new Set(prev);
      next.delete(projectId);
      return next;
    });
    // If this was the active project with no worktree selected, switch to another
    if (activeProjectId === projectId && !activeWorktreeId) {
      const remainingProjects = Array.from(openProjectIds).filter(id => id !== projectId);
      if (remainingProjects.length > 0) {
        setActiveProjectId(remainingProjects[remainingProjects.length - 1]);
      } else if (openWorktreeIds.size > 0) {
        // Switch to an open worktree
        const firstWorktreeId = Array.from(openWorktreeIds)[0];
        setActiveWorktreeId(firstWorktreeId);
        // Find and set the project for this worktree
        for (const project of projects) {
          if (project.worktrees.some(w => w.id === firstWorktreeId)) {
            setActiveProjectId(project.id);
            break;
          }
        }
      } else {
        setActiveProjectId(null);
      }
    }
  }, [activeProjectId, activeWorktreeId, openProjectIds, openWorktreeIds, projects]);

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
      // Mark the project as session-touched so it stays visible after deletion
      const project = projects.find((p) => p.worktrees.some((w) => w.id === worktreeId));
      if (project) {
        setSessionTouchedProjects((prev) => new Set([...prev, project.id]));
      }

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

  const handleRemoveProject = useCallback((project: Project) => {
    setPendingRemoveProject(project);
  }, []);

  // Mark a project as inactive (remove from session touched)
  const handleMarkProjectInactive = useCallback((projectId: string) => {
    setSessionTouchedProjects((prev) => {
      const next = new Set(prev);
      next.delete(projectId);
      return next;
    });
  }, []);

  const handleMergeWorktree = useCallback((worktreeId: string) => {
    setPendingMergeId(worktreeId);
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

  const confirmRemoveProject = useCallback(async () => {
    if (!pendingRemoveProject) return;
    try {
      const projectWorktreeIds = new Set(pendingRemoveProject.worktrees.map((w) => w.id));
      setOpenWorktreeIds((prev) => {
        const next = new Set(prev);
        for (const id of projectWorktreeIds) {
          next.delete(id);
        }
        return next;
      });
      // Clean up drawer tabs and focus states for project worktrees
      setDrawerTabs((prev) => {
        const next = new Map(prev);
        for (const id of projectWorktreeIds) {
          next.delete(id);
        }
        return next;
      });
      setDrawerActiveTabIds((prev) => {
        const next = new Map(prev);
        for (const id of projectWorktreeIds) {
          next.delete(id);
        }
        return next;
      });
      setDrawerTabCounters((prev) => {
        const next = new Map(prev);
        for (const id of projectWorktreeIds) {
          next.delete(id);
        }
        return next;
      });
      setFocusStates((prev) => {
        const next = new Map(prev);
        for (const id of projectWorktreeIds) {
          next.delete(id);
        }
        return next;
      });
      if (activeWorktreeId && projectWorktreeIds.has(activeWorktreeId)) {
        setActiveWorktreeId(null);
      }
      // Close drawer and right panel when no worktrees remain
      const remainingOpenWorktrees = Array.from(openWorktreeIds).filter(
        id => !projectWorktreeIds.has(id)
      );
      if (remainingOpenWorktrees.length === 0) {
        setIsDrawerOpen(false);
        drawerPanelRef.current?.collapse();
        setIsRightPanelOpen(false);
        rightPanelRef.current?.collapse();
      }
      await removeProject(pendingRemoveProject.id);
    } catch (err) {
      console.error('Failed to remove project:', err);
    } finally {
      setPendingRemoveProject(null);
    }
  }, [removeProject, pendingRemoveProject, activeWorktreeId, openWorktreeIds]);

  // Keyboard shortcuts
  useEffect(() => {
    const { mappings } = config;
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      // Track modifier key state (cmd on mac, ctrl on other)
      if ((isMac && e.metaKey) || (!isMac && e.ctrlKey)) {
        setIsModifierKeyHeld(true);
      }

      // Worktree selection by index (1-9)
      const worktreeShortcuts = [
        mappings.worktree1,
        mappings.worktree2,
        mappings.worktree3,
        mappings.worktree4,
        mappings.worktree5,
        mappings.worktree6,
        mappings.worktree7,
        mappings.worktree8,
        mappings.worktree9,
      ];
      for (let i = 0; i < worktreeShortcuts.length; i++) {
        if (matchesShortcut(e, worktreeShortcuts[i]) && i < openWorktreesInOrder.length) {
          e.preventDefault();
          setActiveWorktreeId(openWorktreesInOrder[i]);
          break;
        }
      }

      // Zoom shortcuts (must come before Cmd+0 check since zoomReset uses Cmd+Shift+0)
      if (matchesShortcut(e, mappings.zoomIn)) {
        e.preventDefault();
        handleZoomIn();
        return;
      }

      if (matchesShortcut(e, mappings.zoomOut)) {
        e.preventDefault();
        handleZoomOut();
        return;
      }

      if (matchesShortcut(e, mappings.zoomReset)) {
        e.preventDefault();
        handleZoomReset();
        return;
      }

      // Cmd+0: Switch from worktree to project view (hardcoded, not configurable)
      if ((e.metaKey || e.ctrlKey) && e.key === '0' && activeWorktreeId && activeProjectId) {
        e.preventDefault();
        // Save current view as previous before switching
        setPreviousView({ worktreeId: activeWorktreeId, projectId: activeProjectId });
        setActiveWorktreeId(null);
        return;
      }

      // Switch focus between main and drawer (works even without active worktree selection)
      if (matchesShortcut(e, mappings.switchFocus)) {
        e.preventDefault();
        handleSwitchFocus();
        return;
      }

      // Switch to previous view (cmd+' toggle)
      if (matchesShortcut(e, mappings.previousView)) {
        e.preventDefault();
        handleSwitchToPreviousView();
        return;
      }

      // Drawer/panel shortcuts work for both project and worktree views
      if (activeEntityId) {
        if (matchesShortcut(e, mappings.toggleDrawer)) {
          e.preventDefault();
          handleToggleDrawer();
        }

        // Expand/collapse drawer (only when drawer is open)
        if (isDrawerOpen && matchesShortcut(e, mappings.expandDrawer)) {
          e.preventDefault();
          e.stopPropagation();
          handleToggleDrawerExpand();
          return;
        }

        // Cmd+T to add new terminal tab (when drawer is open)
        if ((e.metaKey || e.ctrlKey) && e.key === 't' && isDrawerOpen) {
          e.preventDefault();
          handleAddDrawerTab();
        }

        // Cmd+W to close active terminal tab (when drawer is open)
        if ((e.metaKey || e.ctrlKey) && e.key === 'w' && isDrawerOpen) {
          e.preventDefault();
          if (activeDrawerTabId) {
            handleCloseDrawerTab(activeDrawerTabId);
          }
        }

        // Ctrl+Tab / Ctrl+Shift+Tab to cycle through drawer tabs (when drawer is open and focused)
        if (e.ctrlKey && e.key === 'Tab' && isDrawerOpen && activeFocusState === 'drawer' && activeDrawerTabs.length > 1) {
          e.preventDefault();
          e.stopPropagation();
          const currentIndex = activeDrawerTabs.findIndex(tab => tab.id === activeDrawerTabId);
          if (currentIndex !== -1) {
            let nextIndex: number;
            if (e.shiftKey) {
              // Ctrl+Shift+Tab: previous tab
              nextIndex = currentIndex === 0 ? activeDrawerTabs.length - 1 : currentIndex - 1;
            } else {
              // Ctrl+Tab: next tab
              nextIndex = currentIndex === activeDrawerTabs.length - 1 ? 0 : currentIndex + 1;
            }
            handleSelectDrawerTab(activeDrawerTabs[nextIndex].id);
          }
          return;
        }

        if (matchesShortcut(e, mappings.toggleRightPanel)) {
          e.preventDefault();
          handleToggleRightPanel();
        }
      }

      // Worktree navigation - cycle through active worktrees in sidebar order
      // Works from both worktree view (cycles) and project view (selects first/last)
      if (openWorktreesInOrder.length > 0) {
        if (activeWorktreeId) {
          // Currently viewing a worktree - cycle through them
          const currentIndex = openWorktreesInOrder.indexOf(activeWorktreeId);
          if (currentIndex !== -1) {
            if (matchesShortcut(e, mappings.worktreePrev)) {
              e.preventDefault();
              const prevIndex = currentIndex === 0 ? openWorktreesInOrder.length - 1 : currentIndex - 1;
              setActiveWorktreeId(openWorktreesInOrder[prevIndex]);
            }
            if (matchesShortcut(e, mappings.worktreeNext)) {
              e.preventDefault();
              const nextIndex = currentIndex === openWorktreesInOrder.length - 1 ? 0 : currentIndex + 1;
              setActiveWorktreeId(openWorktreesInOrder[nextIndex]);
            }
          }
        } else {
          // Currently viewing a project - select first/last worktree
          if (matchesShortcut(e, mappings.worktreePrev)) {
            e.preventDefault();
            setActiveWorktreeId(openWorktreesInOrder[openWorktreesInOrder.length - 1]);
          }
          if (matchesShortcut(e, mappings.worktreeNext)) {
            e.preventDefault();
            setActiveWorktreeId(openWorktreesInOrder[0]);
          }
        }
      }

      // Task shortcuts - work for both project and worktree views
      if (activeEntityId) {
        // Run/stop task toggle
        if (matchesShortcut(e, mappings.runTask)) {
          e.preventDefault();
          handleToggleTask();
        }
      }

      // Task switcher
      if (matchesShortcut(e, mappings.taskSwitcher)) {
        e.preventDefault();
        handleToggleTaskSwitcher();
        return;
      }

      // New workspace (requires an active project)
      if (matchesShortcut(e, mappings.newWorkspace) && activeProjectId) {
        e.preventDefault();
        handleAddWorktree(activeProjectId);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      // Clear modifier key state when released
      if ((isMac && e.key === 'Meta') || (!isMac && e.key === 'Control')) {
        setIsModifierKeyHeld(false);
      }
    };

    // Clear modifier state when window loses focus
    const handleBlur = () => {
      setIsModifierKeyHeld(false);
    };

    // Use capture phase so shortcuts are handled before terminal consumes events
    window.addEventListener('keydown', handleKeyDown, true);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown, true);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [activeWorktreeId, activeProjectId, activeEntityId, isDrawerOpen, activeDrawerTabId, config, openWorktreesInOrder, handleToggleDrawer, handleToggleDrawerExpand, handleAddDrawerTab, handleCloseDrawerTab, handleToggleRightPanel, handleToggleTask, handleSwitchFocus, handleSwitchToPreviousView, handleAddWorktree, handleToggleTaskSwitcher, handleZoomIn, handleZoomOut, handleZoomReset]);

  const pendingWorktree = pendingDeleteId
    ? projects.flatMap((p) => p.worktrees).find((w) => w.id === pendingDeleteId)
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
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-zinc-950">
      {/* Shutdown screen overlay */}
      <ShutdownScreen isVisible={isShuttingDown} />

      {pendingDeleteId && pendingWorktree && (
        <DeleteWorktreeModal
          worktree={pendingWorktree}
          onClose={() => setPendingDeleteId(null)}
          onDeleteComplete={handleDeleteComplete}
          onModalOpen={onModalOpen}
          onModalClose={onModalClose}
        />
      )}

      {pendingRemoveProject && (
        <ConfirmModal
          title="Remove Project"
          message={
            pendingRemoveProject.worktrees.length > 0
              ? `Are you sure you want to remove "${pendingRemoveProject.name}"? This will also delete ${pendingRemoveProject.worktrees.length} worktree${pendingRemoveProject.worktrees.length === 1 ? '' : 's'} and cannot be undone.`
              : `Are you sure you want to remove "${pendingRemoveProject.name}"?`
          }
          confirmLabel="Remove"
          onConfirm={confirmRemoveProject}
          onCancel={() => setPendingRemoveProject(null)}
          onModalOpen={onModalOpen}
          onModalClose={onModalClose}
        />
      )}

      {pendingMergeInfo && (
        <MergeModal
          worktree={pendingMergeInfo.worktree}
          projectPath={pendingMergeInfo.projectPath}
          defaultConfig={config.merge}
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
              activeWorktree={activeWorktree}
              openProjectIds={openProjectIds}
              openWorktreeIds={openWorktreeIds}
              openWorktreesInOrder={openWorktreesInOrder}
              isModifierKeyHeld={isModifierKeyHeld && !isModalOpen}
              loadingWorktrees={loadingWorktrees}
              notifiedWorktreeIds={notifiedWorktreeIds}
              thinkingWorktreeIds={thinkingWorktreeIds}
              idleWorktreeIds={idleWorktreeIds}
              notifiedProjectIds={notifiedProjectIds}
              thinkingProjectIds={thinkingProjectIds}
              idleProjectIds={idleProjectIds}
              runningTaskCounts={runningTaskCounts}
              expandedProjects={expandedProjects}
              showActiveOnly={showActiveOnly}
              sessionTouchedProjects={sessionTouchedProjects}
              isDrawerOpen={isDrawerOpen}
              isRightPanelOpen={isRightPanelOpen}
              tasks={config.tasks}
              selectedTask={activeSelectedTask}
              runningTask={activeRunningTask && activeEntityId ? { ...activeRunningTask, worktreeId: activeEntityId, kind: config.tasks.find(t => t.name === activeRunningTask.taskName)?.kind ?? 'command' } : null}
              allRunningTasks={activeEntityId ? runningTasks.get(activeEntityId) ?? [] : []}
              terminalFontFamily={config.main.fontFamily}
              showIdleCheck={config.indicators.showIdleCheck}
              onToggleProject={toggleProject}
              onSelectProject={handleSelectProject}
              onSelectWorktree={handleSelectWorktree}
              onAddProject={handleAddProject}
              onAddWorktree={handleAddWorktree}
              onDeleteWorktree={handleDeleteWorktree}
              onCloseWorktree={handleCloseWorktree}
              onCloseProject={handleCloseProject}
              onMergeWorktree={handleMergeWorktree}
              onToggleDrawer={handleToggleDrawer}
              onToggleRightPanel={handleToggleRightPanel}
              onRemoveProject={handleRemoveProject}
              onMarkProjectInactive={handleMarkProjectInactive}
              onToggleShowActiveOnly={() => setShowActiveOnly(prev => !prev)}
              onSelectTask={handleSelectTask}
              onStartTask={handleStartTask}
              onStopTask={handleStopTask}
              onForceKillTask={handleForceKillTask}
              onRenameWorktree={renameWorktree}
              onReorderProjects={handleReorderProjects}
              onReorderWorktrees={handleReorderWorktrees}
            />
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-zinc-700 hover:bg-zinc-500 transition-colors focus:outline-none !cursor-col-resize" />

        {/* Main Pane with Drawer - vertical layout */}
        <Panel minSize="300px">
          <PanelGroup
            orientation="vertical"
            className="h-full"
          >
            <Panel panelRef={mainPanelRef} minSize="0px" collapsible collapsedSize="0px">
              <MainPane
                openWorktreeIds={openWorktreeIds}
                activeWorktreeId={activeWorktreeId}
                openProjectIds={openProjectIds}
                activeProjectId={activeProjectId}
                terminalConfig={mainTerminalConfig}
                mappings={config.mappings}
                activityTimeout={config.indicators.activityTimeout}
                shouldAutoFocus={activeFocusState === 'main'}
                configErrors={configErrors}
                onFocus={handleMainPaneFocused}
                onWorktreeNotification={handleWorktreeNotification}
                onWorktreeThinkingChange={handleWorktreeThinkingChange}
                onProjectNotification={handleProjectNotification}
                onProjectThinkingChange={handleProjectThinkingChange}
              />
            </Panel>

            {/* Drawer Panel - collapsible */}
            <PanelResizeHandle
              className={`transition-colors focus:outline-none !cursor-row-resize ${
                isDrawerOpen && !isDrawerExpanded
                  ? 'h-px bg-zinc-700 hover:bg-zinc-500'
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
              <div className="h-full overflow-hidden">
                <Drawer
                  isOpen={isDrawerOpen}
                  isExpanded={isDrawerExpanded}
                  worktreeId={activeEntityId}
                  tabs={activeDrawerTabs}
                  activeTabId={activeDrawerTabId}
                  taskStatuses={activeTaskStatuses}
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
                            mappings={config.mappings}
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
                            mappings={config.mappings}
                            onFocus={() => handleDrawerFocused(entityId)}
                          />
                        ) : (
                          <DrawerTerminal
                            id={tab.id}
                            worktreeId={entityId}
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
                            mappings={config.mappings}
                            onClose={() => handleCloseDrawerTab(tab.id, entityId)}
                            onFocus={() => handleDrawerFocused(entityId)}
                            onPtyIdReady={(ptyId) => handleDrawerPtyIdReady(tab.id, ptyId)}
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

        {/* Right Panel - collapsible */}
        <PanelResizeHandle
          className={`w-px transition-colors focus:outline-none !cursor-col-resize ${
            (activeWorktreeId || activeProjectId) && isRightPanelOpen
              ? 'bg-zinc-700 hover:bg-zinc-500'
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
            <RightPanel changedFiles={changedFiles} />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

export default App;

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, PanelImperativeHandle } from 'react-resizable-panels';
import { listen } from '@tauri-apps/api/event';
import { Sidebar } from './components/Sidebar/Sidebar';
import { MainPane } from './components/MainPane/MainPane';
import { ProjectPane } from './components/MainPane/ProjectPane';
import { RightPanel } from './components/RightPanel/RightPanel';
import { Drawer, DrawerTab } from './components/Drawer/Drawer';
import { DrawerTerminal } from './components/Drawer/DrawerTerminal';
import { TaskTerminal } from './components/Drawer/TaskTerminal';
import { ConfirmModal } from './components/ConfirmModal';
import { MergeModal } from './components/MergeModal';
import { StashModal } from './components/StashModal';
import { ShutdownScreen } from './components/ShutdownScreen';
import { TaskSwitcher } from './components/TaskSwitcher/TaskSwitcher';
import { useWorktrees } from './hooks/useWorktrees';
import { useGitStatus } from './hooks/useGitStatus';
import { useConfig } from './hooks/useConfig';
import { selectFolder, shutdown, ptyKill, ptyForceKill, stashChanges, stashPop } from './lib/tauri';
import { sendOsNotification } from './lib/notifications';
import { matchesShortcut } from './lib/keyboard';
import { Project, Worktree } from './types';
import { FolderGit2 } from 'lucide-react';

const EXPANDED_PROJECTS_KEY = 'onemanband:expandedProjects';
const SHOW_ACTIVE_ONLY_KEY = 'onemanband:showActiveOnly';
const ACTIVE_PROJECTS_KEY = 'onemanband:activeProjects';
const SELECTED_TASKS_KEY = 'onemanband:selectedTasks';

// Which pane has focus per worktree
type FocusedPane = 'main' | 'drawer';

function App() {
  const { projects, addProject, removeProject, createWorktree, deleteWorktree, refresh: refreshProjects } = useWorktrees();

  // Get project path first for config loading (derived below after activeWorktreeId is defined)
  const [activeWorktreeId, setActiveWorktreeId] = useState<string | null>(null);

  // Active project (when viewing main repo terminal instead of a worktree)
  // If activeWorktreeId is set, activeProjectId indicates which project's worktree is active
  // If activeWorktreeId is null and activeProjectId is set, we're viewing the project's main terminal
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);

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

  const { config } = useConfig(activeProjectPath);

  // Open worktrees (main terminals are kept alive for these)
  const [openWorktreeIds, setOpenWorktreeIds] = useState<Set<string>>(new Set());

  // Global panel open/closed state (shared across all worktrees)
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const [isRightPanelOpen, setIsRightPanelOpen] = useState(false);

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
  const [runningTasks, setRunningTasks] = useState<Map<string, Array<{ taskName: string; ptyId: string; status: 'running' | 'stopping' | 'stopped' }>>>(new Map());

  // Get current project's selected task
  const activeSelectedTask = activeProjectPath ? selectedTasksByProject.get(activeProjectPath) ?? null : null;
  // Find the running task that matches the selected task (for TaskSelector controls)
  const activeRunningTask = useMemo(() => {
    if (!activeWorktreeId || !activeSelectedTask) return null;
    const tasks = runningTasks.get(activeWorktreeId) ?? [];
    return tasks.find(t => t.taskName === activeSelectedTask) ?? null;
  }, [activeWorktreeId, activeSelectedTask, runningTasks]);

  // Task statuses map for the active worktree (for Drawer tab icons)
  const activeTaskStatuses = useMemo(() => {
    const statuses = new Map<string, 'running' | 'stopping' | 'stopped'>();
    if (!activeWorktreeId) return statuses;
    const tasks = runningTasks.get(activeWorktreeId) ?? [];
    for (const task of tasks) {
      statuses.set(task.taskName, task.status);
    }
    return statuses;
  }, [activeWorktreeId, runningTasks]);

  // Persist selected tasks to localStorage
  useEffect(() => {
    const obj = Object.fromEntries(selectedTasksByProject.entries());
    localStorage.setItem(SELECTED_TASKS_KEY, JSON.stringify(obj));
  }, [selectedTasksByProject]);

  // Get current worktree's drawer tabs
  const activeDrawerTabs = activeWorktreeId ? drawerTabs.get(activeWorktreeId) ?? [] : [];
  const activeDrawerTabId = activeWorktreeId ? drawerActiveTabIds.get(activeWorktreeId) ?? null : null;

  // Get current worktree's focus state (defaults to 'main')
  const activeFocusState = activeWorktreeId ? focusStates.get(activeWorktreeId) ?? 'main' : 'main';

  // Create a drawer tab when drawer is open but current worktree has no tabs
  useEffect(() => {
    if (!activeWorktreeId || !isDrawerOpen) return;
    if (activeDrawerTabs.length > 0) return;

    const currentCounter = drawerTabCounters.get(activeWorktreeId) ?? 0;
    const newCounter = currentCounter + 1;
    const newTab: DrawerTab = {
      id: `${activeWorktreeId}-drawer-${newCounter}`,
      label: `Terminal ${newCounter}`,
      type: 'terminal',
    };

    setDrawerTabs((prev) => {
      const next = new Map(prev);
      next.set(activeWorktreeId, [newTab]);
      return next;
    });
    setDrawerActiveTabIds((prev) => {
      const next = new Map(prev);
      next.set(activeWorktreeId, newTab.id);
      return next;
    });
    setDrawerTabCounters((prev) => {
      const next = new Map(prev);
      next.set(activeWorktreeId, newCounter);
      return next;
    });
  }, [activeWorktreeId, isDrawerOpen, activeDrawerTabs.length, drawerTabCounters]);

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
  const [isShuttingDown, setIsShuttingDown] = useState(false);
  const [isModifierKeyHeld, setIsModifierKeyHeld] = useState(false);

  // Panel refs
  const rightPanelRef = useRef<PanelImperativeHandle>(null);
  const lastRightPanelSize = useRef<number>(280); // Track last open size in pixels
  const drawerPanelRef = useRef<PanelImperativeHandle>(null);
  const lastDrawerSize = useRef<number>(250); // Track last open size in pixels

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
    if (!activeWorktreeId) return;

    const panel = drawerPanelRef.current;
    const willOpen = !isDrawerOpen;

    if (panel) {
      if (willOpen) {
        panel.resize(lastDrawerSize.current);
      } else {
        panel.collapse();
      }
    }

    // Create first tab if opening drawer with no tabs for this worktree
    if (willOpen) {
      const currentTabs = drawerTabs.get(activeWorktreeId) ?? [];
      if (currentTabs.length === 0) {
        const currentCounter = drawerTabCounters.get(activeWorktreeId) ?? 0;
        const newCounter = currentCounter + 1;
        const newTab: DrawerTab = {
          id: `${activeWorktreeId}-drawer-${newCounter}`,
          label: `Terminal ${newCounter}`,
          type: 'terminal',
        };
        setDrawerTabs((prev) => {
          const next = new Map(prev);
          next.set(activeWorktreeId, [newTab]);
          return next;
        });
        setDrawerActiveTabIds((prev) => {
          const next = new Map(prev);
          next.set(activeWorktreeId, newTab.id);
          return next;
        });
        setDrawerTabCounters((prev) => {
          const next = new Map(prev);
          next.set(activeWorktreeId, newCounter);
          return next;
        });
      }
    }

    setIsDrawerOpen(willOpen);

    // Focus the drawer when opening, main when closing
    setFocusStates((prev) => {
      const target = willOpen ? 'drawer' : 'main';
      if (prev.get(activeWorktreeId) === target) return prev;
      const next = new Map(prev);
      next.set(activeWorktreeId, target);
      return next;
    });

    dispatchPanelResizeComplete();
  }, [activeWorktreeId, isDrawerOpen, drawerTabs, drawerTabCounters, dispatchPanelResizeComplete]);

  // Toggle right panel handler
  const handleToggleRightPanel = useCallback(() => {
    if (!activeWorktreeId) return;

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
  }, [activeWorktreeId, isRightPanelOpen, dispatchPanelResizeComplete]);

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

  // Clear notification when worktree becomes active
  useEffect(() => {
    if (activeWorktreeId && notifiedWorktreeIds.has(activeWorktreeId)) {
      setNotifiedWorktreeIds((prev) => {
        const next = new Set(prev);
        next.delete(activeWorktreeId);
        return next;
      });
    }
  }, [activeWorktreeId, notifiedWorktreeIds]);

  // Worktree thinking state handler (for showing loading indicator when Claude is thinking)
  const handleWorktreeThinkingChange = useCallback((worktreeId: string, isThinking: boolean) => {
    setThinkingWorktreeIds((prev) => {
      if (isThinking) {
        if (prev.has(worktreeId)) return prev;
        return new Set([...prev, worktreeId]);
      } else {
        if (!prev.has(worktreeId)) return prev;
        const next = new Set(prev);
        next.delete(worktreeId);
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
    // Track last open size (only when not collapsed)
    if (size.inPixels >= 100) {
      lastDrawerSize.current = size.inPixels;
    }

    const isCollapsed = size.inPixels === 0;
    setIsDrawerOpen((prev) => {
      if (prev === !isCollapsed) return prev; // No change needed
      return !isCollapsed;
    });
  }, []);

  // Add new drawer tab handler
  const handleAddDrawerTab = useCallback(() => {
    if (!activeWorktreeId) return;

    const currentCounter = drawerTabCounters.get(activeWorktreeId) ?? 0;
    const newCounter = currentCounter + 1;
    const newTab: DrawerTab = {
      id: `${activeWorktreeId}-drawer-${newCounter}`,
      label: `Terminal ${newCounter}`,
      type: 'terminal',
    };

    setDrawerTabs((prev) => {
      const currentTabs = prev.get(activeWorktreeId) ?? [];
      const next = new Map(prev);
      next.set(activeWorktreeId, [...currentTabs, newTab]);
      return next;
    });
    setDrawerActiveTabIds((prev) => {
      const next = new Map(prev);
      next.set(activeWorktreeId, newTab.id);
      return next;
    });
    setDrawerTabCounters((prev) => {
      const next = new Map(prev);
      next.set(activeWorktreeId, newCounter);
      return next;
    });

    // Focus the drawer when adding a new tab
    setFocusStates((prev) => {
      if (prev.get(activeWorktreeId) === 'drawer') return prev;
      const next = new Map(prev);
      next.set(activeWorktreeId, 'drawer');
      return next;
    });
  }, [activeWorktreeId, drawerTabCounters]);

  // Select drawer tab handler
  const handleSelectDrawerTab = useCallback((tabId: string) => {
    if (!activeWorktreeId) return;
    setDrawerActiveTabIds((prev) => {
      const next = new Map(prev);
      next.set(activeWorktreeId, tabId);
      return next;
    });
    // Also set focus to drawer when clicking a tab
    setFocusStates((prev) => {
      if (prev.get(activeWorktreeId) === 'drawer') return prev;
      const next = new Map(prev);
      next.set(activeWorktreeId, 'drawer');
      return next;
    });
  }, [activeWorktreeId]);

  // Close drawer tab handler
  const handleCloseDrawerTab = useCallback((tabId: string, worktreeId?: string) => {
    const targetWorktreeId = worktreeId ?? activeWorktreeId;
    if (!targetWorktreeId) return;

    const currentTabs = drawerTabs.get(targetWorktreeId) ?? [];
    const remaining = currentTabs.filter(t => t.id !== tabId);

    // If closing the last tab for the active worktree, collapse the drawer panel and focus main
    if (remaining.length === 0 && targetWorktreeId === activeWorktreeId) {
      drawerPanelRef.current?.collapse();
      setIsDrawerOpen(false);
      // Focus back to main pane when closing last drawer tab
      setFocusStates((prev) => {
        if (prev.get(targetWorktreeId) === 'main') return prev;
        const next = new Map(prev);
        next.set(targetWorktreeId, 'main');
        return next;
      });
    }

    setDrawerTabs((prev) => {
      const next = new Map(prev);
      next.set(targetWorktreeId, remaining);
      return next;
    });

    // Update active tab if needed
    const currentActiveTabId = drawerActiveTabIds.get(targetWorktreeId);
    if (currentActiveTabId === tabId && remaining.length > 0) {
      setDrawerActiveTabIds((prev) => {
        const next = new Map(prev);
        next.set(targetWorktreeId, remaining[remaining.length - 1].id);
        return next;
      });
    } else if (remaining.length === 0) {
      setDrawerActiveTabIds((prev) => {
        const next = new Map(prev);
        next.delete(targetWorktreeId);
        return next;
      });
    }
  }, [activeWorktreeId, drawerTabs, drawerActiveTabIds]);

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
    if (!activeWorktreeId) return;

    const currentFocus = focusStates.get(activeWorktreeId) ?? 'main';
    const newFocus = currentFocus === 'main' ? 'drawer' : 'main';

    // If switching to drawer and it's not open, open it
    if (newFocus === 'drawer' && !isDrawerOpen) {
      const panel = drawerPanelRef.current;
      if (panel) {
        panel.resize(lastDrawerSize.current);
      }

      // Create first tab if none exist
      const currentTabs = drawerTabs.get(activeWorktreeId) ?? [];
      if (currentTabs.length === 0) {
        const currentCounter = drawerTabCounters.get(activeWorktreeId) ?? 0;
        const newCounter = currentCounter + 1;
        const newTab: DrawerTab = {
          id: `${activeWorktreeId}-drawer-${newCounter}`,
          label: `Terminal ${newCounter}`,
          type: 'terminal',
        };
        setDrawerTabs((prev) => {
          const next = new Map(prev);
          next.set(activeWorktreeId, [newTab]);
          return next;
        });
        setDrawerActiveTabIds((prev) => {
          const next = new Map(prev);
          next.set(activeWorktreeId, newTab.id);
          return next;
        });
        setDrawerTabCounters((prev) => {
          const next = new Map(prev);
          next.set(activeWorktreeId, newCounter);
          return next;
        });
      }

      setIsDrawerOpen(true);
      dispatchPanelResizeComplete();
    }

    setFocusStates((prev) => {
      const next = new Map(prev);
      next.set(activeWorktreeId, newFocus);
      return next;
    });
  }, [activeWorktreeId, focusStates, isDrawerOpen, drawerTabs, drawerTabCounters, dispatchPanelResizeComplete]);

  // Task handlers
  const handleSelectTask = useCallback((taskName: string) => {
    if (!activeProjectPath) return;
    setSelectedTasksByProject((prev) => {
      const next = new Map(prev);
      next.set(activeProjectPath, taskName);
      return next;
    });
  }, [activeProjectPath]);

  const handleStartTask = useCallback(async () => {
    if (!activeWorktreeId || !activeSelectedTask) return;

    // Find the task config to get the kind
    const task = config.tasks.find((t) => t.name === activeSelectedTask);
    if (!task) return;

    // Check if this task is already running
    const worktreeTasks = runningTasks.get(activeWorktreeId) ?? [];
    const existingTask = worktreeTasks.find(t => t.taskName === activeSelectedTask && t.status === 'running');
    if (existingTask) {
      // Task is already running, just switch to its tab (if not silent)
      if (!task.silent) {
        const tabId = `${activeWorktreeId}-task-${activeSelectedTask}`;
        setDrawerActiveTabIds((prev) => {
          const next = new Map(prev);
          next.set(activeWorktreeId, tabId);
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
        const ptyId = await spawnTask(activeWorktreeId, activeSelectedTask);
        // Track the silent task so we can stop it
        setRunningTasks((prev) => {
          const next = new Map(prev);
          const existing = prev.get(activeWorktreeId) ?? [];
          // Remove any stopped instance of this task, add new running one
          const filtered = existing.filter(t => t.taskName !== activeSelectedTask || t.status === 'running');
          next.set(activeWorktreeId, [...filtered, { taskName: activeSelectedTask, ptyId, status: 'running' }]);
          return next;
        });
      } catch (err) {
        console.error('Failed to start silent task:', err);
      }
      return;
    }

    // Create a new task tab with unique ID (allows restart)
    const tabId = `${activeWorktreeId}-task-${activeSelectedTask}-${Date.now()}`;
    const newTab: DrawerTab = {
      id: tabId,
      label: activeSelectedTask,
      type: 'task',
      taskName: activeSelectedTask,
    };

    // Remove any existing tab for this task, then add new one
    setDrawerTabs((prev) => {
      const currentTabs = prev.get(activeWorktreeId) ?? [];
      // Remove old task tab if exists (any tab with same taskName)
      const filteredTabs = currentTabs.filter((t) => t.taskName !== activeSelectedTask);
      const next = new Map(prev);
      next.set(activeWorktreeId, [...filteredTabs, newTab]);
      return next;
    });
    setDrawerActiveTabIds((prev) => {
      const next = new Map(prev);
      next.set(activeWorktreeId, tabId);
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
      const existing = prev.get(activeWorktreeId) ?? [];
      // Remove any stopped instance of this task, add new running one
      const filtered = existing.filter(t => t.taskName !== activeSelectedTask || t.status === 'running');
      next.set(activeWorktreeId, [...filtered, { taskName: activeSelectedTask, ptyId: '', status: 'running' }]);
      return next;
    });

    // Focus the drawer
    setFocusStates((prev) => {
      const next = new Map(prev);
      next.set(activeWorktreeId, 'drawer');
      return next;
    });
  }, [activeWorktreeId, activeSelectedTask, config.tasks, isDrawerOpen, runningTasks]);

  const handleStopTask = useCallback(() => {
    if (!activeWorktreeId || !activeSelectedTask) return;

    const worktreeTasks = runningTasks.get(activeWorktreeId) ?? [];
    const taskToStop = worktreeTasks.find(t => t.taskName === activeSelectedTask && t.status === 'running');
    if (!taskToStop) return;

    console.log('[handleStopTask] taskToStop:', taskToStop);

    // Kill the PTY if we have an ID
    if (taskToStop.ptyId) {
      console.log('[handleStopTask] Killing PTY:', taskToStop.ptyId);
      ptyKill(taskToStop.ptyId);
    } else {
      console.warn('[handleStopTask] No ptyId available!');
    }

    // Mark task as stopping (not stopped yet - waiting for process to exit)
    setRunningTasks((prev) => {
      const next = new Map(prev);
      const existing = prev.get(activeWorktreeId) ?? [];
      const updated = existing.map(t =>
        t.taskName === activeSelectedTask && t.status === 'running'
          ? { ...t, status: 'stopping' as const }
          : t
      );
      next.set(activeWorktreeId, updated);
      return next;
    });
  }, [activeWorktreeId, activeSelectedTask, runningTasks]);

  // Toggle task: run if not running, stop if running
  const handleToggleTask = useCallback(() => {
    if (!activeWorktreeId || !activeSelectedTask) return;

    const worktreeTasks = runningTasks.get(activeWorktreeId) ?? [];
    const runningTask = worktreeTasks.find(t => t.taskName === activeSelectedTask);
    if (runningTask?.status === 'running') {
      handleStopTask();
    } else {
      handleStartTask();
    }
  }, [activeWorktreeId, activeSelectedTask, runningTasks, handleStartTask, handleStopTask]);

  const handleForceKillTask = useCallback(() => {
    if (!activeWorktreeId || !activeSelectedTask) return;

    const worktreeTasks = runningTasks.get(activeWorktreeId) ?? [];
    const taskToKill = worktreeTasks.find(t => t.taskName === activeSelectedTask && t.status === 'stopping');
    if (!taskToKill) return;

    // Force kill the PTY with SIGKILL
    if (taskToKill.ptyId) {
      ptyForceKill(taskToKill.ptyId);
    }
  }, [activeWorktreeId, activeSelectedTask, runningTasks]);

  // Task switcher handlers
  const handleToggleTaskSwitcher = useCallback(() => {
    if (!activeWorktreeId || config.tasks.length === 0) return;
    setIsTaskSwitcherOpen(prev => !prev);
  }, [activeWorktreeId, config.tasks.length]);

  const handleTaskSwitcherSelect = useCallback((taskName: string) => {
    handleSelectTask(taskName);
    setIsTaskSwitcherOpen(false);
  }, [handleSelectTask]);

  const handleTaskSwitcherRun = useCallback((taskName: string) => {
    handleSelectTask(taskName);
    setTimeout(() => handleStartTask(), 0);
    setIsTaskSwitcherOpen(false);
  }, [handleSelectTask, handleStartTask]);

  const handleTaskExit = useCallback((worktreeId: string, taskName: string, _exitCode: number) => {
    setRunningTasks((prev) => {
      const existing = prev.get(worktreeId);
      if (!existing) return prev;
      const next = new Map(prev);
      const updated = existing.map(t =>
        t.taskName === taskName ? { ...t, status: 'stopped' as const } : t
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
            updated[taskIndex] = { ...updated[taskIndex], status: 'stopped' };
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
    // Mark the project as active
    const project = projects.find((p) => p.worktrees.some((w) => w.id === worktree.id));
    if (project) {
      setSessionTouchedProjects((prev) => new Set([...prev, project.id]));
      setActiveProjectId(project.id);
    }
    setOpenWorktreeIds((prev) => {
      if (prev.has(worktree.id)) return prev;
      return new Set([...prev, worktree.id]);
    });
    setActiveWorktreeId(worktree.id);
  }, [projects]);

  const handleSelectProject = useCallback((project: Project) => {
    // Mark the project as active (touched this session)
    setSessionTouchedProjects((prev) => new Set([...prev, project.id]));
    // Add to open projects if not already
    setOpenProjectIds((prev) => {
      if (prev.has(project.id)) return prev;
      return new Set([...prev, project.id]);
    });
    // Clear worktree selection, set project as active
    setActiveWorktreeId(null);
    setActiveProjectId(project.id);
  }, []);

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

  const confirmDeleteWorktree = useCallback(async () => {
    if (!pendingDeleteId) return;
    try {
      // Mark the project as session-touched so it stays visible after deletion
      const project = projects.find((p) => p.worktrees.some((w) => w.id === pendingDeleteId));
      if (project) {
        setSessionTouchedProjects((prev) => new Set([...prev, project.id]));
      }

      await deleteWorktree(pendingDeleteId);
      setOpenWorktreeIds((prev) => {
        const next = new Set(prev);
        next.delete(pendingDeleteId);
        return next;
      });
      // Clean up drawer tabs and focus state for this worktree
      setDrawerTabs((prev) => {
        const next = new Map(prev);
        next.delete(pendingDeleteId);
        return next;
      });
      setDrawerActiveTabIds((prev) => {
        const next = new Map(prev);
        next.delete(pendingDeleteId);
        return next;
      });
      setDrawerTabCounters((prev) => {
        const next = new Map(prev);
        next.delete(pendingDeleteId);
        return next;
      });
      setFocusStates((prev) => {
        const next = new Map(prev);
        next.delete(pendingDeleteId);
        return next;
      });
      if (activeWorktreeId === pendingDeleteId) {
        const remaining = Array.from(openWorktreeIds).filter(id => id !== pendingDeleteId);
        setActiveWorktreeId(remaining.length > 0 ? remaining[remaining.length - 1] : null);
        // Close drawer and right panel when no worktrees remain
        if (remaining.length === 0) {
          setIsDrawerOpen(false);
          drawerPanelRef.current?.collapse();
          setIsRightPanelOpen(false);
          rightPanelRef.current?.collapse();
        }
      }
    } catch (err) {
      console.error('Failed to delete worktree:', err);
    } finally {
      setPendingDeleteId(null);
    }
  }, [deleteWorktree, pendingDeleteId, activeWorktreeId, openWorktreeIds, projects]);

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

      // Switch focus between main and drawer (works even without active worktree selection)
      if (matchesShortcut(e, mappings.switchFocus)) {
        e.preventDefault();
        handleSwitchFocus();
        return;
      }

      if (!activeWorktreeId) return;

      if (matchesShortcut(e, mappings.toggleDrawer)) {
        e.preventDefault();
        handleToggleDrawer();
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

      if (matchesShortcut(e, mappings.toggleRightPanel)) {
        e.preventDefault();
        handleToggleRightPanel();
      }

      // Worktree navigation - cycle through active worktrees in sidebar order
      if (openWorktreesInOrder.length > 1 && activeWorktreeId) {
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
      }

      // Run/stop task toggle
      if (matchesShortcut(e, mappings.runTask)) {
        e.preventDefault();
        handleToggleTask();
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
  }, [activeWorktreeId, activeProjectId, isDrawerOpen, activeDrawerTabId, config, openWorktreesInOrder, handleToggleDrawer, handleAddDrawerTab, handleCloseDrawerTab, handleToggleRightPanel, handleToggleTask, handleSwitchFocus, handleAddWorktree, handleToggleTaskSwitcher]);

  const pendingWorktree = pendingDeleteId
    ? projects.flatMap((p) => p.worktrees).find((w) => w.id === pendingDeleteId)
    : null;

  const pendingMergeWorktree = pendingMergeId
    ? projects.flatMap((p) => p.worktrees).find((w) => w.id === pendingMergeId)
    : null;

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-zinc-950">
      {/* Shutdown screen overlay */}
      <ShutdownScreen isVisible={isShuttingDown} />

      {pendingDeleteId && pendingWorktree && (
        <ConfirmModal
          title="Delete Worktree"
          message={`Are you sure you want to delete "${pendingWorktree.name}"? This will remove the worktree and cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={confirmDeleteWorktree}
          onCancel={() => setPendingDeleteId(null)}
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
        />
      )}

      {pendingMergeWorktree && (
        <MergeModal
          worktree={pendingMergeWorktree}
          defaultConfig={config.merge}
          onClose={() => setPendingMergeId(null)}
          onMergeComplete={handleMergeComplete}
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
        />
      )}

      {isTaskSwitcherOpen && activeWorktreeId && (
        <TaskSwitcher
          tasks={config.tasks}
          selectedTask={activeSelectedTask}
          runningTasks={runningTasks.get(activeWorktreeId) ?? []}
          onSelect={handleTaskSwitcherSelect}
          onRun={handleTaskSwitcherRun}
          onClose={() => setIsTaskSwitcherOpen(false)}
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
              openProjectIds={openProjectIds}
              openWorktreeIds={openWorktreeIds}
              openWorktreesInOrder={openWorktreesInOrder}
              isModifierKeyHeld={isModifierKeyHeld}
              loadingWorktrees={loadingWorktrees}
              notifiedWorktreeIds={notifiedWorktreeIds}
              thinkingWorktreeIds={thinkingWorktreeIds}
              runningTaskCounts={runningTaskCounts}
              expandedProjects={expandedProjects}
              showActiveOnly={showActiveOnly}
              sessionTouchedProjects={sessionTouchedProjects}
              isDrawerOpen={isDrawerOpen}
              isRightPanelOpen={isRightPanelOpen}
              tasks={config.tasks}
              selectedTask={activeSelectedTask}
              runningTask={activeRunningTask ? { ...activeRunningTask, worktreeId: activeWorktreeId!, kind: config.tasks.find(t => t.name === activeRunningTask.taskName)?.kind ?? 'command' } : null}
              allRunningTasks={activeWorktreeId ? runningTasks.get(activeWorktreeId) ?? [] : []}
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
            />
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-zinc-700 hover:bg-zinc-500 transition-colors focus:outline-none !cursor-col-resize" />

        {/* Main Pane with Drawer - vertical layout (flex to fill remaining space) */}
        <Panel minSize="300px">
          {/* Both panes are always mounted to preserve terminal state, visibility toggled */}
          <div className="h-full relative">
            {/* Empty state - visible when nothing is selected */}
            {!activeWorktreeId && !activeProjectId && (
              <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950 text-zinc-500 select-none z-10">
                <FolderGit2 size={48} className="mb-4 opacity-50" />
                <p className="text-lg">No worktrees open</p>
                <p className="text-sm mt-1">Select a worktree from the sidebar to start</p>
              </div>
            )}

            {/* ProjectPane - visible when project selected without worktree */}
            {openProjectIds.size > 0 && (
              <div className={`absolute inset-0 ${
                activeProjectId && !activeWorktreeId
                  ? 'visible z-10'
                  : 'invisible z-0 pointer-events-none'
              }`}>
                <ProjectPane
                  openProjectIds={openProjectIds}
                  activeProjectId={activeProjectId}
                  isVisible={!activeWorktreeId}
                  terminalConfig={config.main}
                  mappings={config.mappings}
                  onFocus={() => {/* no-op for now */}}
                />
              </div>
            )}

            {/* MainPane with Drawer - visible when worktree selected */}
            <div className={`absolute inset-0 ${
              activeWorktreeId
                ? 'visible z-10'
                : 'invisible z-0 pointer-events-none'
            }`}>
              <PanelGroup
                orientation="vertical"
                className="h-full"
              >
                <Panel minSize="200px">
                  <MainPane
                    openWorktreeIds={openWorktreeIds}
                    activeWorktreeId={activeWorktreeId}
                    terminalConfig={config.main}
                    mappings={config.mappings}
                    shouldAutoFocus={activeFocusState === 'main'}
                    onFocus={handleMainPaneFocused}
                    onWorktreeNotification={handleWorktreeNotification}
                    onWorktreeThinkingChange={handleWorktreeThinkingChange}
                  />
                </Panel>

                {/* Drawer Panel - collapsible */}
                <PanelResizeHandle
                  className={`transition-colors focus:outline-none !cursor-row-resize ${
                isDrawerOpen
                  ? 'h-px bg-zinc-700 hover:bg-zinc-500'
                  : 'h-0 pointer-events-none'
              }`}
            />
            <Panel
              panelRef={drawerPanelRef}
              defaultSize="0px"
              minSize="100px"
              maxSize="70%"
              collapsible
              collapsedSize="0px"
              onResize={handleDrawerResize}
            >
              <div className="h-full overflow-hidden">
                <Drawer
                  isOpen={isDrawerOpen}
                  worktreeId={activeWorktreeId}
                  tabs={activeDrawerTabs}
                  activeTabId={activeDrawerTabId}
                  taskStatuses={activeTaskStatuses}
                  onSelectTab={handleSelectDrawerTab}
                  onCloseTab={handleCloseDrawerTab}
                  onAddTab={handleAddDrawerTab}
                >
                  {/* Render ALL terminals for ALL worktrees to keep them alive */}
                  {Array.from(drawerTabs.entries()).flatMap(([worktreeId, tabs]) =>
                    tabs.map((tab) => (
                      <div
                        key={tab.id}
                        className={`absolute inset-0 ${
                          worktreeId === activeWorktreeId &&
                          isDrawerOpen &&
                          tab.id === activeDrawerTabId
                            ? 'visible z-10'
                            : 'invisible z-0 pointer-events-none'
                        }`}
                      >
                        {tab.type === 'task' && tab.taskName ? (
                          <TaskTerminal
                            id={tab.id}
                            worktreeId={worktreeId}
                            taskName={tab.taskName}
                            isActive={
                              worktreeId === activeWorktreeId &&
                              isDrawerOpen &&
                              tab.id === activeDrawerTabId
                            }
                            shouldAutoFocus={
                              worktreeId === activeWorktreeId &&
                              isDrawerOpen &&
                              tab.id === activeDrawerTabId &&
                              activeFocusState === 'drawer'
                            }
                            terminalConfig={config.terminal}
                            mappings={config.mappings}
                            onPtyIdReady={(ptyId) => handleTaskPtyIdReady(worktreeId, tab.taskName!, ptyId)}
                            onTaskExit={(exitCode) => handleTaskExit(worktreeId, tab.taskName!, exitCode)}
                            onFocus={() => handleDrawerFocused(worktreeId)}
                          />
                        ) : (
                          <DrawerTerminal
                            id={tab.id}
                            worktreeId={worktreeId}
                            isActive={
                              worktreeId === activeWorktreeId &&
                              isDrawerOpen &&
                              tab.id === activeDrawerTabId
                            }
                            shouldAutoFocus={
                              worktreeId === activeWorktreeId &&
                              isDrawerOpen &&
                              tab.id === activeDrawerTabId &&
                              activeFocusState === 'drawer'
                            }
                            terminalConfig={config.terminal}
                            mappings={config.mappings}
                            onClose={() => handleCloseDrawerTab(tab.id, worktreeId)}
                            onFocus={() => handleDrawerFocused(worktreeId)}
                          />
                        )}
                      </div>
                    ))
                  )}
                </Drawer>
              </div>
            </Panel>
          </PanelGroup>
            </div>
          </div>
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

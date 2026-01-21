import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, PanelImperativeHandle } from 'react-resizable-panels';
import { listen } from '@tauri-apps/api/event';
import { Sidebar } from './components/Sidebar/Sidebar';
import { MainPane } from './components/MainPane/MainPane';
import { RightPanel } from './components/RightPanel/RightPanel';
import { Drawer, DrawerTab } from './components/Drawer/Drawer';
import { DrawerTerminal } from './components/Drawer/DrawerTerminal';
import { ConfirmModal } from './components/ConfirmModal';
import { MergeModal } from './components/MergeModal';
import { ShutdownScreen } from './components/ShutdownScreen';
import { useWorktrees } from './hooks/useWorktrees';
import { useGitStatus } from './hooks/useGitStatus';
import { useConfig } from './hooks/useConfig';
import { selectFolder, shutdown } from './lib/tauri';
import { sendOsNotification } from './lib/notifications';
import { matchesShortcut } from './lib/keyboard';
import { Project, Worktree } from './types';

const EXPANDED_PROJECTS_KEY = 'onemanband:expandedProjects';
const SHOW_ACTIVE_ONLY_KEY = 'onemanband:showActiveOnly';
const ACTIVE_PROJECTS_KEY = 'onemanband:activeProjects';

// Which pane has focus per worktree
type FocusedPane = 'main' | 'drawer';

function App() {
  const { projects, addProject, removeProject, createWorktree, deleteWorktree, refresh: refreshProjects } = useWorktrees();

  // Get project path first for config loading (derived below after activeWorktreeId is defined)
  const [activeWorktreeId, setActiveWorktreeId] = useState<string | null>(null);

  // Derive the project path from the active worktree (for config loading)
  const activeProjectPath = useMemo(() => {
    if (!activeWorktreeId) return undefined;
    for (const project of projects) {
      if (project.worktrees.some(w => w.id === activeWorktreeId)) {
        return project.path;
      }
    }
    return undefined;
  }, [activeWorktreeId, projects]);

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

  // Open worktrees in sidebar order (for keyboard navigation)
  const openWorktreesInOrder = useMemo(() => {
    return projects
      .flatMap(p => p.worktrees)
      .filter(w => openWorktreeIds.has(w.id))
      .map(w => w.id);
  }, [projects, openWorktreeIds]);

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

  const { files: changedFiles } = useGitStatus(activeWorktree);

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

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [activeWorktreeId, isDrawerOpen, activeDrawerTabId, config, openWorktreesInOrder, handleToggleDrawer, handleAddDrawerTab, handleCloseDrawerTab, handleToggleRightPanel]);

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
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;

      setExpandedProjects((prev) => new Set([...prev, projectId]));
      // Mark project as touched this session so it stays visible
      setSessionTouchedProjects((prev) => new Set([...prev, projectId]));

      try {
        const worktree = await createWorktree(project.path);
        setLoadingWorktrees((prev) => new Set([...prev, worktree.id]));
        setOpenWorktreeIds((prev) => new Set([...prev, worktree.id]));
        setActiveWorktreeId(worktree.id);
      } catch (err) {
        console.error('Failed to create worktree:', err);
      }
    },
    [projects, createWorktree]
  );

  const handleSelectWorktree = useCallback((worktree: Worktree) => {
    // Mark the project as active
    const project = projects.find((p) => p.worktrees.some((w) => w.id === worktree.id));
    if (project) {
      setSessionTouchedProjects((prev) => new Set([...prev, project.id]));
    }
    setOpenWorktreeIds((prev) => {
      if (prev.has(worktree.id)) return prev;
      return new Set([...prev, worktree.id]);
    });
    setActiveWorktreeId(worktree.id);
  }, [projects]);

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
      await removeProject(pendingRemoveProject.id);
    } catch (err) {
      console.error('Failed to remove project:', err);
    } finally {
      setPendingRemoveProject(null);
    }
  }, [removeProject, pendingRemoveProject, activeWorktreeId]);


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
              activeWorktreeId={activeWorktreeId}
              openWorktreeIds={openWorktreeIds}
              openWorktreesInOrder={openWorktreesInOrder}
              isModifierKeyHeld={isModifierKeyHeld}
              loadingWorktrees={loadingWorktrees}
              notifiedWorktreeIds={notifiedWorktreeIds}
              thinkingWorktreeIds={thinkingWorktreeIds}
              expandedProjects={expandedProjects}
              showActiveOnly={showActiveOnly}
              sessionTouchedProjects={sessionTouchedProjects}
              isDrawerOpen={isDrawerOpen}
              isRightPanelOpen={isRightPanelOpen}
              onToggleProject={toggleProject}
              onSelectWorktree={handleSelectWorktree}
              onAddProject={handleAddProject}
              onAddWorktree={handleAddWorktree}
              onDeleteWorktree={handleDeleteWorktree}
              onCloseWorktree={handleCloseWorktree}
              onMergeWorktree={handleMergeWorktree}
              onToggleDrawer={handleToggleDrawer}
              onToggleRightPanel={handleToggleRightPanel}
              onRemoveProject={handleRemoveProject}
              onMarkProjectInactive={handleMarkProjectInactive}
              onToggleShowActiveOnly={() => setShowActiveOnly(prev => !prev)}
            />
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-zinc-700 hover:bg-zinc-500 transition-colors focus:outline-none !cursor-col-resize" />

        {/* Main Pane with Drawer - vertical layout (flex to fill remaining space) */}
        <Panel minSize="300px">
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
            activeWorktreeId && isRightPanelOpen
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

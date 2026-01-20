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
import { useWorktrees } from './hooks/useWorktrees';
import { useGitStatus } from './hooks/useGitStatus';
import { useConfig } from './hooks/useConfig';
import { selectFolder } from './lib/tauri';
import { Project, Worktree } from './types';

const EXPANDED_PROJECTS_KEY = 'onemanband:expandedProjects';

// Per-worktree drawer state
interface DrawerState {
  isOpen: boolean;
  tabs: DrawerTab[];
  activeTabId: string | null;
  tabCounter: number;
}

function createDefaultDrawerState(): DrawerState {
  return {
    isOpen: false,
    tabs: [],
    activeTabId: null,
    tabCounter: 0,
  };
}

// Per-worktree right panel state
interface RightPanelState {
  isOpen: boolean;
}

function createDefaultRightPanelState(): RightPanelState {
  return {
    isOpen: false,
  };
}

// Which pane has focus per worktree
type FocusedPane = 'main' | 'drawer';

function App() {
  const { projects, addProject, removeProject, createWorktree, deleteWorktree, refresh: refreshProjects } = useWorktrees();
  const { config } = useConfig();

  // Open worktrees (main terminals are kept alive for these)
  const [openWorktreeIds, setOpenWorktreeIds] = useState<Set<string>>(new Set());
  const [activeWorktreeId, setActiveWorktreeId] = useState<string | null>(null);

  // Per-worktree drawer state
  const [drawerStates, setDrawerStates] = useState<Map<string, DrawerState>>(new Map());

  // Per-worktree right panel state
  const [rightPanelStates, setRightPanelStates] = useState<Map<string, RightPanelState>>(new Map());

  // Per-worktree focus state (which pane has focus)
  const [focusStates, setFocusStates] = useState<Map<string, FocusedPane>>(new Map());

  // Get current worktree's drawer state
  const activeDrawerState = activeWorktreeId ? drawerStates.get(activeWorktreeId) ?? createDefaultDrawerState() : null;

  // Get current worktree's right panel state
  const activeRightPanelState = activeWorktreeId ? rightPanelStates.get(activeWorktreeId) ?? createDefaultRightPanelState() : null;

  // Get current worktree's focus state (defaults to 'main')
  const activeFocusState = activeWorktreeId ? focusStates.get(activeWorktreeId) ?? 'main' : 'main';

  // Modal state
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingRemoveProject, setPendingRemoveProject] = useState<Project | null>(null);
  const [pendingMergeId, setPendingMergeId] = useState<string | null>(null);
  const [loadingWorktrees, setLoadingWorktrees] = useState<Set<string>>(new Set());

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

  const { files: changedFiles } = useGitStatus(activeWorktree);

  // Sync right panel collapse state when worktree changes
  useEffect(() => {
    const panel = rightPanelRef.current;
    if (!panel) return;

    const shouldBeOpen = activeWorktreeId && activeRightPanelState?.isOpen;
    const isCollapsed = panel.isCollapsed();

    if (shouldBeOpen && isCollapsed) {
      panel.resize(lastRightPanelSize.current);
    } else if (!shouldBeOpen && !isCollapsed) {
      panel.collapse();
    }
  }, [activeWorktreeId, activeRightPanelState?.isOpen]);

  // Sync drawer collapse state when worktree changes
  useEffect(() => {
    const panel = drawerPanelRef.current;
    if (!panel) return;

    const shouldBeOpen = activeWorktreeId && activeDrawerState?.isOpen;
    const isCollapsed = panel.isCollapsed();

    if (shouldBeOpen && isCollapsed) {
      panel.resize(lastDrawerSize.current);
    } else if (!shouldBeOpen && !isCollapsed) {
      panel.collapse();
    }
  }, [activeWorktreeId, activeDrawerState?.isOpen]);

  // Toggle drawer handler (used by both keyboard shortcut and button)
  const handleToggleDrawer = useCallback(() => {
    if (!activeWorktreeId) return;

    const panel = drawerPanelRef.current;
    const currentState = drawerStates.get(activeWorktreeId) ?? createDefaultDrawerState();
    const willOpen = !currentState.isOpen;

    if (panel) {
      if (willOpen) {
        panel.resize(lastDrawerSize.current);
      } else {
        panel.collapse();
      }
    }

    setDrawerStates((prev) => {
      const current = prev.get(activeWorktreeId) ?? createDefaultDrawerState();
      const next = new Map(prev);

      // Create first tab if opening drawer with no tabs
      if (willOpen && current.tabs.length === 0) {
        const newCounter = current.tabCounter + 1;
        const newTab: DrawerTab = {
          id: `${activeWorktreeId}-drawer-${newCounter}`,
          label: `Terminal ${newCounter}`,
        };
        next.set(activeWorktreeId, {
          isOpen: true,
          tabs: [newTab],
          activeTabId: newTab.id,
          tabCounter: newCounter,
        });
      } else {
        next.set(activeWorktreeId, { ...current, isOpen: willOpen });
      }
      return next;
    });
  }, [activeWorktreeId, drawerStates]);

  // Toggle right panel handler
  const handleToggleRightPanel = useCallback(() => {
    if (!activeWorktreeId) return;

    const panel = rightPanelRef.current;
    if (panel) {
      if (panel.isCollapsed()) {
        // Restore to last known size
        panel.resize(lastRightPanelSize.current);
      } else {
        panel.collapse();
      }
    }

    setRightPanelStates((prev) => {
      const current = prev.get(activeWorktreeId) ?? createDefaultRightPanelState();
      const next = new Map(prev);
      next.set(activeWorktreeId, { isOpen: !current.isOpen });
      return next;
    });
  }, [activeWorktreeId]);

  // Sync state when right panel is collapsed/expanded via dragging
  const handleRightPanelResize = useCallback((size: { inPixels: number }) => {
    if (!activeWorktreeId) return;

    // Track last open size (only when not collapsed)
    if (size.inPixels >= 150) {
      lastRightPanelSize.current = size.inPixels;
    }

    const isCollapsed = size.inPixels === 0;
    setRightPanelStates((prev) => {
      const current = prev.get(activeWorktreeId) ?? createDefaultRightPanelState();
      if (current.isOpen === !isCollapsed) return prev; // No change needed
      const next = new Map(prev);
      next.set(activeWorktreeId, { isOpen: !isCollapsed });
      return next;
    });
  }, [activeWorktreeId]);

  // Sync state when drawer is collapsed/expanded via dragging
  const handleDrawerResize = useCallback((size: { inPixels: number }) => {
    if (!activeWorktreeId) return;

    // Track last open size (only when not collapsed)
    if (size.inPixels >= 100) {
      lastDrawerSize.current = size.inPixels;
    }

    const isCollapsed = size.inPixels === 0;
    setDrawerStates((prev) => {
      const current = prev.get(activeWorktreeId) ?? createDefaultDrawerState();
      // Don't mark as open if there are no tabs (nothing to show)
      const shouldBeOpen = !isCollapsed && current.tabs.length > 0;
      if (current.isOpen === shouldBeOpen) return prev; // No change needed
      const next = new Map(prev);
      next.set(activeWorktreeId, { ...current, isOpen: shouldBeOpen });
      return next;
    });
  }, [activeWorktreeId]);

  // Add new drawer tab handler
  const handleAddDrawerTab = useCallback(() => {
    if (!activeWorktreeId) return;
    setDrawerStates((prev) => {
      const current = prev.get(activeWorktreeId) ?? createDefaultDrawerState();
      const newCounter = current.tabCounter + 1;
      const newTab: DrawerTab = {
        id: `${activeWorktreeId}-drawer-${newCounter}`,
        label: `Terminal ${newCounter}`,
      };
      const next = new Map(prev);
      next.set(activeWorktreeId, {
        ...current,
        tabs: [...current.tabs, newTab],
        activeTabId: newTab.id,
        tabCounter: newCounter,
      });
      return next;
    });
    // Focus the drawer when adding a new tab
    setFocusStates((prev) => {
      if (prev.get(activeWorktreeId) === 'drawer') return prev;
      const next = new Map(prev);
      next.set(activeWorktreeId, 'drawer');
      return next;
    });
  }, [activeWorktreeId]);

  // Select drawer tab handler
  const handleSelectDrawerTab = useCallback((tabId: string) => {
    if (!activeWorktreeId) return;
    setDrawerStates((prev) => {
      const current = prev.get(activeWorktreeId);
      if (!current) return prev;
      const next = new Map(prev);
      next.set(activeWorktreeId, { ...current, activeTabId: tabId });
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

    const current = drawerStates.get(targetWorktreeId);
    if (!current) return;

    const remaining = current.tabs.filter(t => t.id !== tabId);

    // If closing the last tab for the active worktree, collapse the drawer panel and focus main
    if (remaining.length === 0 && targetWorktreeId === activeWorktreeId) {
      drawerPanelRef.current?.collapse();
      // Focus back to main pane when closing last drawer tab
      setFocusStates((prev) => {
        if (prev.get(targetWorktreeId) === 'main') return prev;
        const next = new Map(prev);
        next.set(targetWorktreeId, 'main');
        return next;
      });
    }

    setDrawerStates((prev) => {
      const current = prev.get(targetWorktreeId);
      if (!current) return prev;

      const remaining = current.tabs.filter(t => t.id !== tabId);
      const next = new Map(prev);

      if (remaining.length === 0) {
        next.set(targetWorktreeId, { ...current, isOpen: false, tabs: [], activeTabId: null });
      } else {
        const newActiveTabId = current.activeTabId === tabId
          ? remaining[remaining.length - 1].id
          : current.activeTabId;
        next.set(targetWorktreeId, { ...current, tabs: remaining, activeTabId: newActiveTabId });
      }
      return next;
    });
  }, [activeWorktreeId, drawerStates]);

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
    const handleKeyDown = (e: KeyboardEvent) => {
      if (!activeWorktreeId) return;

      // Ctrl+` to toggle drawer
      if (e.ctrlKey && e.key === '`') {
        e.preventDefault();
        handleToggleDrawer();
      }

      // Cmd+T to add new terminal tab (when drawer is open)
      if ((e.metaKey || e.ctrlKey) && e.key === 't' && activeDrawerState?.isOpen) {
        e.preventDefault();
        handleAddDrawerTab();
      }

      // Cmd+W to close active terminal tab (when drawer is open)
      // Always preventDefault to avoid closing the window
      if ((e.metaKey || e.ctrlKey) && e.key === 'w' && activeDrawerState?.isOpen) {
        e.preventDefault();
        if (activeDrawerState.activeTabId) {
          handleCloseDrawerTab(activeDrawerState.activeTabId);
        }
      }

      // Cmd+R to toggle right panel
      if ((e.metaKey || e.ctrlKey) && e.key === 'r') {
        e.preventDefault();
        handleToggleRightPanel();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [activeWorktreeId, activeDrawerState?.isOpen, activeDrawerState?.activeTabId, handleToggleDrawer, handleAddDrawerTab, handleCloseDrawerTab, handleToggleRightPanel]);

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
    setOpenWorktreeIds((prev) => {
      if (prev.has(worktree.id)) return prev;
      return new Set([...prev, worktree.id]);
    });
    setActiveWorktreeId(worktree.id);
  }, []);

  const handleCloseWorktree = useCallback(
    (worktreeId: string) => {
      setOpenWorktreeIds((prev) => {
        const next = new Set(prev);
        next.delete(worktreeId);
        return next;
      });
      // Clean up drawer, right panel, and focus state for this worktree
      setDrawerStates((prev) => {
        const next = new Map(prev);
        next.delete(worktreeId);
        return next;
      });
      setRightPanelStates((prev) => {
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
      await deleteWorktree(pendingDeleteId);
      setOpenWorktreeIds((prev) => {
        const next = new Set(prev);
        next.delete(pendingDeleteId);
        return next;
      });
      // Clean up drawer, right panel, and focus state for this worktree
      setDrawerStates((prev) => {
        const next = new Map(prev);
        next.delete(pendingDeleteId);
        return next;
      });
      setRightPanelStates((prev) => {
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
  }, [deleteWorktree, pendingDeleteId, activeWorktreeId, openWorktreeIds]);

  const handleRemoveProject = useCallback((project: Project) => {
    setPendingRemoveProject(project);
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
      // Clean up drawer, right panel, and focus states for project worktrees
      setDrawerStates((prev) => {
        const next = new Map(prev);
        for (const id of projectWorktreeIds) {
          next.delete(id);
        }
        return next;
      });
      setRightPanelStates((prev) => {
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
        onLayoutChange={() => { window.dispatchEvent(new Event('resize')); }}
      >
        {/* Sidebar */}
        <Panel defaultSize="200px" minSize="150px" maxSize="350px">
          <div className="h-full w-full">
            <Sidebar
              projects={projects}
              activeWorktreeId={activeWorktreeId}
              openWorktreeIds={openWorktreeIds}
              loadingWorktrees={loadingWorktrees}
              expandedProjects={expandedProjects}
              isDrawerOpen={activeDrawerState?.isOpen ?? false}
              isRightPanelOpen={activeRightPanelState?.isOpen ?? false}
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
            />
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-zinc-700 hover:bg-zinc-500 transition-colors focus:outline-none !cursor-col-resize" />

        {/* Main Pane with Drawer - vertical layout (flex to fill remaining space) */}
        <Panel minSize="300px">
          <PanelGroup
            orientation="vertical"
            className="h-full"
            onLayoutChange={() => { window.dispatchEvent(new Event('resize')); }}
          >
            <Panel minSize="200px">
              <MainPane
                openWorktreeIds={openWorktreeIds}
                activeWorktreeId={activeWorktreeId}
                terminalConfig={config.main}
                shouldAutoFocus={activeFocusState === 'main'}
                onFocus={handleMainPaneFocused}
              />
            </Panel>

            {/* Drawer Panel - collapsible */}
            <PanelResizeHandle
              className={`transition-colors focus:outline-none !cursor-row-resize ${
                activeDrawerState?.isOpen
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
                  isOpen={activeDrawerState?.isOpen ?? false}
                  worktreeId={activeWorktreeId}
                  tabs={activeDrawerState?.tabs ?? []}
                  activeTabId={activeDrawerState?.activeTabId ?? null}
                  onSelectTab={handleSelectDrawerTab}
                  onCloseTab={handleCloseDrawerTab}
                  onAddTab={handleAddDrawerTab}
                >
                  {/* Render ALL terminals for ALL worktrees to keep them alive */}
                  {Array.from(drawerStates.entries()).flatMap(([worktreeId, state]) =>
                    state.tabs.map((tab) => (
                      <div
                        key={tab.id}
                        className={`absolute inset-0 ${
                          worktreeId === activeWorktreeId &&
                          activeDrawerState?.isOpen &&
                          tab.id === activeDrawerState?.activeTabId
                            ? 'visible z-10'
                            : 'invisible z-0 pointer-events-none'
                        }`}
                      >
                        <DrawerTerminal
                          id={tab.id}
                          worktreeId={worktreeId}
                          isActive={
                            worktreeId === activeWorktreeId &&
                            (activeDrawerState?.isOpen ?? false) &&
                            tab.id === activeDrawerState?.activeTabId
                          }
                          shouldAutoFocus={
                            worktreeId === activeWorktreeId &&
                            (activeDrawerState?.isOpen ?? false) &&
                            tab.id === activeDrawerState?.activeTabId &&
                            activeFocusState === 'drawer'
                          }
                          terminalConfig={config.terminal}
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
            activeWorktreeId && activeRightPanelState?.isOpen
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

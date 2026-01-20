import { useState, useCallback, useEffect, useRef } from 'react';
import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { listen } from '@tauri-apps/api/event';
import { Sidebar } from './components/Sidebar/Sidebar';
import { MainPane } from './components/MainPane/MainPane';
import { RightPanel } from './components/RightPanel/RightPanel';
import { ConfirmModal } from './components/ConfirmModal';
import { useWorkspaces } from './hooks/useWorkspaces';
import { useGitStatus } from './hooks/useGitStatus';
import { useConfig } from './hooks/useConfig';
import { selectFolder } from './lib/tauri';
import { Project, Workspace } from './types';

const EXPANDED_PROJECTS_KEY = 'onemanband:expandedProjects';

function App() {
  const { projects, addProject, removeProject, createWorkspace, deleteWorkspace } = useWorkspaces();
  const { config } = useConfig();
  const [openWorkspaces, setOpenWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [pendingRemoveProject, setPendingRemoveProject] = useState<Project | null>(null);
  const [loadingWorkspaces, setLoadingWorkspaces] = useState<Set<string>>(new Set());

  // Expanded projects - persisted to localStorage
  // We use a separate key to track if we've ever saved, so we can distinguish
  // "user collapsed all" from "first run"
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

  // Listen for workspace ready events (when Claude has started)
  useEffect(() => {
    const unlistenReady = listen<{ ptyId: string; workspaceId: string }>(
      'pty-ready',
      (event) => {
        setLoadingWorkspaces((prev) => {
          const next = new Set(prev);
          next.delete(event.payload.workspaceId);
          return next;
        });
        console.log(`Workspace ready: ${event.payload.workspaceId}`);
      }
    );

    return () => {
      unlistenReady.then((fn) => fn());
    };
  }, []);

  const activeWorkspace = openWorkspaces.find((w) => w.id === activeWorkspaceId) || null;
  const { files: changedFiles } = useGitStatus(activeWorkspace);

  const handleAddProject = useCallback(async () => {
    const path = await selectFolder();
    if (path) {
      try {
        const project = await addProject(path);
        // Expand the newly added project
        setExpandedProjects((prev) => new Set([...prev, project.id]));
      } catch (err) {
        console.error('Failed to add project:', err);
      }
    }
  }, [addProject]);

  const handleAddWorkspace = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;

      // Expand the project when adding a workspace
      setExpandedProjects((prev) => new Set([...prev, projectId]));

      try {
        const workspace = await createWorkspace(project.path);
        // Mark as loading until Claude is ready
        setLoadingWorkspaces((prev) => new Set([...prev, workspace.id]));
        setOpenWorkspaces((prev) => [...prev, workspace]);
        setActiveWorkspaceId(workspace.id);
      } catch (err) {
        console.error('Failed to create workspace:', err);
      }
    },
    [projects, createWorkspace]
  );

  const handleSelectWorkspace = useCallback((workspace: Workspace) => {
    setOpenWorkspaces((prev) => {
      if (prev.some((w) => w.id === workspace.id)) {
        return prev;
      }
      return [...prev, workspace];
    });
    setActiveWorkspaceId(workspace.id);
  }, []);

  const handleSelectTab = useCallback((workspaceId: string) => {
    setActiveWorkspaceId(workspaceId);
  }, []);

  const handleCloseTab = useCallback(
    (workspaceId: string) => {
      setOpenWorkspaces((prev) => prev.filter((w) => w.id !== workspaceId));
      if (activeWorkspaceId === workspaceId) {
        const remaining = openWorkspaces.filter((w) => w.id !== workspaceId);
        setActiveWorkspaceId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
      }
    },
    [activeWorkspaceId, openWorkspaces]
  );

  const handleDeleteWorkspace = useCallback((workspaceId: string) => {
    setPendingDeleteId(workspaceId);
  }, []);

  const confirmDeleteWorkspace = useCallback(async () => {
    if (!pendingDeleteId) return;
    try {
      await deleteWorkspace(pendingDeleteId);
      setOpenWorkspaces((prev) => prev.filter((w) => w.id !== pendingDeleteId));
      if (activeWorkspaceId === pendingDeleteId) {
        const remaining = openWorkspaces.filter((w) => w.id !== pendingDeleteId);
        setActiveWorkspaceId(remaining.length > 0 ? remaining[remaining.length - 1].id : null);
      }
    } catch (err) {
      console.error('Failed to delete workspace:', err);
    } finally {
      setPendingDeleteId(null);
    }
  }, [deleteWorkspace, pendingDeleteId, activeWorkspaceId, openWorkspaces]);

  const handleRemoveProject = useCallback((project: Project) => {
    setPendingRemoveProject(project);
  }, []);

  const confirmRemoveProject = useCallback(async () => {
    if (!pendingRemoveProject) return;
    try {
      // Close any open workspaces from this project
      const projectWorkspaceIds = new Set(pendingRemoveProject.workspaces.map((w) => w.id));
      setOpenWorkspaces((prev) => prev.filter((w) => !projectWorkspaceIds.has(w.id)));
      if (activeWorkspaceId && projectWorkspaceIds.has(activeWorkspaceId)) {
        setActiveWorkspaceId(null);
      }
      await removeProject(pendingRemoveProject.id);
    } catch (err) {
      console.error('Failed to remove project:', err);
    } finally {
      setPendingRemoveProject(null);
    }
  }, [removeProject, pendingRemoveProject, activeWorkspaceId]);

  const pendingWorkspace = pendingDeleteId
    ? openWorkspaces.find((w) => w.id === pendingDeleteId) ||
      projects.flatMap((p) => p.workspaces).find((w) => w.id === pendingDeleteId)
    : null;

  return (
    <div className="h-screen w-screen overflow-hidden flex flex-col bg-zinc-950">
      {pendingDeleteId && pendingWorkspace && (
        <ConfirmModal
          title="Delete Workspace"
          message={`Are you sure you want to delete "${pendingWorkspace.name}"? This will remove the worktree and cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={confirmDeleteWorkspace}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}

      {pendingRemoveProject && (
        <ConfirmModal
          title="Remove Project"
          message={
            pendingRemoveProject.workspaces.length > 0
              ? `Are you sure you want to remove "${pendingRemoveProject.name}"? This will also delete ${pendingRemoveProject.workspaces.length} workspace${pendingRemoveProject.workspaces.length === 1 ? '' : 's'} and cannot be undone.`
              : `Are you sure you want to remove "${pendingRemoveProject.name}"?`
          }
          confirmLabel="Remove"
          onConfirm={confirmRemoveProject}
          onCancel={() => setPendingRemoveProject(null)}
        />
      )}

      {/* Main content */}
      <PanelGroup
        orientation="horizontal"
        className="flex-1"
        onLayoutChange={() => { window.dispatchEvent(new Event('resize')); }}
      >
        {/* Sidebar */}
        <Panel defaultSize="15%" minSize="10%" maxSize="30%">
          <div className="h-full w-full">
            <Sidebar
              projects={projects}
              selectedWorkspaceId={activeWorkspaceId}
              openWorkspaceIds={new Set(openWorkspaces.map((w) => w.id))}
              loadingWorkspaces={loadingWorkspaces}
              expandedProjects={expandedProjects}
              onToggleProject={toggleProject}
              onSelectWorkspace={handleSelectWorkspace}
              onAddProject={handleAddProject}
              onAddWorkspace={handleAddWorkspace}
              onDeleteWorkspace={(workspace) => handleDeleteWorkspace(workspace.id)}
              onRemoveProject={handleRemoveProject}
            />
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-zinc-800 hover:bg-zinc-600 transition-colors focus:outline-none cursor-col-resize" />

        {/* Main Pane */}
        <Panel defaultSize="65%" minSize="30%">
          <div className="h-full w-full">
            <MainPane
              openWorkspaces={openWorkspaces}
              activeWorkspaceId={activeWorkspaceId}
              terminalConfig={config.main}
              onSelectTab={handleSelectTab}
              onCloseTab={handleCloseTab}
              onDeleteWorkspace={handleDeleteWorkspace}
            />
          </div>
        </Panel>

        <PanelResizeHandle className="w-px bg-zinc-800 hover:bg-zinc-600 transition-colors focus:outline-none cursor-col-resize" />

        {/* Right Panel */}
        <Panel defaultSize="20%" minSize="15%" maxSize="40%">
          <div className="h-full w-full">
            <RightPanel workspace={activeWorkspace} changedFiles={changedFiles} terminalConfig={config.terminal} />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

export default App;

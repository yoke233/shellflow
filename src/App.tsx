import { useState, useCallback } from 'react';
import { Sidebar } from './components/Sidebar/Sidebar';
import { ClaudePane } from './components/ClaudePane/ClaudePane';
import { RightPanel } from './components/RightPanel/RightPanel';
import { ConfirmModal } from './components/ConfirmModal';
import { useWorkspaces } from './hooks/useWorkspaces';
import { useGitStatus } from './hooks/useGitStatus';
import { selectFolder } from './lib/tauri';
import { Workspace } from './types';

function App() {
  const { projects, addProject, createWorkspace, deleteWorkspace } = useWorkspaces();
  const [openWorkspaces, setOpenWorkspaces] = useState<Workspace[]>([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<string | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);

  const activeWorkspace = openWorkspaces.find((w) => w.id === activeWorkspaceId) || null;
  const { files: changedFiles } = useGitStatus(activeWorkspace?.path || null);

  const handleAddProject = useCallback(async () => {
    const path = await selectFolder();
    if (path) {
      try {
        await addProject(path);
      } catch (err) {
        console.error('Failed to add project:', err);
      }
    }
  }, [addProject]);

  const handleAddWorkspace = useCallback(
    async (projectId: string) => {
      const project = projects.find((p) => p.id === projectId);
      if (!project) return;

      try {
        const workspace = await createWorkspace(project.path);
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

  const pendingWorkspace = pendingDeleteId
    ? openWorkspaces.find((w) => w.id === pendingDeleteId) ||
      projects.flatMap((p) => p.workspaces).find((w) => w.id === pendingDeleteId)
    : null;

  return (
    <div className="h-screen w-screen overflow-hidden flex">
      {pendingDeleteId && pendingWorkspace && (
        <ConfirmModal
          title="Delete Workspace"
          message={`Are you sure you want to delete "${pendingWorkspace.name}"? This will remove the worktree and cannot be undone.`}
          confirmLabel="Delete"
          onConfirm={confirmDeleteWorkspace}
          onCancel={() => setPendingDeleteId(null)}
        />
      )}
      {/* Sidebar */}
      <div className="w-64 flex-shrink-0 h-full">
        <Sidebar
          projects={projects}
          selectedWorkspaceId={activeWorkspaceId}
          onSelectWorkspace={handleSelectWorkspace}
          onAddProject={handleAddProject}
          onAddWorkspace={handleAddWorkspace}
        />
      </div>

      {/* Main Claude Pane */}
      <div className="flex-1 h-full min-w-0">
        <ClaudePane
          openWorkspaces={openWorkspaces}
          activeWorkspaceId={activeWorkspaceId}
          onSelectTab={handleSelectTab}
          onCloseTab={handleCloseTab}
          onDeleteWorkspace={handleDeleteWorkspace}
        />
      </div>

      {/* Right Panel */}
      <div className="w-80 flex-shrink-0 h-full">
        <RightPanel workspace={activeWorkspace} changedFiles={changedFiles} />
      </div>
    </div>
  );
}

export default App;

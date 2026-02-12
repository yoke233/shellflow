import { FolderGit2, Plus, ChevronRight, ChevronDown, MoreHorizontal, Trash2, Loader2, Terminal, GitMerge, GitBranch, X, PanelRight, Settings, Circle, Folder, ExternalLink, Hash, SquareTerminal, Code, Keyboard, Palette, GitCommit, RefreshCw } from 'lucide-react';
import { Project, Worktree, RunningTask, ScratchTerminal, BranchInfo, ChangedFilesViewMode } from '../../types';
import { StatusIndicators } from '../StatusIndicators';
import { TaskConfig, AppsConfig, getAppCommand, getAppTarget } from '../../hooks/useConfig';
import { useState, useEffect } from 'react';
import { getTaskUrls, NamedUrl } from '../../lib/tauri';
import { openUrl } from '@tauri-apps/plugin-opener';
import { DragRegion } from '../DragRegion';
import { ContextMenu } from '../ContextMenu';
import { TaskSelector } from './TaskSelector';
import { EditableWorktreeName } from './EditableWorktreeName';
import { invoke } from '@tauri-apps/api/core';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
  CollisionDetection,
} from '@dnd-kit/core';
import {
  SortableContext,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { SortableProject } from './SortableProject';
import { SortableWorktree } from './SortableWorktree';
import { SortableScratch } from './SortableScratch';
import { substitutePathTemplate } from '../../lib/pathTemplate';

interface SidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  activeWorktreeId: string | null;
  activeScratchId: string | null;
  activeWorktree: Worktree | null;
  scratchTerminals: ScratchTerminal[];
  openProjectIds: Set<string>;
  openWorktreeIds: Set<string>;
  openEntitiesInOrder: Array<{ type: 'scratch' | 'worktree' | 'project'; id: string }>;
  isModifierKeyHeld: boolean;
  loadingWorktrees: Set<string>;
  notifiedWorktreeIds: Set<string>;
  thinkingWorktreeIds: Set<string>;
  idleWorktreeIds: Set<string>;
  notifiedProjectIds: Set<string>;
  thinkingProjectIds: Set<string>;
  idleProjectIds: Set<string>;
  notifiedScratchIds: Set<string>;
  thinkingScratchIds: Set<string>;
  idleScratchIds: Set<string>;
  runningTaskCounts: Map<string, number>;
  expandedProjects: Set<string>;
  isDrawerOpen: boolean;
  isRightPanelOpen: boolean;
  tasks: TaskConfig[];
  selectedTask: string | null;
  runningTask: RunningTask | null;
  allRunningTasks: Array<{ taskName: string; status: string }>;
  terminalFontFamily: string;
  appsConfig: AppsConfig;
  showIdleCheck: boolean;
  activeScratchCwd: string | null;
  homeDir: string | null;
  branchInfo: BranchInfo | null;
  changedFilesCount: number;
  changedFilesMode: ChangedFilesViewMode;
  /** Worktree ID that should auto-enter edit mode for its name */
  autoEditWorktreeId: string | null;
  /** Scratch ID that should enter edit mode for its name (triggered by F2) */
  editingScratchId: string | null;
  /** Ref to element that should receive focus when editing ends */
  focusToRestoreRef: React.RefObject<HTMLElement | null>;
  /** Called to focus the main terminal area */
  onFocusMain: () => void;
  /** Called to open a command in the drawer (for TUI editors) */
  onOpenInDrawer: (directory: string, command: string) => void;
  /** Called to open a command in a new session tab (for TUI editors) */
  onOpenInTab: (directory: string, command: string) => void;
  onToggleProject: (projectId: string) => void;
  onSelectProject: (project: Project) => void;
  onSelectWorktree: (worktree: Worktree) => void;
  onRefreshProjects: () => void;
  isProjectsRefreshing: boolean;
  onAddProject: () => void;
  onAddWorktree: (projectId: string) => void;
  onDeleteWorktree: (worktreeId: string) => void;
  onCloseWorktree: (worktreeId: string) => void;
  onCloseProject: (projectOrId: Project | string) => void;
  onHideProject: (projectOrId: Project | string) => void;
  onMergeWorktree: (worktreeId: string) => void;
  onToggleDrawer: () => void;
  onToggleRightPanel: () => void;
  onOpenCommitModal: () => void;
  toggleDrawerShortcut?: string | null;
  toggleRightPanelShortcut?: string | null;
  refreshProjectsShortcut?: string | null;
  onSelectTask: (taskName: string) => void;
  onStartTask: () => void;
  onStopTask: () => void;
  onForceKillTask: () => void;
  onRenameWorktree: (worktreeId: string, newName: string) => Promise<void>;
  onReorderProjects: (projectIds: string[]) => void;
  onReorderWorktrees: (projectId: string, worktreeIds: string[]) => void;
  onAddScratchTerminal: () => void;
  onSelectScratch: (scratchId: string) => void;
  onCloseScratch: (scratchId: string) => void;
  onRenameScratch: (scratchId: string, newName: string) => void;
  onReorderScratchTerminals: (scratchIds: string[]) => void;
  onAutoEditConsumed: () => void;
  onEditingScratchConsumed: () => void;
  onOpenAppearanceSettings: () => void;
}

export function Sidebar({
  projects,
  activeProjectId,
  activeWorktreeId,
  activeScratchId,
  activeWorktree,
  scratchTerminals,
  openProjectIds,
  openWorktreeIds,
  openEntitiesInOrder,
  isModifierKeyHeld,
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
  isRightPanelOpen,
  tasks,
  selectedTask,
  runningTask,
  allRunningTasks,
  terminalFontFamily,
  appsConfig,
  showIdleCheck,
  activeScratchCwd,
  homeDir,
  branchInfo,
  changedFilesCount,
  changedFilesMode,
  autoEditWorktreeId,
  editingScratchId,
  focusToRestoreRef,
  onFocusMain,
  onToggleProject,
  onSelectProject,
  onSelectWorktree,
  onRefreshProjects,
  isProjectsRefreshing,
  onAddProject,
  onAddWorktree,
  onDeleteWorktree,
  onCloseWorktree,
  onCloseProject,
  onHideProject,
  onMergeWorktree,
  onToggleDrawer,
  onToggleRightPanel,
  onOpenCommitModal,
  toggleDrawerShortcut,
  toggleRightPanelShortcut,
  refreshProjectsShortcut,
  onSelectTask,
  onStartTask,
  onStopTask,
  onForceKillTask,
  onRenameWorktree,
  onReorderProjects,
  onReorderWorktrees,
  onAddScratchTerminal,
  onSelectScratch,
  onCloseScratch,
  onRenameScratch,
  onReorderScratchTerminals,
  onAutoEditConsumed,
  onEditingScratchConsumed,
  onOpenInDrawer,
  onOpenInTab,
  onOpenAppearanceSettings,
}: SidebarProps) {
  const toggleDrawerTitle = toggleDrawerShortcut ? `Toggle terminal (${toggleDrawerShortcut})` : 'Toggle terminal';
  const toggleRightPanelTitle = toggleRightPanelShortcut
    ? `Toggle right panel (${toggleRightPanelShortcut})`
    : 'Toggle right panel';
  const refreshProjectsTitle = refreshProjectsShortcut
    ? `Refresh projects and worktrees (${refreshProjectsShortcut})`
    : 'Refresh projects and worktrees';

  const [contextMenu, setContextMenu] = useState<
    | {
        type: 'project';
        project: Project;
        x: number;
        y: number;
      }
    | {
        type: 'worktree';
        worktree: Worktree;
        x: number;
        y: number;
      }
    | null
  >(null);

  const [optionsMenu, setOptionsMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [folderMenu, setFolderMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);

  const [taskUrls, setTaskUrls] = useState<NamedUrl[]>([]);

  // Compute active path for folder display (worktree, project, or scratch)
  // Priority: worktree > scratch > project (based on what's actually selected)
  const activeProject = activeProjectId ? projects.find(p => p.id === activeProjectId) : null;
  const activePath = activeWorktreeId
    ? activeWorktree?.path
    : activeScratchId
      ? activeScratchCwd
      : activeProject?.path;

  // Fetch URLs for the running task
  const entityId = activeWorktreeId || activeProjectId;
  useEffect(() => {
    if (runningTask?.status === 'running' && runningTask.taskName && entityId) {
      getTaskUrls(entityId, runningTask.taskName)
        .then(setTaskUrls)
        .catch(() => setTaskUrls([]));
    } else {
      setTaskUrls([]);
    }
  }, [entityId, runningTask?.taskName, runningTask?.status]);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const [activeDragItem, setActiveDragItem] = useState<{
    type: 'project' | 'worktree';
    id: string;
    projectId?: string;
  } | null>(null);

  function handleDragStart(event: DragStartEvent) {
    const { active } = event;
    const type = active.data.current?.type as 'project' | 'worktree';
    const projectId = active.data.current?.projectId as string | undefined;
    setActiveDragItem({ type, id: active.id as string, projectId });
  }

  // Custom collision detection that enforces hierarchical constraints
  const customCollisionDetection: CollisionDetection = (args) => {
    const { active, droppableContainers } = args;
    const dragType = active.data.current?.type;

    if (dragType === 'project') {
      // Projects can only drop on other projects
      const projectDroppables = droppableContainers.filter(
        (container) => container.data.current?.type === 'project'
      );
      return closestCenter({ ...args, droppableContainers: projectDroppables });
    }

    if (dragType === 'worktree') {
      // Worktrees can only drop on worktrees in the same project
      const projectId = active.data.current?.projectId;
      const sameProjectDroppables = droppableContainers.filter(
        (container) =>
          container.data.current?.type === 'worktree' &&
          container.data.current?.projectId === projectId
      );
      return closestCenter({ ...args, droppableContainers: sameProjectDroppables });
    }

    return closestCenter(args);
  };

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    if (!over || active.id === over.id) {
      setActiveDragItem(null);
      return;
    }

    const activeType = active.data.current?.type;

    if (activeType === 'project') {
      const oldIndex = projects.findIndex((p) => p.id === active.id);
      const newIndex = projects.findIndex((p) => p.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(projects, oldIndex, newIndex);
        onReorderProjects(reordered.map((p) => p.id));
      }
    } else if (activeType === 'worktree') {
      const projectId = active.data.current?.projectId;
      const project = projects.find((p) => p.id === projectId);

      if (project) {
        const oldIndex = project.worktrees.findIndex((w) => w.id === active.id);
        const newIndex = project.worktrees.findIndex((w) => w.id === over.id);

        if (oldIndex !== -1 && newIndex !== -1) {
          const reordered = arrayMove(project.worktrees, oldIndex, newIndex);
          onReorderWorktrees(projectId, reordered.map((w) => w.id));
        }
      }
    } else if (activeType === 'scratch') {
      const oldIndex = scratchTerminals.findIndex((s) => s.id === active.id);
      const newIndex = scratchTerminals.findIndex((s) => s.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(scratchTerminals, oldIndex, newIndex);
        onReorderScratchTerminals(reordered.map((s) => s.id));
      }
    }

    setActiveDragItem(null);
  }

  const handleOptionsClick = (e: React.MouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    setOptionsMenu({
      x: rect.left,
      y: rect.bottom + 4,
    });
  };

  const handleProjectContextMenu = (
    e: React.MouseEvent,
    project: Project
  ) => {
    e.preventDefault();
    setContextMenu({
      type: 'project',
      project,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleWorktreeContextMenu = (
    e: React.MouseEvent,
    worktree: Worktree
  ) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({
      type: 'worktree',
      worktree,
      x: e.clientX,
      y: e.clientY,
    });
  };

  const handleKebabClick = (
    e: React.MouseEvent<HTMLButtonElement>,
    project: Project
  ) => {
    e.stopPropagation();
    const rect = e.currentTarget.getBoundingClientRect();
    setContextMenu({
      type: 'project',
      project,
      x: rect.left,
      y: rect.bottom + 4,
    });
  };

  const handleCloseProject = () => {
    if (contextMenu?.type === 'project') {
      onCloseProject(contextMenu.project);
      setContextMenu(null);
    }
  };

  const handleHideProject = () => {
    if (contextMenu?.type === 'project') {
      onHideProject(contextMenu.project);
      setContextMenu(null);
    }
  };

  const handleCloseWorktreeFromMenu = () => {
    if (contextMenu?.type === 'worktree') {
      onCloseWorktree(contextMenu.worktree.id);
      setContextMenu(null);
    }
  };

  const handleDeleteWorktreeFromMenu = () => {
    if (contextMenu?.type === 'worktree') {
      onDeleteWorktree(contextMenu.worktree.id);
      setContextMenu(null);
    }
  };

  return (
    <div className="flex flex-col h-full select-none bg-sidebar">
      {/* Drag region for macOS traffic lights */}
      <DragRegion className="h-8 flex-shrink-0 flex items-center justify-end px-1">
        <span className="text-[10px] text-theme-4 font-mono mr-1">{__GIT_HASH__.slice(0, 7)}</span>
        <button
          onClick={handleOptionsClick}
          className="p-1 rounded hover:bg-theme-2 text-theme-3 hover:text-theme-1"
          title="Options"
        >
          <Settings size={14} />
        </button>
      </DragRegion>
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {/* Scratch Terminals Section - always shown */}
        <div className="mb-4 pb-3 border-b border-sidebar">
          {/* Scratch section header */}
          <div className="group relative flex items-center py-1 pr-2 text-theme-3">
            <div className="w-7 flex-shrink-0 flex items-center justify-center">
              <Hash size={12} className="text-theme-4" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-theme-4">Scratch</span>
            {/* Add button - show on hover */}
            <div className="absolute right-1 hidden group-hover:flex items-center gap-0.5 bg-theme-1 rounded">
              <button
                onClick={onAddScratchTerminal}
                className="p-0.5 rounded hover:bg-theme-3 text-theme-2 hover:text-theme-1"
                title="Add scratch terminal"
              >
                <Plus size={14} />
              </button>
            </div>
          </div>
          {/* Scratch terminal list */}
          {scratchTerminals.length > 0 && (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              onDragEnd={handleDragEnd}
            >
              <SortableContext
                items={scratchTerminals.map((s) => s.id)}
                strategy={verticalListSortingStrategy}
              >
                <div className="space-y-0.5 py-0.5">
                  {scratchTerminals.map((scratch) => {
                    const isSelected = activeScratchId === scratch.id;
                    const isThinking = thinkingScratchIds.has(scratch.id);
                    const isIdle = idleScratchIds.has(scratch.id);
                    const isNotified = notifiedScratchIds.has(scratch.id);
                    // Get shortcut number (1-9) for scratch terminals
                    const shortcutIndex = openEntitiesInOrder.findIndex(e => e.type === 'scratch' && e.id === scratch.id);
                    const shortcutNumber = shortcutIndex >= 0 && shortcutIndex < 9 ? shortcutIndex + 1 : null;
                    return (
                      <SortableScratch key={scratch.id} scratchId={scratch.id}>
                        <div
                          onClick={() => onSelectScratch(scratch.id)}
                          className={`group/scratch relative flex items-center py-1 pr-2 text-sm active:cursor-grabbing ${
                            isSelected
                              ? 'bg-sidebar-active text-theme-0 border-l-2 border-accent'
                              : 'text-theme-1 hover:bg-theme-2 hover:text-theme-0'
                          }`}
                        >
                          {/* Left indicator column */}
                          <div className="w-7 flex-shrink-0 flex items-center justify-center">
                            {isModifierKeyHeld && shortcutNumber !== null ? (
                              <span className="text-xs font-medium text-theme-2">{shortcutNumber}</span>
                            ) : null}
                          </div>
                          <EditableWorktreeName
                            name={scratch.name}
                            onRename={(newName) => {
                              onRenameScratch(scratch.id, newName);
                              return Promise.resolve();
                            }}
                            autoEdit={editingScratchId === scratch.id}
                            onAutoEditConsumed={onEditingScratchConsumed}
                            focusToRestoreRef={editingScratchId === scratch.id ? focusToRestoreRef : undefined}
                            onFocusMain={onFocusMain}
                          />
                          {/* Action buttons - show on hover */}
                          <div className={`absolute right-1 hidden group-hover/scratch:flex items-center gap-0.5 rounded ${isSelected ? 'bg-sidebar-active' : 'bg-theme-2'}`}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onCloseScratch(scratch.id);
                              }}
                              className="p-0.5 rounded hover:bg-theme-4 text-theme-3 hover:text-theme-1"
                              title="Close terminal"
                            >
                              <X size={12} />
                            </button>
                          </div>
                          {/* Status indicators - hide on hover */}
                          <StatusIndicators
                            isNotified={isNotified}
                            isThinking={isThinking}
                            isIdle={isIdle}
                            showIdleCheck={showIdleCheck}
                            isSelected={isSelected}
                            className="absolute right-1 group-hover/scratch:hidden"
                          />
                        </div>
                      </SortableScratch>
                    );
                  })}
                </div>
              </SortableContext>
            </DndContext>
          )}
        </div>

        {/* Projects section header */}
        <div className="group relative flex items-center py-1 pr-2 mb-1 text-theme-3">
          <div className="w-7 flex-shrink-0 flex items-center justify-center">
            <FolderGit2 size={12} className="text-theme-4" />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-theme-4">Projects</span>
          {/* Add button - show on hover */}
          <div className="absolute right-1 hidden group-hover:flex items-center gap-0.5 bg-theme-1 rounded">
            <button
              onClick={onRefreshProjects}
              disabled={isProjectsRefreshing}
              className="p-0.5 rounded hover:bg-theme-3 text-theme-2 hover:text-theme-1 disabled:opacity-60 disabled:cursor-not-allowed"
              title={refreshProjectsTitle}
              aria-label="Refresh projects"
            >
              {isProjectsRefreshing ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
            </button>
            <button
              onClick={onAddProject}
              className="p-0.5 rounded hover:bg-theme-3 text-theme-2 hover:text-theme-1"
              title="Add project"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-6 text-theme-3 text-xs">
            <p>No projects yet</p>
            <button
              onClick={onAddProject}
              className="mt-1 text-blue-400 hover:text-blue-300"
            >
              Add a project
            </button>
          </div>
        ) : projects.length === 0 ? (
          <div className="text-center py-6 text-theme-3 text-xs">
            <p>No active projects</p>
          </div>
        ) : (
          <DndContext
            sensors={sensors}
            collisionDetection={customCollisionDetection}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
          >
            <SortableContext
              items={projects.filter((p) => p.isActive).map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {projects.filter((p) => p.isActive).map((project) => {
                const hasOpenWorktrees = project.worktrees.some((w) => openWorktreeIds.has(w.id));
                const isProjectOpen = openProjectIds.has(project.id);
                const isProjectSelected = activeProjectId === project.id && !activeWorktreeId && !activeScratchId;
                // Get shortcut number (1-9) for open projects
                const projectShortcutIndex = isProjectOpen ? openEntitiesInOrder.findIndex(e => e.type === 'project' && e.id === project.id) : -1;
                const projectShortcutNumber = projectShortcutIndex >= 0 && projectShortcutIndex < 9 ? projectShortcutIndex + 1 : null;
                return (
                  <SortableProject key={project.id} projectId={project.id}>
                    <div className="mb-2">
                      <div
                        className={`group relative flex items-center py-1.5 pr-2 rounded active:cursor-grabbing ${
                          isProjectSelected
                            ? 'bg-sidebar-active text-theme-0 border-l-2 border-accent'
                            : hasOpenWorktrees || isProjectOpen
                              ? 'text-theme-1 hover:bg-theme-2'
                              : 'text-theme-2 hover:bg-theme-2'
                        }`}
                        onClick={() => onSelectProject(project)}
                        onContextMenu={(e) => handleProjectContextMenu(e, project)}
                      >
                        {/* Chevron/shortcut - shows shortcut number when cmd held and project is open, otherwise chevron */}
                        <div className="w-8 flex-shrink-0 flex items-center justify-center">
                          {isModifierKeyHeld && projectShortcutNumber !== null ? (
                            <span className={`text-xs font-medium ${runningTaskCounts.has(project.id) ? 'text-emerald-400' : 'text-theme-2'}`}>{projectShortcutNumber}</span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleProject(project.id);
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="p-0.5 -m-0.5 rounded hover:bg-theme-4"
                            >
                              {expandedProjects.has(project.id) ? (
                                <ChevronDown size={14} className={hasOpenWorktrees || isProjectOpen ? 'text-theme-2' : 'text-theme-3'} />
                              ) : (
                                <ChevronRight size={14} className={hasOpenWorktrees || isProjectOpen ? 'text-theme-2' : 'text-theme-3'} />
                              )}
                            </button>
                          )}
                        </div>
                        {/* Running indicator - only shown when tasks are running */}
                        {runningTaskCounts.has(project.id) && (
                          <span title={`${runningTaskCounts.get(project.id)} task${runningTaskCounts.get(project.id)! > 1 ? 's' : ''} running`} className="relative mr-1.5">
                            <Circle size={6} className="fill-emerald-400 text-emerald-400" />
                            {runningTaskCounts.get(project.id)! > 1 && (
                              <span className="absolute -top-1.5 left-1 text-[8px] font-medium text-theme-2">
                                {runningTaskCounts.get(project.id)}
                              </span>
                            )}
                          </span>
                        )}
                        <span className="text-sm font-medium truncate">{project.name}</span>
                        {/* Action buttons - show on hover */}
                        <div className={`absolute right-1 hidden group-hover:flex items-center gap-0.5 rounded ${isProjectSelected ? 'bg-sidebar-active' : 'bg-theme-2'}`}>
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddWorktree(project.id);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="p-0.5 rounded hover:bg-theme-3 text-theme-2 hover:text-theme-1"
                            title="Add Worktree"
                          >
                            <Plus size={14} />
                          </button>
                          <button
                            onClick={(e) => handleKebabClick(e, project)}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="p-0.5 rounded hover:bg-theme-3 text-theme-2 hover:text-theme-1"
                            title="More options"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </div>
                        {/* Status indicators - hide on hover */}
                        <StatusIndicators
                          isNotified={notifiedProjectIds.has(project.id)}
                          isThinking={thinkingProjectIds.has(project.id)}
                          isIdle={idleProjectIds.has(project.id)}
                          showIdleCheck={showIdleCheck}
                          isSelected={isProjectSelected}
                          className="absolute right-1 group-hover:hidden"
                        />
                      </div>

                      {expandedProjects.has(project.id) && (
                        <div className="mt-0.5 space-y-0.5 ml-3 border-l border-sidebar/50 py-0.5">
                          {project.worktrees.length === 0 ? (
                            <button
                              onClick={() => onAddWorktree(project.id)}
                              className="flex items-center gap-1.5 pl-4 pr-2 py-1 text-xs text-theme-3 hover:text-theme-1"
                            >
                              <Plus size={12} />
                              Add worktree
                            </button>
                          ) : (
                            <SortableContext
                              items={project.worktrees.map((w) => w.id)}
                              strategy={verticalListSortingStrategy}
                            >
                              {project.worktrees.map((worktree) => {
                                const isLoading = loadingWorktrees.has(worktree.id);
                                const isThinking = thinkingWorktreeIds.has(worktree.id);
                                const isIdle = idleWorktreeIds.has(worktree.id);
                                const isNotified = notifiedWorktreeIds.has(worktree.id);
                                const isOpen = openWorktreeIds.has(worktree.id);
                                const isSelected = activeWorktreeId === worktree.id;
                                // Get shortcut number (1-9) for open entities
                                const shortcutIndex = isOpen ? openEntitiesInOrder.findIndex(e => e.type === 'worktree' && e.id === worktree.id) : -1;
                                const shortcutNumber = shortcutIndex >= 0 && shortcutIndex < 9 ? shortcutIndex + 1 : null;
                                return (
                                  <SortableWorktree key={worktree.id} worktreeId={worktree.id} projectId={project.id}>
                                    <div
                                      onClick={() => onSelectWorktree(worktree)}
                                      onContextMenu={(e) => handleWorktreeContextMenu(e, worktree)}
                                      className={`group/worktree relative flex items-center py-1 pr-2 text-sm active:cursor-grabbing ${
                                        isSelected
                                          ? 'bg-sidebar-active text-theme-0 border-l-2 border-accent'
                                          : isOpen
                                            ? 'text-theme-1 hover:bg-theme-2/50 hover:text-theme-0'
                                            : 'text-theme-3 hover:bg-theme-2/50 hover:text-theme-1'
                                      }`}
                                    >
                                      {/* Left indicator column */}
                                      <div className="w-5 flex-shrink-0 flex items-center justify-center">
                                        {isModifierKeyHeld && shortcutNumber !== null ? (
                                          <span className={`text-xs font-medium ${runningTaskCounts.has(worktree.id) ? 'text-emerald-400' : 'text-theme-2'}`}>{shortcutNumber}</span>
                                        ) : runningTaskCounts.has(worktree.id) ? (
                                          <span title={`${runningTaskCounts.get(worktree.id)} task${runningTaskCounts.get(worktree.id)! > 1 ? 's' : ''} running`} className="relative">
                                            <Circle size={6} className="fill-emerald-400 text-emerald-400" />
                                            {runningTaskCounts.get(worktree.id)! > 1 && (
                                              <span className="absolute -top-1.5 left-1 text-[8px] font-medium text-theme-2">
                                                {runningTaskCounts.get(worktree.id)}
                                              </span>
                                            )}
                                          </span>
                                        ) : null}
                                      </div>
                                      <EditableWorktreeName
                                        name={worktree.name}
                                        onRename={(newName) => onRenameWorktree(worktree.id, newName)}
                                        autoEdit={autoEditWorktreeId === worktree.id}
                                        onAutoEditConsumed={onAutoEditConsumed}
                                        focusToRestoreRef={autoEditWorktreeId === worktree.id ? focusToRestoreRef : undefined}
                                        onFocusMain={onFocusMain}
                                      />
                                      {isLoading ? (
                                        <span className="absolute right-1" title="Starting...">
                                          <Loader2 size={12} className="animate-spin text-blue-400" />
                                        </span>
                                      ) : (
                                        <>
                                          {/* Action buttons - show on hover */}
                                          <div className={`absolute right-1 hidden group-hover/worktree:flex items-center gap-0.5 rounded ${isSelected ? 'bg-sidebar-active' : 'bg-theme-2'}`}>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onDeleteWorktree(worktree.id);
                                              }}
                                              onPointerDown={(e) => e.stopPropagation()}
                                              className="p-0.5 rounded hover:bg-theme-4 text-theme-3 hover:text-red-400"
                                              title="Delete Worktree"
                                            >
                                              <Trash2 size={12} />
                                            </button>
                                            {isOpen && (
                                              <button
                                                onClick={(e) => {
                                                  e.stopPropagation();
                                                  onCloseWorktree(worktree.id);
                                                }}
                                                onPointerDown={(e) => e.stopPropagation()}
                                                className="p-0.5 rounded hover:bg-theme-4 text-theme-3 hover:text-theme-1"
                                                title="Close Worktree"
                                              >
                                                <X size={12} />
                                              </button>
                                            )}
                                          </div>
                                          {/* Status indicators - hide on hover */}
                                          <StatusIndicators
                                            isNotified={isNotified}
                                            isThinking={isThinking}
                                            isIdle={isIdle}
                                            showIdleCheck={showIdleCheck}
                                            isSelected={isSelected}
                                            className="absolute right-1 group-hover/worktree:hidden"
                                          />
                                        </>
                                      )}
                                    </div>
                                  </SortableWorktree>
                                );
                              })}
                            </SortableContext>
                          )}
                        </div>
                      )}
                    </div>
                  </SortableProject>
                );
              })}
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeDragItem && (
                <div className="bg-theme-3 text-theme-0 px-2 py-1 rounded shadow-lg border border-theme-1 text-sm">
                  {activeDragItem.type === 'project'
                    ? projects.find((p) => p.id === activeDragItem.id)?.name
                    : (() => {
                        const project = projects.find((p) => p.id === activeDragItem.projectId);
                        return project?.worktrees.find((w) => w.id === activeDragItem.id)?.name;
                      })()}
                </div>
              )}
            </DragOverlay>
          </DndContext>
        )}
      </div>

      {contextMenu && (() => {
        const fileManagerCommand = getAppCommand(appsConfig.fileManager);
        const fileManagerLabel = fileManagerCommand
          ? `Open in ${fileManagerCommand}`
          : 'Open in File Manager';
        const contextPath = contextMenu.type === 'project' ? contextMenu.project.path : contextMenu.worktree.path;
        const items = contextMenu.type === 'project'
          ? [
              {
                label: refreshProjectsTitle,
                icon: <RefreshCw size={14} />,
                onClick: onRefreshProjects,
              },
              {
                label: fileManagerLabel,
                icon: <Folder size={14} />,
                onClick: () => {
                  invoke('open_in_file_manager', {
                    path: contextPath,
                    app: fileManagerCommand ?? null,
                  });
                  setContextMenu(null);
                },
              },
              {
                label: 'Close Project',
                onClick: handleCloseProject,
              },
              {
                label: 'Hide Project',
                onClick: handleHideProject,
              },
            ]
          : [
              {
                label: fileManagerLabel,
                icon: <Folder size={14} />,
                onClick: () => {
                  invoke('open_in_file_manager', {
                    path: contextPath,
                    app: fileManagerCommand ?? null,
                  });
                  setContextMenu(null);
                },
              },
              {
                label: refreshProjectsTitle,
                icon: <RefreshCw size={14} />,
                onClick: onRefreshProjects,
              },
              {
                label: 'Close Worktree',
                onClick: handleCloseWorktreeFromMenu,
              },
              {
                label: 'Delete Worktree',
                onClick: handleDeleteWorktreeFromMenu,
              },
            ];

        return (
          <ContextMenu
            x={contextMenu.x}
            y={contextMenu.y}
            items={items}
            onClose={() => setContextMenu(null)}
          />
        );
      })()}

      {optionsMenu && (() => {
        const handleOpenConfigFile = async (fileType: 'settings' | 'mappings') => {
          setOptionsMenu(null);

          try {
            // Get the config file path (creates file if it doesn't exist)
            const path = await invoke<string>('get_config_file_path', { fileType });
            await invoke('open_default', { path });
          } catch (err) {
            console.error('Failed to open config file:', err);
          }
        };

        return (
          <ContextMenu
            x={optionsMenu.x}
            y={optionsMenu.y}
            items={[
              {
                label: 'Appearance',
                icon: <Palette size={14} />,
                onClick: () => {
                  setOptionsMenu(null);
                  onOpenAppearanceSettings();
                },
              },
              {
                label: 'Open Settings',
                icon: <Settings size={14} />,
                onClick: () => handleOpenConfigFile('settings'),
              },
              {
                label: 'Open Mappings',
                icon: <Keyboard size={14} />,
                onClick: () => handleOpenConfigFile('mappings'),
              },
            ]}
            onClose={() => setOptionsMenu(null)}
          />
        );
      })()}

      {/* Folder path display - shows for worktrees, projects, and scratch */}
      {activePath && (() => {
        // For scratch: show full path with ~ for home dir, truncate from left
        // For worktree/project: show just the folder name
        const isScratch = !!activeScratchId;
        const fullPath = homeDir && activePath.startsWith(homeDir)
          ? '~' + activePath.slice(homeDir.length)
          : activePath;
        const folderName = activePath.split('/').pop() ?? '';
        const displayPath = isScratch ? fullPath : folderName;

        return (
          <button
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              setFolderMenu({ x: rect.left, y: rect.top - 76 });
            }}
            className="h-8 px-2 border-t border-sidebar text-xs text-theme-3 hover:text-theme-1 hover:bg-theme-2/50 flex items-center w-full transition-colors overflow-hidden"
            title={activePath}
          >
            <span
              className="w-full overflow-hidden whitespace-nowrap text-ellipsis"
              style={{ fontFamily: terminalFontFamily, direction: isScratch ? 'rtl' : 'ltr' }}
            >
              <bdi>{displayPath}</bdi>
            </span>
          </button>
        );
      })()}

      {/* Git status bar - shows branch and changed files for projects/worktrees */}
      {!activeScratchId && branchInfo && (() => {
        const isWorktree = !branchInfo.isOnBaseBranch;
        const showBranchDiff = isWorktree && changedFilesMode === 'branch';
        const tooltip = isWorktree
          ? "⇡ = commits ahead of base, ~ = files changed vs base, * = uncommitted"
          : "* = uncommitted changes";

        return (
          <div
            className="h-6 px-2 border-t border-sidebar text-xs flex items-center justify-between w-full"
            title={tooltip}
          >
            <span className="flex items-center gap-1 overflow-hidden text-theme-4">
              <GitBranch size={12} className="shrink-0" />
              <span className="truncate" style={{ fontFamily: terminalFontFamily }}>{branchInfo.currentBranch}</span>
            </span>
            <span className="flex items-center gap-2 shrink-0" style={{ fontFamily: terminalFontFamily }}>
              {/* For worktrees: show commits ahead */}
              {isWorktree && branchInfo.commitsAhead > 0 && (
                <span className="text-cyan-500/60">⇡{branchInfo.commitsAhead}</span>
              )}
              {/* Files changed vs base (cyan) or uncommitted (amber) */}
              {changedFilesCount > 0 && (
                showBranchDiff
                  ? <span className="text-cyan-500/60">~{changedFilesCount}</span>
                  : <span className="text-amber-500/60">*{changedFilesCount}</span>
              )}
            </span>
          </div>
        );
      })()}

      {/* Folder context menu */}
      {folderMenu && activePath && (() => {
        const fileManagerCommand = getAppCommand(appsConfig.fileManager);
        const terminalCommand = getAppCommand(appsConfig.terminal);
        const editorCommand = getAppCommand(appsConfig.editor);
        const editorTarget = getAppTarget(appsConfig.editor, 'terminal'); // Editor defaults to terminal target

        // Build labels
        const fileManagerLabel = fileManagerCommand
          ? `Open in ${fileManagerCommand}`
          : 'Open in File Manager';

        const terminalLabel = terminalCommand
          ? `Open in ${terminalCommand}`
          : 'Open in Terminal';

        const editorLabel = editorCommand
          ? `Open in ${editorCommand}`
          : 'Open in Editor';

        const handleOpenEditor = () => {
          if (!editorCommand) {
            invoke('open_default', { path: activePath }).catch((err) => {
              console.error('Failed to open path:', err);
            });
            return;
          }

          if (editorTarget === 'drawer') {
            // Open in shellflow's drawer with template substitution
            onOpenInDrawer(activePath, substitutePathTemplate(editorCommand, activePath));
          } else if (editorTarget === 'tab') {
            // Open in a new session tab with template substitution
            onOpenInTab(activePath, substitutePathTemplate(editorCommand, activePath));
          } else {
            // External or terminal target - handled by backend (which also does template substitution)
            invoke('open_in_editor', {
              path: activePath,
              app: editorCommand,
              target: editorTarget,
              terminalApp: terminalCommand ?? null,
            }).catch((err) => {
              console.error('Failed to open editor:', err);
            });
          }
        };

        return (
          <ContextMenu
            x={folderMenu.x}
            y={folderMenu.y}
            items={[
              {
                label: fileManagerLabel,
                icon: <Folder size={14} />,
                onClick: () => invoke('open_in_file_manager', { path: activePath, app: fileManagerCommand ?? null }),
              },
              {
                label: terminalLabel,
                icon: <SquareTerminal size={14} />,
                onClick: () => invoke('open_in_terminal', { path: activePath, app: terminalCommand ?? null }),
              },
              {
                label: editorLabel,
                icon: <Code size={14} />,
                onClick: handleOpenEditor,
              },
            ]}
            onClose={() => setFolderMenu(null)}
          />
        );
      })()}

      {/* Task URLs - show when a task with URLs is running */}
      {taskUrls.length > 0 && (
        <div className="px-2 py-1 border-t border-sidebar flex items-center gap-3 overflow-x-auto">
          {taskUrls.map(({ name, url }) => (
            <button
              key={name}
              onClick={() => openUrl(url).catch(console.error)}
              title={url}
              className="flex items-center gap-1 text-xs text-theme-2 hover:text-blue-400 transition-colors whitespace-nowrap"
            >
              <ExternalLink size={12} />
              <span>{name}</span>
            </button>
          ))}
        </div>
      )}

      {/* Task selector - above status bar */}
      {(activeWorktreeId || activeProjectId) && tasks.length > 0 && (
        <TaskSelector
          tasks={tasks}
          selectedTask={selectedTask}
          runningTask={runningTask}
          allRunningTasks={allRunningTasks}
          onSelectTask={onSelectTask}
          onStartTask={onStartTask}
          onStopTask={onStopTask}
          onForceKillTask={onForceKillTask}
        />
      )}

      {/* Status bar - shows different actions for project vs worktree vs scratch */}
      {(activeWorktreeId || activeProjectId || activeScratchId) && (
        <div className="flex items-center h-8 px-1 border-t border-sidebar flex-shrink-0">
          {activeWorktreeId ? (
            <>
              {/* Worktree-specific actions */}
              <button
                onClick={onToggleDrawer}
                className={`p-1.5 rounded hover:bg-theme-2 flex-shrink-0 ${
                  isDrawerOpen ? 'text-blue-400' : 'text-theme-3 hover:text-theme-1'
                }`}
                title={toggleDrawerTitle}
              >
                <Terminal size={16} />
              </button>
              <button
                onClick={onToggleRightPanel}
                className={`p-1.5 rounded hover:bg-theme-2 flex-shrink-0 ${
                  isRightPanelOpen ? 'text-blue-400' : 'text-theme-3 hover:text-theme-1'
                }`}
                title={toggleRightPanelTitle}
              >
                <PanelRight size={16} />
              </button>
              <button
                onClick={onOpenCommitModal}
                className="p-1.5 rounded text-theme-3 hover:text-theme-1 hover:bg-theme-2 flex-shrink-0"
                title="Commit changes"
              >
                <GitCommit size={16} />
              </button>
              <div className="flex-1" />
              <button
                onClick={() => onMergeWorktree(activeWorktreeId)}
                className="p-1.5 rounded text-theme-3 hover:text-blue-400 hover:bg-theme-2 flex-shrink-0"
                title="Merge branch"
              >
                <GitMerge size={16} />
              </button>
              <button
                onClick={() => onDeleteWorktree(activeWorktreeId)}
                className="p-1.5 rounded text-theme-3 hover:text-red-400 hover:bg-theme-2 flex-shrink-0"
                title="Delete worktree"
              >
                <Trash2 size={16} />
              </button>
            </>
          ) : activeScratchId ? (
            <>
              {/* Scratch-specific actions - just drawer toggle */}
              <button
                onClick={onToggleDrawer}
                className={`p-1.5 rounded hover:bg-theme-2 flex-shrink-0 ${
                  isDrawerOpen ? 'text-blue-400' : 'text-theme-3 hover:text-theme-1'
                }`}
                title={toggleDrawerTitle}
              >
                <Terminal size={16} />
              </button>
              <div className="flex-1" />
            </>
          ) : (
            <>
              {/* Project-specific actions - drawer toggle and right panel toggle */}
              <button
                onClick={onToggleDrawer}
                className={`p-1.5 rounded hover:bg-theme-2 flex-shrink-0 ${
                  isDrawerOpen ? 'text-blue-400' : 'text-theme-3 hover:text-theme-1'
                }`}
                title={toggleDrawerTitle}
              >
                <Terminal size={16} />
              </button>
              <button
                onClick={onToggleRightPanel}
                className={`p-1.5 rounded hover:bg-theme-2 flex-shrink-0 ${
                  isRightPanelOpen ? 'text-blue-400' : 'text-theme-3 hover:text-theme-1'
                }`}
                title={toggleRightPanelTitle}
              >
                <PanelRight size={16} />
              </button>
              <button
                onClick={onOpenCommitModal}
                className="p-1.5 rounded text-theme-3 hover:text-theme-1 hover:bg-theme-2 flex-shrink-0"
                title="Commit changes"
              >
                <GitCommit size={16} />
              </button>
              <div className="flex-1" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

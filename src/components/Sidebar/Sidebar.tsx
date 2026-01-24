import { FolderGit2, Plus, ChevronRight, ChevronDown, MoreHorizontal, Trash2, Loader2, Terminal, GitMerge, X, PanelRight, BellDot, Settings, Circle, Folder, Check, ExternalLink, Hash, SquareTerminal, Code } from 'lucide-react';
import { Project, Worktree, RunningTask, ScratchTerminal } from '../../types';
import { TaskConfig } from '../../hooks/useConfig';
import { useState, useMemo, useEffect } from 'react';
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
  runningTaskCounts: Map<string, number>;
  expandedProjects: Set<string>;
  isDrawerOpen: boolean;
  isRightPanelOpen: boolean;
  tasks: TaskConfig[];
  selectedTask: string | null;
  runningTask: RunningTask | null;
  allRunningTasks: Array<{ taskName: string; status: string }>;
  terminalFontFamily: string;
  terminalApp: string;
  editorApp: string;
  showIdleCheck: boolean;
  activeScratchCwd: string | null;
  homeDir: string | null;
  /** Worktree ID that should auto-enter edit mode for its name */
  autoEditWorktreeId: string | null;
  onToggleProject: (projectId: string) => void;
  onSelectProject: (project: Project) => void;
  onSelectWorktree: (worktree: Worktree) => void;
  onAddProject: () => void;
  onAddWorktree: (projectId: string) => void;
  onDeleteWorktree: (worktreeId: string) => void;
  onCloseWorktree: (worktreeId: string) => void;
  onCloseProject: (projectId: string) => void;
  onMergeWorktree: (worktreeId: string) => void;
  onToggleDrawer: () => void;
  onToggleRightPanel: () => void;
  onRemoveProject: (project: Project) => void;
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
  runningTaskCounts,
  expandedProjects,
  isDrawerOpen,
  isRightPanelOpen,
  tasks,
  selectedTask,
  runningTask,
  allRunningTasks,
  terminalFontFamily,
  terminalApp,
  editorApp,
  showIdleCheck,
  activeScratchCwd,
  homeDir,
  autoEditWorktreeId,
  onToggleProject,
  onSelectProject,
  onSelectWorktree,
  onAddProject,
  onAddWorktree,
  onDeleteWorktree,
  onCloseWorktree,
  onCloseProject,
  onMergeWorktree,
  onToggleDrawer,
  onToggleRightPanel,
  onRemoveProject,
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
}: SidebarProps) {
  const [contextMenu, setContextMenu] = useState<{
    project: Project;
    x: number;
    y: number;
  } | null>(null);

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
      const oldIndex = filteredProjects.findIndex((p) => p.id === active.id);
      const newIndex = filteredProjects.findIndex((p) => p.id === over.id);

      if (oldIndex !== -1 && newIndex !== -1) {
        const reordered = arrayMove(filteredProjects, oldIndex, newIndex);
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
      project,
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
      project,
      x: rect.left,
      y: rect.bottom + 4,
    });
  };

  const handleRemoveProject = () => {
    if (contextMenu) {
      onRemoveProject(contextMenu.project);
      setContextMenu(null);
    }
  };

  const handleCloseProject = () => {
    if (contextMenu) {
      onCloseProject(contextMenu.project.id);
      setContextMenu(null);
    }
  };

  // Filter projects to show only active ones in the sidebar
  const filteredProjects = useMemo(() => {
    return projects.filter((project) => project.isActive);
  }, [projects]);

  return (
    <div className="flex flex-col h-full bg-zinc-900 select-none">
      {/* Drag region for macOS traffic lights */}
      <DragRegion className="h-8 flex-shrink-0 flex items-center justify-end px-1">
        <span className="text-[10px] text-zinc-600 font-mono mr-1">{__GIT_HASH__.slice(0, 7)}</span>
        <button
          onClick={handleOptionsClick}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          title="Options"
        >
          <Settings size={14} />
        </button>
      </DragRegion>
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {/* Scratch Terminals Section - always shown */}
        <div className="mb-4 pb-3 border-b border-zinc-800">
          {/* Scratch section header */}
          <div className="group relative flex items-center py-1 pr-2 text-zinc-500">
            <div className="w-7 flex-shrink-0 flex items-center justify-center">
              <Hash size={12} className="text-zinc-600" />
            </div>
            <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Scratch</span>
            {/* Add button - show on hover */}
            <div className="absolute right-1 hidden group-hover:flex items-center gap-0.5 bg-zinc-900 rounded">
              <button
                onClick={onAddScratchTerminal}
                className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
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
                    // Get shortcut number (1-9) for scratch terminals
                    const shortcutIndex = openEntitiesInOrder.findIndex(e => e.type === 'scratch' && e.id === scratch.id);
                    const shortcutNumber = shortcutIndex >= 0 && shortcutIndex < 9 ? shortcutIndex + 1 : null;
                    return (
                      <SortableScratch key={scratch.id} scratchId={scratch.id}>
                        <div
                          onClick={() => onSelectScratch(scratch.id)}
                          className={`group/scratch relative flex items-center py-1 pr-2 text-sm active:cursor-grabbing ${
                            isSelected
                              ? 'bg-zinc-700 text-zinc-100'
                              : 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                          }`}
                        >
                          {/* Left indicator column */}
                          <div className="w-7 flex-shrink-0 flex items-center justify-center">
                            {isModifierKeyHeld && shortcutNumber !== null ? (
                              <span className="text-xs font-medium text-zinc-400">{shortcutNumber}</span>
                            ) : null}
                          </div>
                          <EditableWorktreeName
                            name={scratch.name}
                            onRename={(newName) => {
                              onRenameScratch(scratch.id, newName);
                              return Promise.resolve();
                            }}
                          />
                          {/* Action buttons - show on hover */}
                          <div className={`absolute right-1 hidden group-hover/scratch:flex items-center gap-0.5 rounded ${isSelected ? 'bg-zinc-700' : 'bg-zinc-800'}`}>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onCloseScratch(scratch.id);
                              }}
                              className="p-0.5 rounded hover:bg-zinc-600 text-zinc-500 hover:text-zinc-300"
                              title="Close terminal"
                            >
                              <X size={12} />
                            </button>
                          </div>
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
        <div className="group relative flex items-center py-1 pr-2 mb-1 text-zinc-500">
          <div className="w-7 flex-shrink-0 flex items-center justify-center">
            <FolderGit2 size={12} className="text-zinc-600" />
          </div>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-zinc-600">Projects</span>
          {/* Add button - show on hover */}
          <div className="absolute right-1 hidden group-hover:flex items-center gap-0.5 bg-zinc-900 rounded">
            <button
              onClick={onAddProject}
              className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
              title="Add project"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        {projects.length === 0 ? (
          <div className="text-center py-6 text-zinc-500 text-xs">
            <p>No projects yet</p>
            <button
              onClick={onAddProject}
              className="mt-1 text-blue-400 hover:text-blue-300"
            >
              Add a project
            </button>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-6 text-zinc-500 text-xs">
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
              items={filteredProjects.map((p) => p.id)}
              strategy={verticalListSortingStrategy}
            >
              {filteredProjects.map((project) => {
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
                        className={`group relative flex items-center py-1 pr-2 rounded active:cursor-grabbing ${
                          isProjectSelected
                            ? 'bg-zinc-700 text-zinc-100'
                            : hasOpenWorktrees || isProjectOpen
                              ? 'text-zinc-200 hover:bg-zinc-800'
                              : 'text-zinc-400 hover:bg-zinc-800'
                        }`}
                        onClick={() => onSelectProject(project)}
                        onContextMenu={(e) => handleProjectContextMenu(e, project)}
                      >
                        {/* Chevron/shortcut - shows shortcut number when cmd held and project is open, otherwise chevron */}
                        <div className="w-7 flex-shrink-0 flex items-center justify-center">
                          {isModifierKeyHeld && projectShortcutNumber !== null ? (
                            <span className={`text-xs font-medium ${runningTaskCounts.has(project.id) ? 'text-emerald-400' : 'text-zinc-400'}`}>{projectShortcutNumber}</span>
                          ) : (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onToggleProject(project.id);
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="p-0.5 -m-0.5 rounded hover:bg-zinc-600"
                            >
                              {expandedProjects.has(project.id) ? (
                                <ChevronDown size={14} className={hasOpenWorktrees || isProjectOpen ? 'text-zinc-400' : 'text-zinc-500'} />
                              ) : (
                                <ChevronRight size={14} className={hasOpenWorktrees || isProjectOpen ? 'text-zinc-400' : 'text-zinc-500'} />
                              )}
                            </button>
                          )}
                        </div>
                        {/* Running indicator - only shown when tasks are running */}
                        {runningTaskCounts.has(project.id) && (
                          <span title={`${runningTaskCounts.get(project.id)} task${runningTaskCounts.get(project.id)! > 1 ? 's' : ''} running`} className="relative mr-1.5">
                            <Circle size={6} className="fill-emerald-400 text-emerald-400" />
                            {runningTaskCounts.get(project.id)! > 1 && (
                              <span className="absolute -top-1.5 left-1 text-[8px] font-medium text-zinc-400">
                                {runningTaskCounts.get(project.id)}
                              </span>
                            )}
                          </span>
                        )}
                        <span className="text-sm font-medium truncate">{project.name}</span>
                        {/* Action buttons - show on hover */}
                        <div className={`absolute right-1 hidden group-hover:flex items-center gap-0.5 rounded ${isProjectSelected ? 'bg-zinc-700' : 'bg-zinc-800'}`}>
                          {isProjectOpen && (
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onCloseProject(project.id);
                              }}
                              onPointerDown={(e) => e.stopPropagation()}
                              className="p-0.5 rounded hover:bg-zinc-600 text-zinc-500 hover:text-zinc-300"
                              title="Close project terminal"
                            >
                              <X size={14} />
                            </button>
                          )}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddWorktree(project.id);
                            }}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
                            title="Add Worktree"
                          >
                            <Plus size={14} />
                          </button>
                          <button
                            onClick={(e) => handleKebabClick(e, project)}
                            onPointerDown={(e) => e.stopPropagation()}
                            className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
                            title="More options"
                          >
                            <MoreHorizontal size={14} />
                          </button>
                        </div>
                        {/* Status indicators - hide on hover. Priority: notification > thinking > idle */}
                        {notifiedProjectIds.has(project.id) && !isProjectSelected && (
                          <span className="absolute right-1 group-hover:hidden" title="New notification">
                            <BellDot size={12} className="text-blue-400" />
                          </span>
                        )}
                        {thinkingProjectIds.has(project.id) && !isProjectSelected && !notifiedProjectIds.has(project.id) && (
                          <span className="absolute right-1 group-hover:hidden" title="Thinking...">
                            <Loader2 size={12} className="animate-spin text-violet-400" />
                          </span>
                        )}
                        {showIdleCheck && idleProjectIds.has(project.id) && !isProjectSelected && !notifiedProjectIds.has(project.id) && !thinkingProjectIds.has(project.id) && (
                          <span className="absolute right-1 group-hover:hidden" title="Ready">
                            <Check size={12} className="text-emerald-400" />
                          </span>
                        )}
                      </div>

                      {expandedProjects.has(project.id) && (
                        <div className="mt-0.5 space-y-0.5 ml-3 border-l border-zinc-700/50 py-0.5">
                          {project.worktrees.length === 0 ? (
                            <button
                              onClick={() => onAddWorktree(project.id)}
                              className="flex items-center gap-1.5 pl-4 pr-2 py-1 text-xs text-zinc-500 hover:text-zinc-300"
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
                                      className={`group/worktree relative flex items-center py-1 pr-2 text-sm active:cursor-grabbing ${
                                        isSelected
                                          ? 'bg-zinc-700 text-zinc-100'
                                          : isOpen
                                            ? 'text-zinc-300 hover:bg-zinc-800/50 hover:text-zinc-100'
                                            : 'text-zinc-500 hover:bg-zinc-800/50 hover:text-zinc-300'
                                      }`}
                                    >
                                      {/* Left indicator column */}
                                      <div className="w-5 flex-shrink-0 flex items-center justify-center">
                                        {isModifierKeyHeld && shortcutNumber !== null ? (
                                          <span className={`text-xs font-medium ${runningTaskCounts.has(worktree.id) ? 'text-emerald-400' : 'text-zinc-400'}`}>{shortcutNumber}</span>
                                        ) : runningTaskCounts.has(worktree.id) ? (
                                          <span title={`${runningTaskCounts.get(worktree.id)} task${runningTaskCounts.get(worktree.id)! > 1 ? 's' : ''} running`} className="relative">
                                            <Circle size={6} className="fill-emerald-400 text-emerald-400" />
                                            {runningTaskCounts.get(worktree.id)! > 1 && (
                                              <span className="absolute -top-1.5 left-1 text-[8px] font-medium text-zinc-400">
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
                                      />
                                      {isLoading ? (
                                        <span className="absolute right-1" title="Starting...">
                                          <Loader2 size={12} className="animate-spin text-blue-400" />
                                        </span>
                                      ) : (
                                        <>
                                          {/* Action buttons - show on hover */}
                                          <div className={`absolute right-1 hidden group-hover/worktree:flex items-center gap-0.5 rounded ${isSelected ? 'bg-zinc-700' : 'bg-zinc-800'}`}>
                                            <button
                                              onClick={(e) => {
                                                e.stopPropagation();
                                                onDeleteWorktree(worktree.id);
                                              }}
                                              onPointerDown={(e) => e.stopPropagation()}
                                              className="p-0.5 rounded hover:bg-zinc-600 text-zinc-500 hover:text-red-400"
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
                                                className="p-0.5 rounded hover:bg-zinc-600 text-zinc-500 hover:text-zinc-300"
                                                title="Close Worktree"
                                              >
                                                <X size={12} />
                                              </button>
                                            )}
                                          </div>
                                          {/* Status indicators - hide on hover. Priority: notification > thinking > idle */}
                                          {isNotified && !isSelected && (
                                            <span className="absolute right-1 group-hover/worktree:hidden" title="New notification">
                                              <BellDot size={12} className="text-blue-400" />
                                            </span>
                                          )}
                                          {isThinking && !isSelected && !isNotified && (
                                            <span className="absolute right-1 group-hover/worktree:hidden" title="Thinking...">
                                              <Loader2 size={12} className="animate-spin text-violet-400" />
                                            </span>
                                          )}
                                          {showIdleCheck && isIdle && !isSelected && !isNotified && !isThinking && (
                                            <span className="absolute right-1 group-hover/worktree:hidden" title="Ready">
                                              <Check size={12} className="text-emerald-400" />
                                            </span>
                                          )}
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
                <div className="bg-zinc-700 text-zinc-100 px-2 py-1 rounded shadow-lg border border-zinc-600 text-sm">
                  {activeDragItem.type === 'project'
                    ? filteredProjects.find((p) => p.id === activeDragItem.id)?.name
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

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: 'Close Project',
              onClick: handleCloseProject,
            },
            {
              label: 'Remove Project',
              onClick: handleRemoveProject,
              danger: true,
            },
          ]}
          onClose={() => setContextMenu(null)}
        />
      )}

      {optionsMenu && (
        <ContextMenu
          x={optionsMenu.x}
          y={optionsMenu.y}
          items={[
            {
              label: 'hi mom',
              onClick: () => setOptionsMenu(null),
            },
          ]}
          onClose={() => setOptionsMenu(null)}
        />
      )}

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
              setFolderMenu({ x: rect.left, y: rect.top - 100 });
            }}
            className="h-8 px-2 border-t border-zinc-800 text-xs text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800/50 flex items-center w-full transition-colors overflow-hidden"
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

      {/* Folder context menu */}
      {folderMenu && activePath && (
        <ContextMenu
          x={folderMenu.x}
          y={folderMenu.y}
          items={[
            {
              label: 'Open in Finder',
              icon: <Folder size={14} />,
              onClick: () => invoke('open_folder', { path: activePath }),
            },
            {
              label: `Open in ${terminalApp}`,
              icon: <SquareTerminal size={14} />,
              onClick: () => invoke('open_with_app', { path: activePath, app: terminalApp }),
            },
            {
              label: `Open in ${editorApp}`,
              icon: <Code size={14} />,
              onClick: () => invoke('open_with_app', { path: activePath, app: editorApp }),
            },
          ]}
          onClose={() => setFolderMenu(null)}
        />
      )}

      {/* Task URLs - show when a task with URLs is running */}
      {taskUrls.length > 0 && (
        <div className="px-2 py-1 border-t border-zinc-800 flex items-center gap-3 overflow-x-auto">
          {taskUrls.map(({ name, url }) => (
            <button
              key={name}
              onClick={() => openUrl(url).catch(console.error)}
              title={url}
              className="flex items-center gap-1 text-xs text-zinc-400 hover:text-blue-400 transition-colors whitespace-nowrap"
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
        <div className="flex items-center h-8 px-1 border-t border-zinc-800 flex-shrink-0">
          {activeWorktreeId ? (
            <>
              {/* Worktree-specific actions */}
              <button
                onClick={onToggleDrawer}
                className={`p-1.5 rounded hover:bg-zinc-800 flex-shrink-0 ${
                  isDrawerOpen ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
                title="Toggle terminal (Ctrl+`)"
              >
                <Terminal size={16} />
              </button>
              <button
                onClick={onToggleRightPanel}
                className={`p-1.5 rounded hover:bg-zinc-800 flex-shrink-0 ${
                  isRightPanelOpen ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
                title="Toggle right panel (Cmd+R)"
              >
                <PanelRight size={16} />
              </button>
              <div className="flex-1" />
              <button
                onClick={() => onMergeWorktree(activeWorktreeId)}
                className="p-1.5 rounded text-zinc-500 hover:text-blue-400 hover:bg-zinc-800 flex-shrink-0"
                title="Merge branch"
              >
                <GitMerge size={16} />
              </button>
              <button
                onClick={() => onDeleteWorktree(activeWorktreeId)}
                className="p-1.5 rounded text-zinc-500 hover:text-red-400 hover:bg-zinc-800 flex-shrink-0"
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
                className={`p-1.5 rounded hover:bg-zinc-800 flex-shrink-0 ${
                  isDrawerOpen ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
                title="Toggle terminal (Ctrl+`)"
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
                className={`p-1.5 rounded hover:bg-zinc-800 flex-shrink-0 ${
                  isDrawerOpen ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
                title="Toggle terminal (Ctrl+`)"
              >
                <Terminal size={16} />
              </button>
              <button
                onClick={onToggleRightPanel}
                className={`p-1.5 rounded hover:bg-zinc-800 flex-shrink-0 ${
                  isRightPanelOpen ? 'text-blue-400' : 'text-zinc-500 hover:text-zinc-300'
                }`}
                title="Toggle right panel (Cmd+R)"
              >
                <PanelRight size={16} />
              </button>
              <div className="flex-1" />
            </>
          )}
        </div>
      )}
    </div>
  );
}

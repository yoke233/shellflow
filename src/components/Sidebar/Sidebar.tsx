import { FolderGit2, Plus, ChevronRight, ChevronDown, GitBranch, MoreHorizontal, Trash2, Loader2, Terminal, GitMerge, X, PanelRight, BellDot, Settings, Circle } from 'lucide-react';
import { Project, Worktree, RunningTask } from '../../types';
import { TaskConfig } from '../../hooks/useConfig';
import { useState, useMemo } from 'react';
import { DragRegion } from '../DragRegion';
import { ContextMenu } from '../ContextMenu';
import { TaskSelector } from './TaskSelector';

interface SidebarProps {
  projects: Project[];
  activeProjectId: string | null;
  activeWorktreeId: string | null;
  openProjectIds: Set<string>;
  openWorktreeIds: Set<string>;
  openWorktreesInOrder: string[];
  isModifierKeyHeld: boolean;
  loadingWorktrees: Set<string>;
  notifiedWorktreeIds: Set<string>;
  thinkingWorktreeIds: Set<string>;
  runningTaskCounts: Map<string, number>;
  expandedProjects: Set<string>;
  showActiveOnly: boolean;
  sessionTouchedProjects: Set<string>;
  isDrawerOpen: boolean;
  isRightPanelOpen: boolean;
  tasks: TaskConfig[];
  selectedTask: string | null;
  runningTask: RunningTask | null;
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
  onMarkProjectInactive: (projectId: string) => void;
  onToggleShowActiveOnly: () => void;
  onSelectTask: (taskName: string) => void;
  onStartTask: () => void;
  onStopTask: () => void;
  onForceKillTask: () => void;
}

export function Sidebar({
  projects,
  activeProjectId,
  activeWorktreeId,
  openProjectIds,
  openWorktreeIds,
  openWorktreesInOrder,
  isModifierKeyHeld,
  loadingWorktrees,
  notifiedWorktreeIds,
  thinkingWorktreeIds,
  runningTaskCounts,
  expandedProjects,
  showActiveOnly,
  sessionTouchedProjects,
  isDrawerOpen,
  isRightPanelOpen,
  tasks,
  selectedTask,
  runningTask,
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
  onMarkProjectInactive,
  onToggleShowActiveOnly,
  onSelectTask,
  onStartTask,
  onStopTask,
  onForceKillTask,
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

  const handleMarkInactive = () => {
    if (contextMenu) {
      onMarkProjectInactive(contextMenu.project.id);
      setContextMenu(null);
    }
  };

  // Filter projects based on showActiveOnly setting
  // A project is "active" if it has open worktrees OR was touched this session
  const filteredProjects = useMemo(() => {
    if (!showActiveOnly) return projects;
    return projects.filter((project) => {
      const hasOpenWorktrees = project.worktrees.some((w) => openWorktreeIds.has(w.id));
      const wasTouchedThisSession = sessionTouchedProjects.has(project.id);
      return hasOpenWorktrees || wasTouchedThisSession;
    });
  }, [projects, showActiveOnly, openWorktreeIds, sessionTouchedProjects]);

  return (
    <div className="flex flex-col h-full bg-zinc-900 select-none">
      {/* Drag region for macOS traffic lights */}
      <DragRegion className="h-8 flex-shrink-0 flex items-center justify-end px-1">
        <button
          onClick={handleOptionsClick}
          className="p-1 rounded hover:bg-zinc-800 text-zinc-500 hover:text-zinc-300"
          title="Options"
        >
          <Settings size={14} />
        </button>
      </DragRegion>
      <div className="flex-1 overflow-y-auto px-1.5 py-2">
        {projects.length === 0 ? (
          <div className="text-center py-8 text-zinc-400 text-sm">
            <FolderGit2 className="mx-auto mb-2" size={32} />
            <p>No projects yet</p>
            <button
              onClick={onAddProject}
              className="mt-2 text-blue-400 hover:text-blue-300"
            >
              Add a project
            </button>
          </div>
        ) : filteredProjects.length === 0 ? (
          <div className="text-center py-8 text-zinc-400 text-sm">
            <FolderGit2 className="mx-auto mb-2" size={32} />
            <p>No active projects</p>
          </div>
        ) : (
          <>
          {filteredProjects.map((project) => {
            const hasOpenWorktrees = project.worktrees.some((w) => openWorktreeIds.has(w.id));
            const isProjectOpen = openProjectIds.has(project.id);
            const isProjectSelected = activeProjectId === project.id && !activeWorktreeId;
            return (
            <div key={project.id} className="mb-2">
              <div
                className={`group relative flex items-center gap-1.5 px-2 py-1 rounded ${
                  isProjectSelected
                    ? 'bg-zinc-700 text-zinc-100'
                    : hasOpenWorktrees || isProjectOpen
                      ? 'text-zinc-200 hover:bg-zinc-800'
                      : 'text-zinc-400 hover:bg-zinc-800'
                }`}
                onClick={() => onSelectProject(project)}
                onContextMenu={(e) => handleProjectContextMenu(e, project)}
              >
                {/* Chevron for expand/collapse - separate click handler */}
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onToggleProject(project.id);
                  }}
                  className="p-0.5 -m-0.5 rounded hover:bg-zinc-600"
                >
                  {expandedProjects.has(project.id) ? (
                    <ChevronDown size={14} className={hasOpenWorktrees || isProjectOpen ? 'text-zinc-400' : 'text-zinc-500'} />
                  ) : (
                    <ChevronRight size={14} className={hasOpenWorktrees || isProjectOpen ? 'text-zinc-400' : 'text-zinc-500'} />
                  )}
                </button>
                <FolderGit2 size={14} className="flex-shrink-0" style={{ color: hasOpenWorktrees || isProjectOpen ? '#a1a1aa' : '#71717a' }} />
                <span className="text-sm font-medium truncate">{project.name}</span>
                <div className={`absolute right-1 hidden group-hover:flex items-center gap-0.5 rounded ${isProjectSelected ? 'bg-zinc-700' : 'bg-zinc-800'}`}>
                  {isProjectOpen && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        onCloseProject(project.id);
                      }}
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
                    className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
                    title="Add Worktree"
                  >
                    <Plus size={14} />
                  </button>
                  <button
                    onClick={(e) => handleKebabClick(e, project)}
                    className="p-0.5 rounded hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200"
                    title="More options"
                  >
                    <MoreHorizontal size={14} />
                  </button>
                </div>
              </div>

              {expandedProjects.has(project.id) && (
                <div className="ml-4 mt-1 space-y-0.5 border-l border-zinc-800 pl-2">
                  {project.worktrees.length === 0 ? (
                    <button
                      onClick={() => onAddWorktree(project.id)}
                      className="flex items-center gap-1.5 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      <Plus size={12} />
                      Add worktree
                    </button>
                  ) : (
                    project.worktrees.map((worktree) => {
                      const isLoading = loadingWorktrees.has(worktree.id);
                      const isThinking = thinkingWorktreeIds.has(worktree.id);
                      const isOpen = openWorktreeIds.has(worktree.id);
                      const isSelected = activeWorktreeId === worktree.id;
                      // Get shortcut number (1-9) for open worktrees
                      const shortcutIndex = isOpen ? openWorktreesInOrder.indexOf(worktree.id) : -1;
                      const shortcutNumber = shortcutIndex >= 0 && shortcutIndex < 9 ? shortcutIndex + 1 : null;
                      return (
                        <div
                          key={worktree.id}
                          onClick={() => onSelectWorktree(worktree)}
                          className={`group/worktree relative flex items-center gap-1.5 px-2 py-1 rounded text-sm ${
                            isSelected
                              ? 'bg-zinc-700 text-zinc-100'
                              : isOpen
                                ? 'text-zinc-300 hover:bg-zinc-800 hover:text-zinc-100'
                                : 'text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300'
                          }`}
                        >
                          {/* Shortcut number indicator - shown when modifier key is held */}
                          {isModifierKeyHeld && shortcutNumber !== null ? (
                            <span className="flex-shrink-0 w-3 text-xs text-zinc-400 text-center font-medium">{shortcutNumber}</span>
                          ) : (
                            <GitBranch size={12} className={`flex-shrink-0 ${isOpen ? 'text-zinc-400' : 'text-zinc-600'}`} />
                          )}
                          {/* Task running indicator - always visible when tasks are running */}
                          {runningTaskCounts.has(worktree.id) && (
                            <span title={`${runningTaskCounts.get(worktree.id)} task${runningTaskCounts.get(worktree.id)! > 1 ? 's' : ''} running`} className="flex-shrink-0 relative">
                              <Circle size={6} className="fill-emerald-400 text-emerald-400" />
                              {runningTaskCounts.get(worktree.id)! > 1 && (
                                <span className="absolute -top-1.5 left-1 text-[8px] font-medium text-zinc-400">
                                  {runningTaskCounts.get(worktree.id)}
                                </span>
                              )}
                            </span>
                          )}
                          <span className="truncate">{worktree.name}</span>
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
                                    className="p-0.5 rounded hover:bg-zinc-600 text-zinc-500 hover:text-zinc-300"
                                    title="Close Worktree"
                                  >
                                    <X size={12} />
                                  </button>
                                )}
                              </div>
                              {/* Status indicators - hide on hover */}
                              {isThinking && !isSelected && (
                                <span className="absolute right-1 group-hover/worktree:hidden" title="Thinking...">
                                  <Loader2 size={12} className="animate-spin text-violet-400" />
                                </span>
                              )}
                              {notifiedWorktreeIds.has(worktree.id) && !isSelected && !isThinking && (
                                <span className="absolute right-1 group-hover/worktree:hidden" title="New notification">
                                  <BellDot size={12} className="text-blue-400" />
                                </span>
                              )}
                            </>
                          )}
                        </div>
                      );
                    })
                  )}
                </div>
              )}
            </div>
          )})}
          <button
            onClick={onAddProject}
            className="flex items-center gap-1.5 px-2 py-1.5 mt-2 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <Plus size={12} />
            Add project
          </button>
          </>
        )}
      </div>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            // Only show "Mark as inactive" if:
            // - Project is in session touched set
            // - Project has no open worktrees (so it would hide when we mark it inactive)
            ...(sessionTouchedProjects.has(contextMenu.project.id) &&
              !contextMenu.project.worktrees.some((w) => openWorktreeIds.has(w.id))
              ? [{
                  label: 'Mark as Inactive',
                  onClick: handleMarkInactive,
                }]
              : []),
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
              label: 'Show Active Only',
              onClick: onToggleShowActiveOnly,
              toggle: true,
              checked: showActiveOnly,
            },
          ]}
          onClose={() => setOptionsMenu(null)}
        />
      )}

      {/* Task selector - above status bar */}
      {activeWorktreeId && tasks.length > 0 && (
        <TaskSelector
          tasks={tasks}
          selectedTask={selectedTask}
          runningTask={runningTask}
          onSelectTask={onSelectTask}
          onStartTask={onStartTask}
          onStopTask={onStopTask}
          onForceKillTask={onForceKillTask}
        />
      )}

      {/* Status bar - shows different actions for project vs worktree */}
      {(activeWorktreeId || activeProjectId) && (
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
          ) : (
            <>
              {/* Project-specific actions - just right panel toggle */}
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

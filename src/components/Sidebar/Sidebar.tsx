import { FolderGit2, Plus, ChevronRight, ChevronDown, GitBranch } from 'lucide-react';
import { Project, Workspace } from '../../types';
import { useState } from 'react';

interface SidebarProps {
  projects: Project[];
  selectedWorkspaceId: string | null;
  onSelectWorkspace: (workspace: Workspace) => void;
  onAddProject: () => void;
  onAddWorkspace: (projectId: string) => void;
}

export function Sidebar({
  projects,
  selectedWorkspaceId,
  onSelectWorkspace,
  onAddProject,
  onAddWorkspace,
}: SidebarProps) {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(
    new Set(projects.map((p) => p.id))
  );

  const toggleProject = (projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  };

  return (
    <div className="flex flex-col h-full bg-zinc-900 border-r border-zinc-800">
      <div className="flex items-center justify-between p-3 border-b border-zinc-800">
        <h1 className="text-sm font-semibold text-zinc-300">One Man Band</h1>
      </div>

      <div className="flex-1 overflow-y-auto p-2">
        {projects.length === 0 ? (
          <div className="text-center py-8 text-zinc-500 text-sm">
            <FolderGit2 className="mx-auto mb-2" size={32} />
            <p>No projects yet</p>
            <button
              onClick={onAddProject}
              className="mt-2 text-blue-400 hover:text-blue-300"
            >
              Add a project
            </button>
          </div>
        ) : (
          <>
          {projects.map((project) => (
            <div key={project.id} className="mb-2">
              <div
                className="group flex items-center gap-1 px-2 py-1.5 rounded cursor-pointer hover:bg-zinc-800 text-zinc-300"
                onClick={() => toggleProject(project.id)}
              >
                {expandedProjects.has(project.id) ? (
                  <ChevronDown size={14} className="text-zinc-500" />
                ) : (
                  <ChevronRight size={14} className="text-zinc-500" />
                )}
                <FolderGit2 size={14} className="text-zinc-400" />
                <span className="text-sm truncate flex-1">{project.name}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onAddWorkspace(project.id);
                  }}
                  className="p-0.5 rounded hover:bg-zinc-700 text-zinc-500 hover:text-zinc-300 opacity-0 group-hover:opacity-100"
                  title="Add Workspace"
                >
                  <Plus size={14} />
                </button>
              </div>

              {expandedProjects.has(project.id) && (
                <div className="ml-4 mt-1 space-y-0.5">
                  {project.workspaces.length === 0 ? (
                    <button
                      onClick={() => onAddWorkspace(project.id)}
                      className="flex items-center gap-2 px-2 py-1 text-xs text-zinc-500 hover:text-zinc-300"
                    >
                      <Plus size={12} />
                      Add workspace
                    </button>
                  ) : (
                    project.workspaces.map((workspace) => (
                      <div
                        key={workspace.id}
                        onClick={() => onSelectWorkspace(workspace)}
                        className={`flex items-center gap-2 px-2 py-1.5 rounded cursor-pointer text-sm ${
                          selectedWorkspaceId === workspace.id
                            ? 'bg-zinc-700 text-zinc-100'
                            : 'text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                        }`}
                      >
                        <GitBranch size={12} />
                        <span className="truncate">{workspace.name}</span>
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>
          ))}
          <button
            onClick={onAddProject}
            className="flex items-center gap-2 px-2 py-1.5 mt-2 text-xs text-zinc-500 hover:text-zinc-300"
          >
            <Plus size={12} />
            Add project
          </button>
          </>
        )}
      </div>
    </div>
  );
}

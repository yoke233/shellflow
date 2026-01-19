import { X, Terminal, Trash2 } from 'lucide-react';
import { Workspace } from '../../types';
import { ClaudeTab } from './ClaudeTab';

interface ClaudePaneProps {
  openWorkspaces: Workspace[];
  activeWorkspaceId: string | null;
  onSelectTab: (workspaceId: string) => void;
  onCloseTab: (workspaceId: string) => void;
  onDeleteWorkspace: (workspaceId: string) => void;
}

export function ClaudePane({
  openWorkspaces,
  activeWorkspaceId,
  onSelectTab,
  onCloseTab,
  onDeleteWorkspace,
}: ClaudePaneProps) {
  if (openWorkspaces.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full bg-zinc-950 text-zinc-500">
        <Terminal size={48} className="mb-4 opacity-50" />
        <p className="text-lg">No workspaces open</p>
        <p className="text-sm mt-1">Select a workspace from the sidebar to start</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full bg-zinc-950">
      {/* Tab bar */}
      <div className="flex items-center bg-zinc-900 border-b border-zinc-800">
        <div className="flex items-center overflow-x-auto flex-1">
          {openWorkspaces.map((workspace) => (
            <div
              key={workspace.id}
              onClick={() => onSelectTab(workspace.id)}
              className={`flex items-center gap-2 px-3 py-2 cursor-pointer border-r border-zinc-800 min-w-0 ${
                activeWorkspaceId === workspace.id
                  ? 'bg-zinc-950 text-zinc-100'
                  : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
              }`}
            >
              <Terminal size={14} className="flex-shrink-0" />
              <span className="text-sm truncate max-w-[120px]">{workspace.name}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  onCloseTab(workspace.id);
                }}
                className="p-0.5 rounded hover:bg-zinc-700 flex-shrink-0"
              >
                <X size={12} />
              </button>
            </div>
          ))}
        </div>
        {activeWorkspaceId && (
          <button
            onClick={() => onDeleteWorkspace(activeWorkspaceId)}
            className="p-2 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 flex-shrink-0"
            title="Delete workspace"
          >
            <Trash2 size={16} />
          </button>
        )}
      </div>

      {/* Terminal content */}
      <div className="flex-1 relative">
        {openWorkspaces.map((workspace) => (
          <div
            key={workspace.id}
            className={`absolute inset-0 ${
              workspace.id === activeWorkspaceId ? 'block' : 'hidden'
            }`}
          >
            <ClaudeTab workspace={workspace} isActive={workspace.id === activeWorkspaceId} />
          </div>
        ))}
      </div>
    </div>
  );
}

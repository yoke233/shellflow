import { X, Plus, Terminal, Play, Square } from 'lucide-react';
import { ReactNode } from 'react';

export interface DrawerTab {
  id: string;
  label: string;
  type: 'terminal' | 'task';
  taskName?: string;
}

type TaskStatus = 'running' | 'stopping' | 'stopped';

interface DrawerProps {
  isOpen: boolean;
  worktreeId: string | null;
  tabs: DrawerTab[];
  activeTabId: string | null;
  taskStatus?: TaskStatus;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: () => void;
  children?: ReactNode;
}

export function Drawer({
  isOpen,
  worktreeId,
  tabs,
  activeTabId,
  taskStatus,
  onSelectTab,
  onCloseTab,
  onAddTab,
  children,
}: DrawerProps) {
  // Always render children to keep terminals alive, but hide UI when closed
  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {/* Tab bar - only show when open */}
      {isOpen && worktreeId && (
        <div className="flex items-stretch h-8 bg-zinc-900 border-b border-zinc-800 select-none flex-shrink-0">
          <div className="flex items-stretch overflow-x-auto flex-1">
            {tabs.map((tab) => (
              <div
                key={tab.id}
                onClick={() => onSelectTab(tab.id)}
                className={`flex items-center gap-2 px-3 border-r border-zinc-800 min-w-0 ${
                  activeTabId === tab.id
                    ? 'bg-zinc-800 text-zinc-100'
                    : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
                }`}
              >
                {tab.type === 'task' ? (
                  taskStatus === 'stopped' ? (
                    <Square size={14} className="flex-shrink-0 text-zinc-500" />
                  ) : (
                    <Play size={14} className="flex-shrink-0 text-green-500" />
                  )
                ) : (
                  <Terminal size={14} className="flex-shrink-0" />
                )}
                <span className="text-sm truncate max-w-[120px]">{tab.label}</span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCloseTab(tab.id);
                  }}
                  className="p-0.5 rounded hover:bg-zinc-700 flex-shrink-0"
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
          <button
            onClick={onAddTab}
            className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 flex-shrink-0"
            title="New terminal (Cmd+T)"
          >
            <Plus size={16} />
          </button>
        </div>
      )}

      {/* Terminal content - always rendered to keep terminals alive */}
      <div className="flex-1 relative">
        {children}
      </div>
    </div>
  );
}

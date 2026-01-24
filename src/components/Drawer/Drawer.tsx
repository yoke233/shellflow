import { Plus, Maximize2, Minimize2, Terminal, Play, Square, Check, X } from 'lucide-react';
import { ReactNode, useState, useRef } from 'react';
import {
  DndContext,
  closestCenter,
  PointerSensor,
  useSensor,
  useSensors,
  DragEndEvent,
  DragStartEvent,
  DragOverlay,
} from '@dnd-kit/core';
import {
  SortableContext,
  horizontalListSortingStrategy,
} from '@dnd-kit/sortable';
import { SortableDrawerTab } from './SortableDrawerTab';
import { MergeOptions } from '../MergeModal';
import { MergeStrategy } from '../../lib/tauri';

export interface DrawerTab {
  id: string;
  label: string;
  type: 'terminal' | 'task' | 'action';
  taskName?: string;
  /** For action tabs: the action type (e.g., 'merge_worktree_with_conflicts') */
  actionType?: string;
  /** For action tabs: the expanded prompt to send when ready */
  actionPrompt?: string;
  /** For merge action tabs: the cleanup options selected by the user */
  mergeOptions?: MergeOptions;
  /** For merge/rebase action tabs: the strategy being used */
  strategy?: MergeStrategy;
}

interface TaskStatusInfo {
  status: 'running' | 'stopping' | 'stopped';
  exitCode?: number;
}

interface DrawerProps {
  isOpen: boolean;
  isExpanded: boolean;
  worktreeId: string | null;
  tabs: DrawerTab[];
  activeTabId: string | null;
  taskStatuses: Map<string, TaskStatusInfo>;
  isCtrlKeyHeld?: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: () => void;
  onToggleExpand: () => void;
  onReorderTabs: (oldIndex: number, newIndex: number) => void;
  children?: ReactNode;
}

export function Drawer({
  isOpen,
  isExpanded,
  worktreeId,
  tabs,
  activeTabId,
  taskStatuses,
  isCtrlKeyHeld = false,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onToggleExpand,
  onReorderTabs,
  children,
}: DrawerProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const [activeDragTab, setActiveDragTab] = useState<DrawerTab | null>(null);
  const recentlyDraggedRef = useRef(false);
  const isDraggingRef = useRef(false);

  function handleDragStart(event: DragStartEvent) {
    // Prevent phantom drag starts (StrictMode can cause double-mounts)
    if (isDraggingRef.current) return;
    isDraggingRef.current = true;

    const tab = tabs.find((t) => t.id === event.active.id);
    setActiveDragTab(tab ?? null);
    recentlyDraggedRef.current = true;
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;

    // Only process if we were tracking this drag (not a phantom drag)
    if (!isDraggingRef.current) return;
    isDraggingRef.current = false;

    setActiveDragTab(null);

    if (over && active.id !== over.id) {
      const oldIndex = tabs.findIndex((t) => t.id === active.id);
      const newIndex = tabs.findIndex((t) => t.id === over.id);
      if (oldIndex !== -1 && newIndex !== -1 && oldIndex !== newIndex) {
        onReorderTabs(oldIndex, newIndex);
      }
    }

    setTimeout(() => {
      recentlyDraggedRef.current = false;
    }, 100);
  }

  function handleDragCancel() {
    isDraggingRef.current = false;
    setActiveDragTab(null);
    setTimeout(() => {
      recentlyDraggedRef.current = false;
    }, 100);
  }

  function handleCloseTab(tabId: string) {
    // Ignore close if we just finished dragging
    if (recentlyDraggedRef.current) {
      return;
    }
    onCloseTab(tabId);
  }

  function renderTaskIcon(statusInfo: TaskStatusInfo | undefined) {
    if (!statusInfo) {
      return <Square size={14} className="flex-shrink-0 text-zinc-500" />;
    }
    if (statusInfo.status === 'stopped') {
      const code = statusInfo.exitCode;
      if (code === 0) {
        return <Check size={14} className="flex-shrink-0 text-green-500/50" />;
      }
      if (code !== undefined && code >= 128) {
        return <Square size={14} className="flex-shrink-0 text-zinc-500" />;
      }
      return <X size={14} className="flex-shrink-0 text-red-400/50" />;
    }
    return <Play size={14} className="flex-shrink-0 text-green-500" />;
  }

  return (
    <div className="flex flex-col h-full bg-zinc-900">
      {isOpen && worktreeId && (
        <div className="flex items-stretch h-8 bg-zinc-900 border-b border-zinc-800 select-none flex-shrink-0">
          <DndContext
            sensors={sensors}
            collisionDetection={closestCenter}
            onDragStart={handleDragStart}
            onDragEnd={handleDragEnd}
            onDragCancel={handleDragCancel}
          >
            <SortableContext
              items={tabs.map((t) => t.id)}
              strategy={horizontalListSortingStrategy}
            >
              <div className="flex items-stretch overflow-x-auto flex-1">
                {tabs.map((tab, index) => (
                  <SortableDrawerTab
                    key={tab.id}
                    tab={tab}
                    isActive={activeTabId === tab.id}
                    taskStatus={taskStatuses.get(tab.taskName ?? '')}
                    isAnyDragging={activeDragTab !== null}
                    shortcutNumber={index < 9 ? index + 1 : null}
                    isCtrlKeyHeld={isCtrlKeyHeld}
                    onSelect={() => onSelectTab(tab.id)}
                    onClose={() => handleCloseTab(tab.id)}
                  />
                ))}
              </div>
            </SortableContext>
            <DragOverlay dropAnimation={null}>
              {activeDragTab && (
                <div className="flex items-center gap-2 px-3 h-8 bg-zinc-700 text-zinc-100 border border-zinc-600 rounded shadow-lg">
                  {activeDragTab.type === 'task' ? (
                    renderTaskIcon(taskStatuses.get(activeDragTab.taskName ?? ''))
                  ) : (
                    <Terminal size={14} className="flex-shrink-0" />
                  )}
                  <span className="text-sm truncate max-w-[120px]">{activeDragTab.label}</span>
                </div>
              )}
            </DragOverlay>
          </DndContext>
          <div className="flex items-stretch border-l border-zinc-800 flex-shrink-0">
            <button
              onClick={onAddTab}
              className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              title="New terminal (Cmd+T)"
            >
              <Plus size={16} />
            </button>
            <button
              onClick={onToggleExpand}
              className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
              title={isExpanded ? "Restore drawer (Shift+Esc)" : "Expand drawer (Shift+Esc)"}
            >
              {isExpanded ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 relative">
        {children}
      </div>
    </div>
  );
}

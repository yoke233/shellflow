import { Plus, Terminal, Code, FileDiff } from 'lucide-react';
import { useState, useRef } from 'react';
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
import { SortableSessionTab } from './SortableSessionTab';
import { SessionTab, TabIndicators } from '../../types';

interface SessionTabBarProps {
  tabs: SessionTab[];
  activeTabId: string | null;
  tabIndicators?: Map<string, TabIndicators>;
  isCtrlKeyHeld?: boolean;
  onSelectTab: (tabId: string) => void;
  onCloseTab: (tabId: string) => void;
  onAddTab: () => void;
  onReorderTabs: (oldIndex: number, newIndex: number) => void;
  onRenameTab: (tabId: string, label: string) => void;
}

export function SessionTabBar({
  tabs,
  activeTabId,
  tabIndicators,
  isCtrlKeyHeld = false,
  onSelectTab,
  onCloseTab,
  onAddTab,
  onReorderTabs,
  onRenameTab,
}: SessionTabBarProps) {
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 8,
      },
    })
  );

  const [activeDragTab, setActiveDragTab] = useState<SessionTab | null>(null);
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

  // Only show tab bar when there is at least one tab
  if (tabs.length === 0) {
    return null;
  }

  const getTabLabel = (tab: SessionTab) => tab.customLabel ?? tab.label;

  return (
    <div className="flex items-stretch h-8 bg-theme-1 border-b border-theme-0 select-none flex-shrink-0">
      <div className="flex items-stretch border-r border-theme-0 flex-shrink-0">
        <button
          onClick={onAddTab}
          className="p-2 text-theme-3 hover:text-theme-1 hover:bg-theme-2"
          title="New tab (Cmd+T)"
        >
          <Plus size={16} />
        </button>
      </div>
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
            {tabs.map((tab, index) => {
              const indicators = tabIndicators?.get(tab.id);
              return (
                <SortableSessionTab
                  key={tab.id}
                  tab={tab}
                  isActive={activeTabId === tab.id}
                  isThinking={indicators?.thinking ?? false}
                  isNotified={indicators?.notified ?? false}
                  isIdle={indicators?.idle ?? false}
                  isAnyDragging={activeDragTab !== null}
                  shortcutNumber={index < 9 ? index + 1 : null}
                  isCtrlKeyHeld={isCtrlKeyHeld}
                  onSelect={() => onSelectTab(tab.id)}
                  onClose={() => handleCloseTab(tab.id)}
                  onRename={(label) => onRenameTab(tab.id, label)}
                />
              );
            })}
          </div>
        </SortableContext>
        <DragOverlay dropAnimation={null}>
          {activeDragTab && (
            <div className="flex items-center gap-2 px-3 h-8 bg-theme-3 text-theme-0 border border-theme-1 rounded shadow-lg">
              {activeDragTab.diff ? (
                <FileDiff size={14} className="flex-shrink-0" />
              ) : activeDragTab.command ? (
                <Code size={14} className="flex-shrink-0" />
              ) : (
                <Terminal size={14} className="flex-shrink-0" />
              )}
              <span className="text-sm truncate max-w-[120px]">{getTabLabel(activeDragTab)}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </div>
  );
}

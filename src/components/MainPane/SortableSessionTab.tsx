import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, Terminal, Loader2, BellDot, Check } from 'lucide-react';
import { SessionTab } from '../../types';

interface SortableSessionTabProps {
  tab: SessionTab;
  isActive: boolean;
  isThinking?: boolean;
  isNotified?: boolean;
  isIdle?: boolean;
  isAnyDragging: boolean;
  shortcutNumber: number | null;
  isCtrlKeyHeld: boolean;
  onSelect: () => void;
  onClose: () => void;
}

export function SortableSessionTab({
  tab,
  isActive,
  isThinking = false,
  isNotified = false,
  isIdle = false,
  isAnyDragging,
  shortcutNumber,
  isCtrlKeyHeld,
  onSelect,
  onClose,
}: SortableSessionTabProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id });

  // Don't apply transform to the dragged item - it's hidden and the overlay shows instead.
  // Only apply transform to OTHER items that need to move out of the way.
  const style = isDragging
    ? undefined
    : {
        transform: CSS.Transform.toString(transform),
        transition,
      };

  return (
    <div
      ref={setNodeRef}
      style={style}
      {...attributes}
      {...listeners}
      onClick={onSelect}
      className={`flex items-center gap-2 px-3 border-r border-zinc-800 min-w-0 active:cursor-grabbing ${
        isActive
          ? 'bg-zinc-800 text-zinc-100'
          : 'bg-zinc-900 text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200'
      } ${isDragging ? 'opacity-0' : ''}`}
    >
      {isCtrlKeyHeld && shortcutNumber !== null ? (
        <span className="text-xs font-medium text-zinc-400 w-3.5 text-center flex-shrink-0">{shortcutNumber}</span>
      ) : isNotified && !isActive ? (
        <BellDot size={14} className="flex-shrink-0 text-blue-400" />
      ) : isThinking ? (
        <Loader2 size={14} className="flex-shrink-0 animate-spin text-violet-400" />
      ) : isIdle && !isActive ? (
        <Check size={14} className="flex-shrink-0 text-emerald-400" />
      ) : (
        <Terminal size={14} className="flex-shrink-0" />
      )}
      <span className="text-sm truncate max-w-[120px]">{tab.label}</span>
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (!isAnyDragging) onClose();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className={`p-0.5 rounded hover:bg-zinc-700 flex-shrink-0 ${isAnyDragging ? 'pointer-events-none' : ''}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}

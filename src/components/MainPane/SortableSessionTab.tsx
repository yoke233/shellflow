import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { X, Terminal, Loader2, BellDot, Check, Code, FileDiff } from 'lucide-react';
import { useEffect, useState } from 'react';
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
  onRename: (label: string) => void;
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
  onRename,
}: SortableSessionTabProps) {
  const displayLabel = tab.customLabel ?? tab.label;
  const [isEditing, setIsEditing] = useState(false);
  const [draftLabel, setDraftLabel] = useState(displayLabel);

  useEffect(() => {
    if (!isEditing) {
      setDraftLabel(displayLabel);
    }
  }, [displayLabel, isEditing]);

  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: tab.id, disabled: isEditing });

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
      className={`flex items-center gap-2 px-3 border-r border-theme-0 min-w-0 active:cursor-grabbing ${
        isActive
          ? 'bg-theme-2 text-theme-0'
          : 'bg-theme-1 text-theme-2 hover:bg-theme-2 hover:text-theme-1'
      } ${isDragging ? 'opacity-0' : ''}`}
    >
      {isCtrlKeyHeld && shortcutNumber !== null ? (
        <span className="text-xs font-medium text-theme-2 w-3.5 text-center flex-shrink-0">{shortcutNumber}</span>
      ) : isNotified && !isActive ? (
        <BellDot size={14} className="flex-shrink-0 text-blue-400" />
      ) : isThinking ? (
        <Loader2 size={14} className="flex-shrink-0 animate-spin text-violet-400" />
      ) : isIdle && !isActive ? (
        <Check size={14} className="flex-shrink-0 text-emerald-400" />
      ) : tab.diff ? (
        <FileDiff size={14} className="flex-shrink-0" />
      ) : tab.command ? (
        <Code size={14} className="flex-shrink-0" />
      ) : (
        <Terminal size={14} className="flex-shrink-0" />
      )}
      {isEditing ? (
        <input
          value={draftLabel}
          onChange={(e) => setDraftLabel(e.target.value)}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          onDoubleClick={(e) => e.stopPropagation()}
          onBlur={() => {
            setIsEditing(false);
            onRename(draftLabel.trim());
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              setIsEditing(false);
              onRename(draftLabel.trim());
            }
            if (e.key === 'Escape') {
              e.preventDefault();
              setIsEditing(false);
              setDraftLabel(displayLabel);
            }
          }}
          autoFocus
          className="text-sm max-w-[140px] bg-transparent border border-theme-0 rounded px-1 py-0.5 outline-none focus:border-theme-2"
          aria-label="Rename tab"
        />
      ) : (
        <span
          className="text-sm truncate max-w-[140px]"
          title="Double click to rename"
          onDoubleClick={(e) => {
            if (isAnyDragging) return;
            e.stopPropagation();
            setIsEditing(true);
          }}
        >
          {displayLabel}
        </span>
      )}
      <button
        onClick={(e) => {
          e.stopPropagation();
          e.preventDefault();
          if (!isAnyDragging) onClose();
        }}
        onPointerDown={(e) => e.stopPropagation()}
        onPointerUp={(e) => e.stopPropagation()}
        onMouseDown={(e) => e.stopPropagation()}
        className={`p-0.5 rounded hover:bg-theme-3 flex-shrink-0 ${isAnyDragging ? 'pointer-events-none' : ''}`}
      >
        <X size={12} />
      </button>
    </div>
  );
}

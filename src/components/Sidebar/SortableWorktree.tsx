import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ReactNode } from 'react';

interface SortableWorktreeProps {
  worktreeId: string;
  projectId: string;
  children: ReactNode;
}

export function SortableWorktree({ worktreeId, projectId, children }: SortableWorktreeProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({
    id: worktreeId,
    data: { type: 'worktree', projectId },
  });

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
      className={isDragging ? 'opacity-0' : ''}
    >
      {children}
    </div>
  );
}

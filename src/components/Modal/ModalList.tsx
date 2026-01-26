import { ReactNode, forwardRef, useEffect, useRef } from 'react';

interface ModalListProps {
  children: ReactNode;
  emptyMessage?: string;
  isEmpty?: boolean;
}

export const ModalList = forwardRef<HTMLDivElement, ModalListProps>(function ModalList(
  { children, emptyMessage = 'No results found', isEmpty = false },
  ref
) {
  return (
    <div
      ref={ref}
      className="max-h-80 overflow-y-auto py-1 scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent hover:scrollbar-thumb-zinc-600"
      style={{
        scrollbarWidth: 'thin',
        scrollbarColor: 'transparent transparent',
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.scrollbarColor = 'rgb(63 63 70) transparent';
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.scrollbarColor = 'transparent transparent';
      }}
    >
      {isEmpty ? (
        <div className="px-3 py-6 text-sm text-center" style={{ color: 'var(--modal-item-text-muted)' }}>
          {emptyMessage}
        </div>
      ) : (
        children
      )}
    </div>
  );
});

interface ModalListItemProps {
  isHighlighted?: boolean;
  onClick?: () => void;
  onMouseEnter?: () => void;
  children: ReactNode;
  rightContent?: ReactNode;
}

export function ModalListItem({
  isHighlighted = false,
  onClick,
  onMouseEnter,
  children,
  rightContent,
}: ModalListItemProps) {
  const itemRef = useRef<HTMLButtonElement>(null);

  // Scroll into view when highlighted
  useEffect(() => {
    if (isHighlighted && itemRef.current) {
      itemRef.current.scrollIntoView({ block: 'nearest' });
    }
  }, [isHighlighted]);

  return (
    <button
      ref={itemRef}
      onClick={onClick}
      onMouseEnter={onMouseEnter}
      className="w-full px-2.5 py-1.5 mx-1 text-left flex items-center gap-2 rounded transition-colors"
      style={{
        width: 'calc(100% - 8px)',
        background: isHighlighted ? 'var(--modal-item-highlight)' : 'transparent',
        color: 'var(--modal-item-text)',
      }}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {rightContent && <div className="flex-shrink-0">{rightContent}</div>}
    </button>
  );
}

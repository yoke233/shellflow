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
      className="max-h-80 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent hover:scrollbar-thumb-zinc-600"
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
        <div className="px-3 py-4 text-sm text-zinc-500 text-center">{emptyMessage}</div>
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
      className={`w-full px-3 py-2 text-left flex items-center gap-2 ${
        isHighlighted ? 'bg-zinc-800' : ''
      }`}
    >
      <div className="flex-1 min-w-0">{children}</div>
      {rightContent && <div className="flex-shrink-0">{rightContent}</div>}
    </button>
  );
}

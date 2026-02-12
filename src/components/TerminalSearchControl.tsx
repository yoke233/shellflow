import { useEffect, useMemo, useRef } from 'react';

interface TerminalSearchControlProps {
  isOpen: boolean;
  query: string;
  hasMatch: boolean;
  currentMatchIndex: number;
  totalMatches: number;
  onOpen: () => void;
  onClose: () => void;
  onQueryChange: (query: string) => void;
  onNext: () => void;
  onPrevious: () => void;
}

export function TerminalSearchControl({
  isOpen,
  query,
  hasMatch,
  currentMatchIndex,
  totalMatches,
  onOpen,
  onClose,
  onQueryChange,
  onNext,
  onPrevious,
}: TerminalSearchControlProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const shortcutLabel = useMemo(() => {
    if (typeof navigator === 'undefined') {
      return 'Ctrl+F';
    }

    const isMacLike = /Mac|iPhone|iPad|iPod/i.test(navigator.platform);
    return isMacLike ? '⌘F' : 'Ctrl+F';
  }, []);

  const canNavigate = totalMatches > 0;
  const countLabel = totalMatches > 0 ? `${currentMatchIndex}/${totalMatches}` : '0/0';

  useEffect(() => {
    if (!isOpen) {
      return;
    }

    requestAnimationFrame(() => {
      if (inputRef.current) {
        inputRef.current.focus();
        inputRef.current.select();
      }
    });
  }, [isOpen]);

  if (!isOpen) {
    return (
      <button
        type="button"
        className="absolute top-2 right-2 z-[70] rounded border border-theme-1 bg-theme-2/90 px-2 py-1 text-[11px] text-theme-1 hover:bg-theme-3 pointer-events-auto"
        title={`Search (${shortcutLabel})`}
        onClick={onOpen}
      >
        Search
      </button>
    );
  }

  return (
    <div
      data-terminal-search-control="true"
      className="absolute top-2 right-2 z-[70] flex items-center gap-1 rounded border border-theme-1 bg-theme-2/95 px-2 py-1 text-xs text-theme-1 shadow-lg pointer-events-auto"
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
    >
      <input
        ref={inputRef}
        type="text"
        value={query}
        onFocusCapture={(event) => event.stopPropagation()}
        onChange={(event) => onQueryChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter') {
            event.preventDefault();
            if (event.shiftKey) {
              onPrevious();
            } else {
              onNext();
            }
            return;
          }

          if (event.key === 'Escape') {
            event.preventDefault();
            onClose();
          }
        }}
        placeholder="Find"
        className="w-40 rounded border border-theme-1 bg-theme-1 px-1.5 py-0.5 text-xs text-theme-0 placeholder:text-theme-3"
      />

      <span
        className={`rounded border px-1.5 py-0.5 leading-none tabular-nums ${hasMatch ? 'border-theme-1 text-theme-2' : 'border-red-400 text-red-400'}`}
        title="Current/Total"
      >
        {countLabel}
      </span>

      <button
        type="button"
        disabled={!canNavigate}
        className="rounded px-1 py-0.5 text-theme-2 hover:bg-theme-3 hover:text-theme-0 disabled:opacity-40 disabled:cursor-not-allowed"
        title="Previous match (Shift+Enter / Shift+F3)"
        onClick={onPrevious}
      >
        ↑
      </button>
      <button
        type="button"
        disabled={!canNavigate}
        className="rounded px-1 py-0.5 text-theme-2 hover:bg-theme-3 hover:text-theme-0 disabled:opacity-40 disabled:cursor-not-allowed"
        title="Next match (Enter / F3)"
        onClick={onNext}
      >
        ↓
      </button>
      <button
        type="button"
        className="rounded px-1 py-0.5 text-theme-2 hover:bg-theme-3 hover:text-theme-0"
        title="Close search (Esc)"
        onClick={onClose}
      >
        ✕
      </button>
    </div>
  );
}
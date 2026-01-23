import { useState, useCallback, useEffect } from 'react';

interface UseModalNavigationOptions {
  itemCount: number;
  onSelect: (index: number) => void;
  onClose: () => void;
}

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

export function useModalNavigation({
  itemCount,
  onSelect,
  onClose,
}: UseModalNavigationOptions) {
  const [highlightedIndex, setHighlightedIndex] = useState(0);

  // Reset highlighted index when item count changes
  useEffect(() => {
    setHighlightedIndex(0);
  }, [itemCount]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Navigate down: ArrowDown, Ctrl+N, Ctrl+J, or Cmd+J (mac)
      const isDownKey =
        e.key === 'ArrowDown' ||
        (e.ctrlKey && (e.key === 'n' || e.key === 'j')) ||
        (isMac && e.metaKey && e.key === 'j');

      if (isDownKey) {
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex((prev) => (prev < itemCount - 1 ? prev + 1 : 0));
        return;
      }

      // Navigate up: ArrowUp, Ctrl+P, Ctrl+K, or Cmd+K (mac)
      const isUpKey =
        e.key === 'ArrowUp' ||
        (e.ctrlKey && (e.key === 'p' || e.key === 'k')) ||
        (isMac && e.metaKey && e.key === 'k');

      if (isUpKey) {
        e.preventDefault();
        e.stopPropagation();
        setHighlightedIndex((prev) => (prev > 0 ? prev - 1 : itemCount - 1));
        return;
      }

      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          e.stopPropagation();
          if (itemCount > 0) {
            onSelect(highlightedIndex);
          }
          break;
        case 'Escape':
          e.preventDefault();
          e.stopPropagation();
          onClose();
          break;
      }
    },
    [itemCount, highlightedIndex, onSelect, onClose]
  );

  return {
    highlightedIndex,
    setHighlightedIndex,
    handleKeyDown,
  };
}

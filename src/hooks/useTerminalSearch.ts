import { RefObject, useCallback, useEffect, useRef, useState } from 'react';
import type { Terminal } from '@xterm/xterm';

interface TerminalSearchMatch {
  line: number;
  column: number;
  length: number;
}

interface SearchHighlightHandle {
  marker?: { dispose: () => void };
  decoration?: { dispose: () => void };
}

const LIVE_SEARCH_MIN_QUERY_LENGTH = 2;
const LIVE_SEARCH_DEBOUNCE_MS = 160;

function compareMatch(a: TerminalSearchMatch, b: TerminalSearchMatch): number {
  if (a.line !== b.line) {
    return a.line - b.line;
  }
  return a.column - b.column;
}

function isSameMatch(a: TerminalSearchMatch | null, b: TerminalSearchMatch | null): boolean {
  if (!a || !b) {
    return false;
  }
  return a.line === b.line && a.column === b.column && a.length === b.length;
}

function collectMatches(terminal: Terminal, query: string): TerminalSearchMatch[] {
  const matches: TerminalSearchMatch[] = [];
  const buffer = terminal.buffer.active;
  if (buffer.length === 0 || query.length === 0) {
    return matches;
  }

  const needle = query.toLocaleLowerCase();

  for (let lineIndex = 0; lineIndex < buffer.length; lineIndex++) {
    const line = buffer.getLine(lineIndex);
    if (!line) {
      continue;
    }

    const text = line.translateToString(true);
    if (!text) {
      continue;
    }

    const haystack = text.toLocaleLowerCase();
    let fromIndex = 0;

    while (fromIndex < haystack.length) {
      const foundAt = haystack.indexOf(needle, fromIndex);
      if (foundAt === -1) {
        break;
      }

      matches.push({
        line: lineIndex,
        column: foundAt,
        length: query.length,
      });

      fromIndex = foundAt + 1;
    }
  }

  return matches;
}

interface UseTerminalSearchOptions {
  enabled?: boolean;
}

export function useTerminalSearch(
  terminalRef: RefObject<Terminal | null>,
  options: UseTerminalSearchOptions = {}
): {
  isSearchOpen: boolean;
  searchQuery: string;
  hasMatch: boolean;
  currentMatchIndex: number;
  totalMatches: number;
  setSearchQuery: (query: string) => void;
  openSearch: () => void;
  closeSearch: () => void;
  findNext: () => boolean;
  findPrevious: () => boolean;
  onTerminalKeyDown: (event: KeyboardEvent) => void;
} {
  const { enabled = true } = options;

  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [searchQuery, setSearchQueryState] = useState('');
  const [hasMatch, setHasMatch] = useState(true);
  const [currentMatchIndex, setCurrentMatchIndex] = useState(0);
  const [totalMatches, setTotalMatches] = useState(0);

  const queryRef = useRef('');
  const isSearchOpenRef = useRef(false);
  const currentMatchRef = useRef<TerminalSearchMatch | null>(null);
  const highlightsRef = useRef<SearchHighlightHandle[]>([]);
  const liveSyncTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearHighlights = useCallback(() => {
    for (const item of highlightsRef.current) {
      item.decoration?.dispose();
      item.marker?.dispose();
    }
    highlightsRef.current = [];
  }, []);

  const renderHighlights = useCallback(
    (matches: TerminalSearchMatch[], activeIndex: number) => {
      clearHighlights();

      const terminal = terminalRef.current;
      if (!terminal || matches.length === 0) {
        return;
      }

      const buffer = terminal.buffer.active;
      const rows = Math.max(terminal.rows, 1);
      const viewportTop = Math.max(buffer.viewportY ?? buffer.cursorY, 0);
      const viewportBottom = viewportTop + rows - 1;
      const margin = rows * 2;
      const minLine = Math.max(0, viewportTop - margin);
      const maxLine = viewportBottom + margin;
      const maxHighlights = 600;

      type IndexedMatch = { match: TerminalSearchMatch; index: number };
      const candidateMatches: IndexedMatch[] = [];

      for (let index = 0; index < matches.length; index++) {
        const match = matches[index];
        if (index === activeIndex || (match.line >= minLine && match.line <= maxLine)) {
          candidateMatches.push({ match, index });
        }
      }

      let selectedMatches = candidateMatches;
      if (candidateMatches.length > maxHighlights) {
        selectedMatches = [...candidateMatches]
          .sort((a, b) => {
            if (a.index === activeIndex) return -1;
            if (b.index === activeIndex) return 1;

            const aDistance = Math.abs(a.match.line - viewportTop);
            const bDistance = Math.abs(b.match.line - viewportTop);
            if (aDistance !== bDistance) {
              return aDistance - bDistance;
            }

            return a.index - b.index;
          })
          .slice(0, maxHighlights)
          .sort((a, b) => a.index - b.index);
      }

      for (const { match, index } of selectedMatches) {
        const marker = terminal.registerMarker(match.line - buffer.cursorY);
        if (!marker) {
          continue;
        }

        const isActive = index === activeIndex;
        const decoration = terminal.registerDecoration({
          marker,
          x: match.column,
          width: Math.max(match.length, 1),
          backgroundColor: isActive ? '#f59e0b' : '#1d4ed8',
          foregroundColor: isActive ? '#111827' : '#ffffff',
          layer: 'top',
        });

        highlightsRef.current.push({ marker, decoration });
      }
    },
    [clearHighlights, terminalRef]
  );

  const selectMatch = useCallback(
    (match: TerminalSearchMatch, shouldScroll: boolean) => {
      const terminal = terminalRef.current;
      if (!terminal) {
        return;
      }

      terminal.clearSelection();
      if (shouldScroll) {
        const centerLine = Math.max(match.line - Math.floor(terminal.rows / 2), 0);
        terminal.scrollToLine(centerLine);
      }
    },
    [terminalRef]
  );

  const clearSearchView = useCallback(() => {
    setHasMatch(true);
    setCurrentMatchIndex(0);
    setTotalMatches(0);
    currentMatchRef.current = null;
    terminalRef.current?.clearSelection();
    clearHighlights();
  }, [clearHighlights, terminalRef]);


  const resetLiveSearchState = useCallback(() => {
    setHasMatch(true);
    setCurrentMatchIndex(0);
    setTotalMatches(0);
    currentMatchRef.current = null;
    terminalRef.current?.clearSelection();
    clearHighlights();
  }, [clearHighlights, terminalRef]);

  const cancelLiveSync = useCallback(() => {
    if (liveSyncTimerRef.current) {
      clearTimeout(liveSyncTimerRef.current);
      liveSyncTimerRef.current = null;
    }
  }, []);

  const resolveIndexFromCursor = useCallback(
    (matches: TerminalSearchMatch[], direction: 1 | -1): number => {
      const terminal = terminalRef.current;
      if (!terminal || matches.length === 0) {
        return -1;
      }

      const buffer = terminal.buffer.active;
      const cursorPoint: TerminalSearchMatch = {
        line: buffer.cursorY,
        column: buffer.cursorX,
        length: queryRef.current.trim().length,
      };

      if (direction === 1) {
        const next = matches.findIndex((item) => compareMatch(item, cursorPoint) >= 0);
        return next === -1 ? 0 : next;
      }

      for (let index = matches.length - 1; index >= 0; index--) {
        if (compareMatch(matches[index], cursorPoint) <= 0) {
          return index;
        }
      }

      return matches.length - 1;
    },
    [terminalRef]
  );

  const applyActiveMatch = useCallback(
    (matches: TerminalSearchMatch[], nextIndex: number, shouldScroll: boolean) => {
      if (nextIndex < 0 || nextIndex >= matches.length) {
        return false;
      }

      const nextMatch = matches[nextIndex];
      currentMatchRef.current = nextMatch;
      setHasMatch(true);
      setTotalMatches(matches.length);
      setCurrentMatchIndex(nextIndex + 1);
      selectMatch(nextMatch, shouldScroll);
      renderHighlights(matches, nextIndex);
      return true;
    },
    [renderHighlights, selectMatch]
  );

  const find = useCallback(
    (direction: 1 | -1) => {
      const terminal = terminalRef.current;
      const query = queryRef.current.trim();

      if (!terminal || query.length === 0) {
        clearSearchView();
        return false;
      }

      const matches = collectMatches(terminal, query);
      setTotalMatches(matches.length);

      if (matches.length === 0) {
        setHasMatch(false);
        setCurrentMatchIndex(0);
        currentMatchRef.current = null;
        terminal.clearSelection();
        clearHighlights();
        return false;
      }

      const current = currentMatchRef.current;
      let nextIndex = -1;

      if (current) {
        const currentIndex = matches.findIndex((item) => isSameMatch(item, current));
        if (currentIndex !== -1) {
          nextIndex = direction === 1
            ? (currentIndex + 1) % matches.length
            : (currentIndex - 1 + matches.length) % matches.length;
        }
      }

      if (nextIndex === -1) {
        nextIndex = resolveIndexFromCursor(matches, direction);
      }

      return applyActiveMatch(matches, nextIndex, true);
    },
    [applyActiveMatch, clearHighlights, clearSearchView, resolveIndexFromCursor, terminalRef]
  );

  const findNext = useCallback(() => find(1), [find]);
  const findPrevious = useCallback(() => find(-1), [find]);

  const syncMatchesFromQuery = useCallback(
    (query: string) => {
      const terminal = terminalRef.current;
      const trimmed = query.trim();

      if (!terminal || trimmed.length === 0) {
        clearSearchView();
        return;
      }

      const matches = collectMatches(terminal, trimmed);
      setTotalMatches(matches.length);

      if (matches.length === 0) {
        setHasMatch(false);
        setCurrentMatchIndex(0);
        currentMatchRef.current = null;
        terminal.clearSelection();
        clearHighlights();
        return;
      }

      const current = currentMatchRef.current;
      let nextIndex = current
        ? matches.findIndex((item) => isSameMatch(item, current))
        : -1;

      if (nextIndex === -1) {
        nextIndex = resolveIndexFromCursor(matches, 1);
      }

      applyActiveMatch(matches, nextIndex, true);
    },
    [applyActiveMatch, clearHighlights, clearSearchView, resolveIndexFromCursor, terminalRef]
  );


  const scheduleLiveSync = useCallback(
    (query: string, immediate = false) => {
      const trimmed = query.trim();
      cancelLiveSync();

      if (trimmed.length === 0) {
        clearSearchView();
        return;
      }

      if (trimmed.length < LIVE_SEARCH_MIN_QUERY_LENGTH) {
        resetLiveSearchState();
        return;
      }

      if (immediate) {
        syncMatchesFromQuery(trimmed);
        return;
      }

      liveSyncTimerRef.current = setTimeout(() => {
        liveSyncTimerRef.current = null;
        syncMatchesFromQuery(queryRef.current);
      }, LIVE_SEARCH_DEBOUNCE_MS);
    },
    [cancelLiveSync, clearSearchView, resetLiveSearchState, syncMatchesFromQuery]
  );

  const openSearch = useCallback(() => {
    setIsSearchOpen(true);
    setHasMatch(true);
    terminalRef.current?.textarea?.blur();

    const existingQuery = queryRef.current.trim();
    if (existingQuery.length > 0) {
      requestAnimationFrame(() => {
        scheduleLiveSync(existingQuery, true);
      });
    }
  }, [scheduleLiveSync, terminalRef]);

  const closeSearch = useCallback(() => {
    cancelLiveSync();
    setIsSearchOpen(false);
    clearSearchView();
  }, [cancelLiveSync, clearSearchView]);

  const setSearchQuery = useCallback(
    (query: string) => {
      setSearchQueryState(query);
      queryRef.current = query;
      currentMatchRef.current = null;
      scheduleLiveSync(query);
    },
    [scheduleLiveSync]
  );

  const onTerminalKeyDown = useCallback(
    (event: KeyboardEvent) => {
      const key = event.key.toLowerCase();

      if ((event.ctrlKey || event.metaKey) && key === 'f') {
        event.preventDefault();
        event.stopPropagation();
        openSearch();
        return;
      }

      if (!isSearchOpenRef.current) {
        return;
      }

      if (event.key === 'F3') {
        event.preventDefault();
        event.stopPropagation();
        if (event.shiftKey) {
          findPrevious();
        } else {
          findNext();
        }
        return;
      }

      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeSearch();
      }
    },
    [closeSearch, findNext, findPrevious, openSearch]
  );

  useEffect(() => {
    isSearchOpenRef.current = isSearchOpen;
    if (!isSearchOpen) {
      currentMatchRef.current = null;
    }
  }, [isSearchOpen]);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!enabled || !terminal || !isSearchOpen || queryRef.current.trim().length < LIVE_SEARCH_MIN_QUERY_LENGTH) {
      return;
    }

    const disposable = terminal.onWriteParsed(() => {
      scheduleLiveSync(queryRef.current);
    });

    return () => {
      disposable.dispose();
    };
  }, [enabled, isSearchOpen, scheduleLiveSync, terminalRef]);

  useEffect(() => {
    if (!enabled) {
      return;
    }

    const handleWindowKeyDown = (event: KeyboardEvent) => {
      const terminal = terminalRef.current;
      const terminalElement = terminal?.element;
      if (!terminalElement) {
        return;
      }

      const active = document.activeElement as Node | null;
      if (!active || !terminalElement.contains(active)) {
        return;
      }

      onTerminalKeyDown(event);
    };

    window.addEventListener('keydown', handleWindowKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleWindowKeyDown, true);
    };
  }, [enabled, onTerminalKeyDown, terminalRef]);

  useEffect(() => {
    return () => {
      cancelLiveSync();
      clearHighlights();
    };
  }, [cancelLiveSync, clearHighlights]);

  return {
    isSearchOpen,
    searchQuery,
    hasMatch,
    currentMatchIndex,
    totalMatches,
    setSearchQuery,
    openSearch,
    closeSearch,
    findNext,
    findPrevious,
    onTerminalKeyDown,
  };
}
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useTerminalSearch } from './useTerminalSearch';

function createMockTerminal(initialLines: string[]) {
  const lines = [...initialLines];
  const activeBuffer: {
    cursorY: number;
    cursorX: number;
    getLine: (index: number) => { translateToString: (trimRight: boolean) => string } | undefined;
  } = {
    cursorY: 0,
    cursorX: 0,
    getLine: (index: number) => {
      const line = lines[index];
      if (line === undefined) {
        return undefined;
      }
      return {
        translateToString: () => line,
      };
    },
  };

  Object.defineProperty(activeBuffer, 'length', {
    get: () => lines.length,
  });

  const listeners = new Set<() => void>();
  const element = document.createElement('div');
  const textarea = document.createElement('textarea');
  element.appendChild(textarea);

  const terminal = {
    buffer: {
      active: activeBuffer,
    },
    rows: 24,
    element,
    textarea,
    clearSelection: vi.fn(),
    scrollToLine: vi.fn(),
    registerMarker: vi.fn(() => ({ dispose: vi.fn() })),
    registerDecoration: vi.fn(() => ({ dispose: vi.fn() })),
    onWriteParsed: vi.fn((callback: () => void) => {
      listeners.add(callback);
      return {
        dispose: () => {
          listeners.delete(callback);
        },
      };
    }),
  };

  return {
    terminal,
    lines,
    emitWriteParsed: () => {
      for (const listener of listeners) {
        listener();
      }
    },
  };
}

describe('useTerminalSearch performance strategy', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.runOnlyPendingTimers();
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  it('does not run live scan for 1-char query', () => {
    const { terminal } = createMockTerminal(['alpha', 'beta', 'gamma']);
    const terminalRef = { current: terminal };

    const { result } = renderHook(() => useTerminalSearch(terminalRef as any));

    act(() => {
      result.current.openSearch();
      result.current.setSearchQuery('a');
      vi.advanceTimersByTime(500);
    });

    expect(result.current.totalMatches).toBe(0);
    expect(result.current.currentMatchIndex).toBe(0);
    expect(terminal.registerDecoration).not.toHaveBeenCalled();

    act(() => {
      result.current.findNext();
    });

    expect(result.current.totalMatches).toBeGreaterThan(0);
  });

  it('debounces live scan for 2+ chars', () => {
    const { terminal } = createMockTerminal(['beta value', 'alpha value']);
    const terminalRef = { current: terminal };

    const { result } = renderHook(() => useTerminalSearch(terminalRef as any));

    act(() => {
      result.current.openSearch();
      result.current.setSearchQuery('be');
      vi.advanceTimersByTime(159);
    });

    expect(result.current.totalMatches).toBe(0);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.totalMatches).toBe(1);
    expect(terminal.registerDecoration).toHaveBeenCalled();
  });

  it('debounces re-sync on terminal output updates', () => {
    const { terminal, lines, emitWriteParsed } = createMockTerminal(['beta value']);
    const terminalRef = { current: terminal };

    const { result } = renderHook(() => useTerminalSearch(terminalRef as any));

    act(() => {
      result.current.openSearch();
      result.current.setSearchQuery('be');
      vi.advanceTimersByTime(160);
    });

    expect(result.current.totalMatches).toBe(1);

    lines.push('another be line');
    act(() => {
      emitWriteParsed();
    });

    expect(result.current.totalMatches).toBe(1);

    act(() => {
      vi.advanceTimersByTime(159);
    });

    expect(result.current.totalMatches).toBe(1);

    act(() => {
      vi.advanceTimersByTime(1);
    });

    expect(result.current.totalMatches).toBe(2);
  });
});

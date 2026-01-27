import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useScratchTerminals } from './useScratchTerminals';
import { resetMocks, mockInvokeResponses } from '../test/setup';

describe('useScratchTerminals', () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
    mockInvokeResponses.set('get_home_dir', '/Users/test');
  });

  describe('initialization', () => {
    it('starts with empty scratch terminals', async () => {
      const { result } = renderHook(() => useScratchTerminals());

      // Wait for homeDir to load
      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      expect(result.current.scratchTerminals).toHaveLength(0);
      expect(result.current.scratchCwds.size).toBe(0);
    });

    it('fetches home directory on mount', async () => {
      const { result } = renderHook(() => useScratchTerminals());

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });
    });

    it('handles home directory fetch failure gracefully', async () => {
      mockInvokeResponses.set('get_home_dir', () =>
        Promise.reject(new Error('Failed'))
      );

      const { result } = renderHook(() => useScratchTerminals());

      // Wait a bit for the async operation
      await act(async () => {
        await new Promise((r) => setTimeout(r, 50));
      });

      expect(result.current.homeDir).toBeNull();
    });
  });

  describe('addScratchTerminal', () => {
    it('adds a new scratch terminal with incremented counter', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      let newTerminal;
      act(() => {
        newTerminal = result.current.addScratchTerminal();
      });

      expect(newTerminal).toEqual({
        id: 'scratch-1',
        name: 'Terminal 1',
        order: 0,
        initialCwd: undefined,
      });
      expect(result.current.scratchTerminals).toHaveLength(1);
    });

    it('creates scratch terminal with initialCwd when provided', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      let newTerminal;
      act(() => {
        newTerminal = result.current.addScratchTerminal('/custom/directory');
      });

      expect(newTerminal).toEqual({
        id: 'scratch-1',
        name: 'Terminal 1',
        order: 0,
        initialCwd: '/custom/directory',
      });
    });

    it('increments counter for each new terminal', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      // Need separate act() calls to avoid state batching issues with counter
      act(() => {
        result.current.addScratchTerminal();
      });
      act(() => {
        result.current.addScratchTerminal();
      });
      act(() => {
        result.current.addScratchTerminal();
      });

      expect(result.current.scratchTerminals).toHaveLength(3);
      expect(result.current.scratchTerminals[0].id).toBe('scratch-1');
      expect(result.current.scratchTerminals[1].id).toBe('scratch-2');
      expect(result.current.scratchTerminals[2].id).toBe('scratch-3');
    });

    it('sets order based on current length', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      // Need separate act() calls for order to reflect current array length
      act(() => {
        result.current.addScratchTerminal();
      });
      act(() => {
        result.current.addScratchTerminal();
      });

      expect(result.current.scratchTerminals[0].order).toBe(0);
      expect(result.current.scratchTerminals[1].order).toBe(1);
    });

    it('initializes session cwd to homeDir when homeDir is available', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      let newTerminal: { id: string } | undefined;
      act(() => {
        newTerminal = result.current.addScratchTerminal();
      });

      // Session-level cwd is initialized to homeDir (used for sidebar display)
      // Tab-level cwd is tracked separately via OSC 7
      await waitFor(() => {
        expect(result.current.scratchCwds.get(newTerminal!.id)).toBe('/Users/test');
      });
    });
  });

  describe('closeScratchTerminal', () => {
    it('removes the specified scratch terminal', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      let terminal;
      act(() => {
        terminal = result.current.addScratchTerminal();
      });

      expect(result.current.scratchTerminals).toHaveLength(1);

      act(() => {
        result.current.closeScratchTerminal(terminal!.id);
      });

      expect(result.current.scratchTerminals).toHaveLength(0);
    });

    it('does not clean up cwds (cleanup is done in App.tsx per tab ID)', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      let terminal;
      act(() => {
        terminal = result.current.addScratchTerminal();
      });

      // Manually set a cwd (simulating what OSC 7 would do for a tab)
      const tabId = `${terminal!.id}-session-1`;
      act(() => {
        result.current.updateScratchCwd(tabId, '/some/path');
      });

      expect(result.current.scratchCwds.has(tabId)).toBe(true);

      act(() => {
        result.current.closeScratchTerminal(terminal!.id);
      });

      // CWDs are now keyed by tab ID and cleaned up in App.tsx, not here
      expect(result.current.scratchCwds.has(tabId)).toBe(true);
    });

    it('only removes the specified terminal, keeping others', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      let t1, t2, t3;
      act(() => {
        t1 = result.current.addScratchTerminal();
      });
      act(() => {
        t2 = result.current.addScratchTerminal();
      });
      act(() => {
        t3 = result.current.addScratchTerminal();
      });

      act(() => {
        result.current.closeScratchTerminal(t2!.id);
      });

      expect(result.current.scratchTerminals).toHaveLength(2);
      expect(result.current.scratchTerminals.map((t) => t.id)).toEqual([
        t1!.id,
        t3!.id,
      ]);
    });
  });

  describe('renameScratchTerminal', () => {
    it('updates the name of the specified terminal', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      let terminal;
      act(() => {
        terminal = result.current.addScratchTerminal();
      });

      act(() => {
        result.current.renameScratchTerminal(terminal!.id, 'My Custom Name');
      });

      expect(result.current.scratchTerminals[0].name).toBe('My Custom Name');
    });

    it('only renames the specified terminal', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      let t1, t2;
      act(() => {
        t1 = result.current.addScratchTerminal();
      });
      act(() => {
        t2 = result.current.addScratchTerminal();
      });

      act(() => {
        result.current.renameScratchTerminal(t1!.id, 'Renamed');
      });

      expect(result.current.scratchTerminals[0].name).toBe('Renamed');
      expect(result.current.scratchTerminals[1].name).toBe('Terminal 2');
    });
  });

  describe('reorderScratchTerminals', () => {
    it('reorders terminals according to provided ids', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      let t1, t2, t3;
      act(() => {
        t1 = result.current.addScratchTerminal();
        t2 = result.current.addScratchTerminal();
        t3 = result.current.addScratchTerminal();
      });

      // Reverse the order
      act(() => {
        result.current.reorderScratchTerminals([t3!.id, t2!.id, t1!.id]);
      });

      expect(result.current.scratchTerminals.map((t) => t.id)).toEqual([
        t3!.id,
        t2!.id,
        t1!.id,
      ]);
    });

    it('updates order property based on new position', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      let t1, t2, t3;
      act(() => {
        t1 = result.current.addScratchTerminal();
        t2 = result.current.addScratchTerminal();
        t3 = result.current.addScratchTerminal();
      });

      // Reverse the order
      act(() => {
        result.current.reorderScratchTerminals([t3!.id, t2!.id, t1!.id]);
      });

      expect(result.current.scratchTerminals[0].order).toBe(0);
      expect(result.current.scratchTerminals[1].order).toBe(1);
      expect(result.current.scratchTerminals[2].order).toBe(2);
    });
  });

  describe('removeScratchCwd', () => {
    it('removes cwd entry for specified tab ID', async () => {
      const { result } = renderHook(() => useScratchTerminals());

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      // Set a cwd for a tab
      const tabId = 'scratch-1-session-1';
      act(() => {
        result.current.updateScratchCwd(tabId, '/some/path');
      });

      expect(result.current.scratchCwds.has(tabId)).toBe(true);

      act(() => {
        result.current.removeScratchCwd(tabId);
      });

      expect(result.current.scratchCwds.has(tabId)).toBe(false);
    });

    it('does nothing if tab ID does not exist', async () => {
      const { result } = renderHook(() => useScratchTerminals());

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      // Set a cwd for one tab
      const tabId1 = 'scratch-1-session-1';
      act(() => {
        result.current.updateScratchCwd(tabId1, '/path1');
      });

      const cwdsBefore = result.current.scratchCwds;

      // Try to remove a non-existent tab
      act(() => {
        result.current.removeScratchCwd('non-existent-tab');
      });

      // Should return same reference (no change)
      expect(result.current.scratchCwds).toBe(cwdsBefore);
      expect(result.current.scratchCwds.has(tabId1)).toBe(true);
    });
  });

  describe('updateScratchCwd', () => {
    it('updates the cwd for the specified terminal', async () => {
      const { result } = renderHook(() =>
        useScratchTerminals()
      );

      await waitFor(() => {
        expect(result.current.homeDir).toBe('/Users/test');
      });

      let terminal;
      act(() => {
        terminal = result.current.addScratchTerminal();
      });

      act(() => {
        result.current.updateScratchCwd(terminal!.id, '/some/other/path');
      });

      expect(result.current.scratchCwds.get(terminal!.id)).toBe(
        '/some/other/path'
      );
    });

    it('can set cwd for terminal that was added without homeDir', async () => {
      // Don't set homeDir response - simulates adding before homeDir is loaded
      mockInvokeResponses.set('get_home_dir', () => new Promise(() => {})); // Never resolves

      const { result } = renderHook(() => useScratchTerminals());

      let terminal;
      act(() => {
        terminal = result.current.addScratchTerminal();
      });

      // Terminal was added but no cwd was set (homeDir wasn't available)
      expect(result.current.scratchCwds.has(terminal!.id)).toBe(false);

      // Now set cwd manually
      act(() => {
        result.current.updateScratchCwd(terminal!.id, '/new/path');
      });

      expect(result.current.scratchCwds.get(terminal!.id)).toBe('/new/path');
    });
  });
});

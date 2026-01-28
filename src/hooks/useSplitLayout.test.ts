import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSplitLayout } from './useSplitLayout';

describe('useSplitLayout', () => {
  describe('initTab', () => {
    it('initializes a tab with a single pane', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      expect(result.current.splitStates.has('tab-1')).toBe(true);
      const state = result.current.splitStates.get('tab-1')!;
      expect(state.panes.size).toBe(1);
      expect(state.activePaneId).toBeTruthy();
    });

    it('is idempotent - calling twice does not add extra panes', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      expect(result.current.splitStates.get('tab-1')!.panes.size).toBe(1);
    });

    it('creates different panes for different tabs', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
        result.current.initTab('tab-2', { type: 'scratch' });
      });

      expect(result.current.splitStates.size).toBe(2);
      expect(result.current.splitStates.get('tab-1')!.panes.size).toBe(1);
      expect(result.current.splitStates.get('tab-2')!.panes.size).toBe(1);
    });
  });

  describe('split', () => {
    it('creates a new pane when splitting', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main', directory: '/home/user' });
      });

      act(() => {
        result.current.split('tab-1', 'horizontal');
      });

      const state = result.current.splitStates.get('tab-1')!;
      expect(state.panes.size).toBe(2);
    });

    it('new pane inherits type and directory from active pane', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'scratch', directory: '/tmp' });
      });

      act(() => {
        result.current.split('tab-1', 'horizontal');
      });

      const state = result.current.splitStates.get('tab-1')!;
      // Get the non-active pane (the new one)
      const panes = Array.from(state.panes.values());
      const newPane = panes.find(p => p.id !== state.activePaneId);
      expect(newPane?.type).toBe('scratch');
      expect(newPane?.directory).toBe('/tmp');
    });

    it('returns null for non-existent tab', () => {
      const { result } = renderHook(() => useSplitLayout());

      let newPaneId: string | null = null;
      act(() => {
        newPaneId = result.current.split('non-existent', 'horizontal');
      });

      expect(newPaneId).toBeNull();
    });

  });

  describe('closePane', () => {
    it('removes a pane when there are multiple panes', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      act(() => {
        result.current.split('tab-1', 'horizontal');
      });

      const panesBefore = result.current.splitStates.get('tab-1')!.panes.size;
      expect(panesBefore).toBe(2);

      // Get a pane ID to close
      const state = result.current.splitStates.get('tab-1')!;
      const paneToClose = Array.from(state.panes.keys())[1];

      act(() => {
        result.current.closePane('tab-1', paneToClose);
      });

      const panesAfter = result.current.splitStates.get('tab-1')!.panes.size;
      expect(panesAfter).toBe(1);
    });

    it('does not close the last pane', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      const activePaneId = result.current.getActivePaneId('tab-1');

      act(() => {
        result.current.closePane('tab-1', activePaneId!);
      });

      // Should still have one pane
      expect(result.current.splitStates.get('tab-1')!.panes.size).toBe(1);
    });

    it('updates active pane when closing the active pane', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      const firstPaneId = result.current.getActivePaneId('tab-1')!;

      act(() => {
        result.current.split('tab-1', 'horizontal');
      });

      // Get the second pane ID (the newly created one)
      const state = result.current.splitStates.get('tab-1')!;
      const secondPaneId = Array.from(state.panes.keys()).find(id => id !== firstPaneId)!;

      // Focus the second pane
      act(() => {
        result.current.focusPane('tab-1', secondPaneId);
      });

      expect(result.current.getActivePaneId('tab-1')).toBe(secondPaneId);

      // Close the second (active) pane
      act(() => {
        result.current.closePane('tab-1', secondPaneId);
      });

      // Should focus the first pane now
      expect(result.current.getActivePaneId('tab-1')).toBe(firstPaneId);
    });
  });

  describe('focusPane', () => {
    it('changes the active pane', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      const firstPaneId = result.current.getActivePaneId('tab-1')!;

      act(() => {
        result.current.split('tab-1', 'horizontal');
      });

      // Get the second pane ID
      const state = result.current.splitStates.get('tab-1')!;
      const secondPaneId = Array.from(state.panes.keys()).find(id => id !== firstPaneId)!;

      act(() => {
        result.current.focusPane('tab-1', secondPaneId);
      });

      expect(result.current.getActivePaneId('tab-1')).toBe(secondPaneId);
    });

    it('ignores focus for non-existent pane', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      const activePaneId = result.current.getActivePaneId('tab-1');

      act(() => {
        result.current.focusPane('tab-1', 'non-existent-pane');
      });

      expect(result.current.getActivePaneId('tab-1')).toBe(activePaneId);
    });
  });

  describe('setPaneReady', () => {
    it('updates pane with PTY ID', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      const paneId = result.current.getActivePaneId('tab-1')!;

      act(() => {
        result.current.setPaneReady('tab-1', paneId, 'pty-123');
      });

      const paneConfig = result.current.getPaneConfig('tab-1', paneId);
      expect(paneConfig?.ptyId).toBe('pty-123');
    });
  });

  describe('getTabPtyIds', () => {
    it('returns all PTY IDs for a tab', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      const pane1Id = result.current.getActivePaneId('tab-1')!;

      act(() => {
        result.current.split('tab-1', 'horizontal');
      });

      // Get second pane ID
      const state = result.current.splitStates.get('tab-1')!;
      const pane2Id = Array.from(state.panes.keys()).find(id => id !== pane1Id)!;

      act(() => {
        result.current.setPaneReady('tab-1', pane1Id, 'pty-1');
        result.current.setPaneReady('tab-1', pane2Id, 'pty-2');
      });

      const ptyIds = result.current.getTabPtyIds('tab-1');
      expect(ptyIds).toContain('pty-1');
      expect(ptyIds).toContain('pty-2');
      expect(ptyIds.length).toBe(2);
    });

    it('excludes panes without PTY IDs', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      const paneId = result.current.getActivePaneId('tab-1')!;

      act(() => {
        result.current.split('tab-1', 'horizontal');
        result.current.setPaneReady('tab-1', paneId, 'pty-1');
      });

      const ptyIds = result.current.getTabPtyIds('tab-1');
      expect(ptyIds).toEqual(['pty-1']);
    });
  });

  describe('clearTab', () => {
    it('removes all state for a tab', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      expect(result.current.splitStates.has('tab-1')).toBe(true);

      act(() => {
        result.current.clearTab('tab-1');
      });

      expect(result.current.splitStates.has('tab-1')).toBe(false);
    });
  });

  describe('hasSplits', () => {
    it('returns false for single pane', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      expect(result.current.hasSplits('tab-1')).toBe(false);
    });

    it('returns true for multiple panes', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      act(() => {
        result.current.split('tab-1', 'horizontal');
      });

      expect(result.current.hasSplits('tab-1')).toBe(true);
    });

    it('returns false for non-existent tab', () => {
      const { result } = renderHook(() => useSplitLayout());
      expect(result.current.hasSplits('non-existent')).toBe(false);
    });
  });

  describe('getPaneIds', () => {
    it('returns all pane IDs for a tab', () => {
      const { result } = renderHook(() => useSplitLayout());

      act(() => {
        result.current.initTab('tab-1', { type: 'main' });
      });

      const pane1Id = result.current.getActivePaneId('tab-1')!;

      act(() => {
        result.current.split('tab-1', 'horizontal');
      });

      const paneIds = result.current.getPaneIds('tab-1');
      expect(paneIds).toContain(pane1Id);
      expect(paneIds.length).toBe(2);
    });

    it('returns empty array for non-existent tab', () => {
      const { result } = renderHook(() => useSplitLayout());
      expect(result.current.getPaneIds('non-existent')).toEqual([]);
    });
  });
});

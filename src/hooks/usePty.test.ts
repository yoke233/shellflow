import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { usePty } from './usePty';
import { resetMocks, mockInvokeResponses, invokeHistory, emitEvent } from '../test/setup';

describe('usePty', () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe('spawn', () => {
    it('spawns a main terminal', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-main-123');

      const { result } = renderHook(() => usePty());

      let ptyId: string | undefined;
      await act(async () => {
        ptyId = await result.current.spawn('worktree-1', 'main', 80, 24);
      });

      expect(ptyId).toBe('pty-main-123');
      expect(result.current.ptyId).toBe('pty-main-123');

      const spawnCall = invokeHistory.find((h) => h.command === 'spawn_main');
      expect(spawnCall).toBeDefined();
      expect(spawnCall?.args).toEqual({ worktreeId: 'worktree-1', cols: 80, rows: 24 });
    });

    it('spawns a project shell', async () => {
      mockInvokeResponses.set('spawn_project_shell', 'pty-project-456');

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawn('project-1', 'project', 100, 30);
      });

      expect(result.current.ptyId).toBe('pty-project-456');

      const spawnCall = invokeHistory.find((h) => h.command === 'spawn_project_shell');
      expect(spawnCall).toBeDefined();
      expect(spawnCall?.args).toEqual({ projectId: 'project-1', cols: 100, rows: 30 });
    });

    it('spawns a scratch terminal', async () => {
      mockInvokeResponses.set('spawn_scratch_terminal', 'pty-scratch-789');

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawn('scratch-1', 'scratch');
      });

      expect(result.current.ptyId).toBe('pty-scratch-789');

      const spawnCall = invokeHistory.find((h) => h.command === 'spawn_scratch_terminal');
      expect(spawnCall).toBeDefined();
      expect(spawnCall?.args).toEqual({ scratchId: 'scratch-1', directory: undefined, cols: undefined, rows: undefined });
    });

    it('spawns a scratch terminal with custom directory', async () => {
      mockInvokeResponses.set('spawn_scratch_terminal', 'pty-scratch-custom');

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawn('scratch-1', 'scratch', 80, 24, '/custom/path');
      });

      expect(result.current.ptyId).toBe('pty-scratch-custom');

      const spawnCall = invokeHistory.find((h) => h.command === 'spawn_scratch_terminal');
      expect(spawnCall).toBeDefined();
      expect(spawnCall?.args).toEqual({ scratchId: 'scratch-1', directory: '/custom/path', cols: 80, rows: 24 });
    });

    it('spawns a shell terminal for worktree', async () => {
      mockInvokeResponses.set('spawn_terminal', 'pty-shell-101');

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawn('worktree-1', 'shell', 80, 24);
      });

      expect(result.current.ptyId).toBe('pty-shell-101');

      const spawnCall = invokeHistory.find((h) => h.command === 'spawn_terminal');
      expect(spawnCall).toBeDefined();
    });

    it('invokes onOutput callback when PTY output is received', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-output-test');

      const onOutput = vi.fn();
      const { result } = renderHook(() => usePty(onOutput));

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      // Emit PTY output event
      await act(async () => {
        emitEvent('pty-output', { pty_id: 'pty-output-test', data: 'Hello, World!' });
      });

      expect(onOutput).toHaveBeenCalledWith('Hello, World!');
    });

    it('ignores output from other PTY instances', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-mine');

      const onOutput = vi.fn();
      const { result } = renderHook(() => usePty(onOutput));

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      // Emit output from different PTY
      await act(async () => {
        emitEvent('pty-output', { pty_id: 'pty-other', data: 'Wrong PTY' });
      });

      expect(onOutput).not.toHaveBeenCalled();
    });

    it('buffers early events before PTY ID is known', async () => {
      // Simulate delayed ID return
      let resolveSpawn: (id: string) => void;
      mockInvokeResponses.set(
        'spawn_main',
        () =>
          new Promise((resolve) => {
            resolveSpawn = resolve;
          })
      );

      const onOutput = vi.fn();
      const { result } = renderHook(() => usePty(onOutput));

      // Start spawn (don't await)
      const spawnPromise = act(async () => {
        return result.current.spawn('worktree-1', 'main');
      });

      // Emit events before spawn resolves
      await act(async () => {
        emitEvent('pty-output', { pty_id: 'pty-buffered', data: 'Early message 1' });
        emitEvent('pty-output', { pty_id: 'pty-buffered', data: 'Early message 2' });
      });

      // Now resolve spawn
      await act(async () => {
        resolveSpawn!('pty-buffered');
      });

      await spawnPromise;

      // Both early messages should have been processed
      expect(onOutput).toHaveBeenCalledWith('Early message 1');
      expect(onOutput).toHaveBeenCalledWith('Early message 2');
    });
  });

  describe('spawnShell', () => {
    it('spawns a shell with entity ID and optional directory', async () => {
      mockInvokeResponses.set('spawn_shell', 'pty-shell-dir');

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawnShell('entity-1', '/custom/directory', 80, 24);
      });

      expect(result.current.ptyId).toBe('pty-shell-dir');

      const spawnCall = invokeHistory.find((h) => h.command === 'spawn_shell');
      expect(spawnCall?.args).toEqual({
        entityId: 'entity-1',
        directory: '/custom/directory',
        cols: 80,
        rows: 24,
      });
    });

    it('spawns shell without directory', async () => {
      mockInvokeResponses.set('spawn_shell', 'pty-shell-no-dir');

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawnShell('entity-1');
      });

      const spawnCall = invokeHistory.find((h) => h.command === 'spawn_shell');
      expect(spawnCall?.args).toEqual({
        entityId: 'entity-1',
        directory: undefined,
        cols: undefined,
        rows: undefined,
      });
    });
  });

  describe('write', () => {
    it('writes data to the PTY', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-write-test');
      mockInvokeResponses.set('pty_write', null);

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      await act(async () => {
        await result.current.write('ls -la\n');
      });

      const writeCall = invokeHistory.find((h) => h.command === 'pty_write');
      expect(writeCall).toBeDefined();
      expect(writeCall?.args).toEqual({ ptyId: 'pty-write-test', data: 'ls -la\n' });
    });

    it('does nothing when no PTY is spawned', async () => {
      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.write('ignored');
      });

      expect(invokeHistory.some((h) => h.command === 'pty_write')).toBe(false);
    });
  });

  describe('resize', () => {
    it('resizes the PTY', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-resize-test');
      mockInvokeResponses.set('pty_resize', null);

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      await act(async () => {
        await result.current.resize(120, 40);
      });

      const resizeCall = invokeHistory.find((h) => h.command === 'pty_resize');
      expect(resizeCall).toBeDefined();
      expect(resizeCall?.args).toEqual({ ptyId: 'pty-resize-test', cols: 120, rows: 40 });
    });

    it('does nothing when no PTY is spawned', async () => {
      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.resize(100, 50);
      });

      expect(invokeHistory.some((h) => h.command === 'pty_resize')).toBe(false);
    });
  });

  describe('interrupt', () => {
    it('sends SIGINT to the PTY', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-interrupt-test');
      mockInvokeResponses.set('pty_interrupt', null);

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      await act(async () => {
        await result.current.interrupt();
      });

      const interruptCall = invokeHistory.find((h) => h.command === 'pty_interrupt');
      expect(interruptCall).toBeDefined();
      expect(interruptCall?.args).toEqual({ ptyId: 'pty-interrupt-test' });
    });

    it('does nothing when no PTY is spawned', async () => {
      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.interrupt();
      });

      expect(invokeHistory.some((h) => h.command === 'pty_interrupt')).toBe(false);
    });

    it('handles interrupt errors gracefully', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-interrupt-error');
      mockInvokeResponses.set('pty_interrupt', () => {
        throw new Error('Interrupt failed');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      await act(async () => {
        await result.current.interrupt();
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('kill', () => {
    it('kills the PTY and cleans up', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-kill-test');
      mockInvokeResponses.set('pty_kill', null);

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      expect(result.current.ptyId).toBe('pty-kill-test');

      await act(async () => {
        await result.current.kill();
      });

      const killCall = invokeHistory.find((h) => h.command === 'pty_kill');
      expect(killCall).toBeDefined();
      expect(killCall?.args).toEqual({ ptyId: 'pty-kill-test' });

      expect(result.current.ptyId).toBeNull();
    });

    it('does nothing when no PTY is spawned', async () => {
      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.kill();
      });

      expect(invokeHistory.some((h) => h.command === 'pty_kill')).toBe(false);
    });

    it('stops receiving output after kill', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-kill-output');
      mockInvokeResponses.set('pty_kill', null);

      const onOutput = vi.fn();
      const { result } = renderHook(() => usePty(onOutput));

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      // Verify output works before kill
      await act(async () => {
        emitEvent('pty-output', { pty_id: 'pty-kill-output', data: 'Before kill' });
      });
      expect(onOutput).toHaveBeenCalledWith('Before kill');

      onOutput.mockClear();

      await act(async () => {
        await result.current.kill();
      });

      // Output after kill should be ignored
      await act(async () => {
        emitEvent('pty-output', { pty_id: 'pty-kill-output', data: 'After kill' });
      });

      expect(onOutput).not.toHaveBeenCalled();
    });
  });

  describe('cleanup', () => {
    it('cleans up listener when spawning new PTY', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-first');

      const onOutput = vi.fn();
      const { result } = renderHook(() => usePty(onOutput));

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      // Spawn a second PTY (should clean up first listener)
      mockInvokeResponses.set('spawn_main', 'pty-second');
      await act(async () => {
        await result.current.spawn('worktree-2', 'main');
      });

      // Output from first PTY should be ignored
      await act(async () => {
        emitEvent('pty-output', { pty_id: 'pty-first', data: 'Old PTY' });
      });
      expect(onOutput).not.toHaveBeenCalledWith('Old PTY');

      // Output from second PTY should work
      await act(async () => {
        emitEvent('pty-output', { pty_id: 'pty-second', data: 'New PTY' });
      });
      expect(onOutput).toHaveBeenCalledWith('New PTY');
    });

    it('cleans up listener on unmount', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-unmount');

      const onOutput = vi.fn();
      const { result, unmount } = renderHook(() => usePty(onOutput));

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      unmount();

      // Output after unmount should be ignored (listener cleaned up)
      await act(async () => {
        emitEvent('pty-output', { pty_id: 'pty-unmount', data: 'After unmount' });
      });

      // Note: The callback won't be called because hook is unmounted
      // This mainly tests that no errors occur
    });
  });

  describe('error handling', () => {
    it('throws when spawn fails', async () => {
      mockInvokeResponses.set('spawn_main', () => {
        throw new Error('PTY spawn failed');
      });

      const { result } = renderHook(() => usePty());

      await expect(
        act(async () => {
          await result.current.spawn('worktree-1', 'main');
        })
      ).rejects.toThrow('PTY spawn failed');
    });

    it('handles write errors gracefully', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-write-error');
      mockInvokeResponses.set('pty_write', () => {
        throw new Error('Write failed');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      // Write should not throw, but log error
      await act(async () => {
        await result.current.write('test');
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('handles resize errors gracefully', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-resize-error');
      mockInvokeResponses.set('pty_resize', () => {
        throw new Error('Resize failed');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      await act(async () => {
        await result.current.resize(100, 50);
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('handles kill errors gracefully', async () => {
      mockInvokeResponses.set('spawn_main', 'pty-kill-error');
      mockInvokeResponses.set('pty_kill', () => {
        throw new Error('Kill failed');
      });

      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

      const { result } = renderHook(() => usePty());

      await act(async () => {
        await result.current.spawn('worktree-1', 'main');
      });

      await act(async () => {
        await result.current.kill();
      });

      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });
});

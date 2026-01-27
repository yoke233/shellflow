import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useGitStatus } from './useGitStatus';
import { resetMocks, mockInvokeResponses, invokeHistory, emitEvent } from '../test/setup';
import type { FileChange } from '../types';

describe('useGitStatus', () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe('initialization', () => {
    it('returns empty files when target is null', () => {
      const { result } = renderHook(() => useGitStatus(null));

      expect(result.current.files).toEqual([]);
      expect(result.current.loading).toBe(false);
      expect(result.current.isGitRepo).toBe(true);
    });

    it('fetches files on mount when target is provided', async () => {
      const mockFiles: FileChange[] = [
        { path: 'src/app.ts', status: 'modified', insertions: 10, deletions: 5 },
      ];
      mockInvokeResponses.set('get_changed_files', mockFiles);
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('get_branch_info', null);

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' })
      );

      await waitFor(() => {
        expect(result.current.files).toEqual(mockFiles);
      });
    });
  });

  describe('watcher lifecycle', () => {
    it('starts watching on mount', async () => {
      mockInvokeResponses.set('get_changed_files', []);
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('get_branch_info', null);

      renderHook(() => useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' }));

      await waitFor(() => {
        const startCall = invokeHistory.find((h) => h.command === 'start_watching');
        expect(startCall).toBeDefined();
        expect(startCall?.args).toEqual({
          worktreeId: 'worktree-1',
          worktreePath: '/path/to/worktree',
        });
      });
    });

    it('stops watching on unmount', async () => {
      mockInvokeResponses.set('get_changed_files', []);
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('stop_watching', null);
      mockInvokeResponses.set('get_branch_info', null);

      const { unmount } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' })
      );

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'start_watching')).toBe(true);
      });

      unmount();

      await waitFor(() => {
        const stopCall = invokeHistory.find((h) => h.command === 'stop_watching');
        expect(stopCall).toBeDefined();
        expect(stopCall?.args).toEqual({ worktreeId: 'worktree-1' });
      });
    });
  });

  describe('event handling', () => {
    it('updates files on files-changed event', async () => {
      const initialFiles: FileChange[] = [
        { path: 'initial.ts', status: 'modified' },
      ];
      mockInvokeResponses.set('get_changed_files', initialFiles);
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('get_branch_info', null);

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' })
      );

      await waitFor(() => {
        expect(result.current.files).toEqual(initialFiles);
      });

      const updatedFiles: FileChange[] = [
        { path: 'updated.ts', status: 'added', insertions: 50 },
      ];

      act(() => {
        emitEvent('files-changed', {
          worktree_path: '/path/to/worktree',
          files: updatedFiles,
        });
      });

      expect(result.current.files).toEqual(updatedFiles);
    });

    it('ignores events for other paths', async () => {
      const myFiles: FileChange[] = [{ path: 'mine.ts', status: 'modified' }];
      mockInvokeResponses.set('get_changed_files', myFiles);
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('get_branch_info', null);

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/my/path' })
      );

      await waitFor(() => {
        expect(result.current.files).toEqual(myFiles);
      });

      const otherFiles: FileChange[] = [{ path: 'other.ts', status: 'added' }];
      act(() => {
        emitEvent('files-changed', {
          worktree_path: '/other/path',
          files: otherFiles,
        });
      });

      // Should still have original files
      expect(result.current.files).toEqual(myFiles);
    });
  });

  describe('refresh', () => {
    it('provides working refresh function', async () => {
      const newFiles: FileChange[] = [{ path: 'new.ts', status: 'added' }];
      mockInvokeResponses.set('get_changed_files', newFiles);
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('get_branch_info', null);

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' })
      );

      // Just wait for initial load
      await waitFor(() => {
        expect(result.current.files.length).toBeGreaterThanOrEqual(0);
        expect(result.current.loading).toBe(false);
      });

      // Refresh should call get_changed_files again
      const callsBefore = invokeHistory.filter((h) => h.command === 'get_changed_files').length;

      await act(async () => {
        await result.current.refresh();
      });

      const callsAfter = invokeHistory.filter((h) => h.command === 'get_changed_files').length;
      expect(callsAfter).toBeGreaterThan(callsBefore);
    });

    it('refresh no-ops when target is null', async () => {
      const { result } = renderHook(() => useGitStatus(null));

      await act(async () => {
        await result.current.refresh();
      });

      expect(invokeHistory.some((h) => h.command === 'get_changed_files')).toBe(false);
    });
  });

  describe('error handling', () => {
    it('handles fetch errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockInvokeResponses.set('get_changed_files', () => {
        throw new Error('Git error');
      });
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('get_branch_info', null);

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.files).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });

    it('handles start_watching errors gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockInvokeResponses.set('get_changed_files', []);
      mockInvokeResponses.set('start_watching', () => {
        throw new Error('Watcher error');
      });
      mockInvokeResponses.set('get_branch_info', null);

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.files).toEqual([]);
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('branch mode', () => {
    it('uses get_branch_changed_files when mode is branch', async () => {
      const mockFiles: FileChange[] = [
        { path: 'src/feature.ts', status: 'modified', insertions: 20, deletions: 5 },
      ];
      mockInvokeResponses.set('get_branch_changed_files', mockFiles);
      mockInvokeResponses.set('get_branch_info', {
        currentBranch: 'feature-branch',
        baseBranch: 'main',
        isOnBaseBranch: false,
      });

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' }, { mode: 'branch' })
      );

      await waitFor(() => {
        expect(result.current.files).toEqual(mockFiles);
      });

      // Should have called get_branch_changed_files, not get_changed_files
      const branchCall = invokeHistory.find((h) => h.command === 'get_branch_changed_files');
      expect(branchCall).toBeDefined();
    });

    it('uses get_changed_files when mode is uncommitted', async () => {
      const mockFiles: FileChange[] = [
        { path: 'src/app.ts', status: 'modified' },
      ];
      mockInvokeResponses.set('get_changed_files', mockFiles);
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('get_branch_info', {
        currentBranch: 'main',
        baseBranch: 'main',
        isOnBaseBranch: true,
      });

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' }, { mode: 'uncommitted' })
      );

      await waitFor(() => {
        expect(result.current.files).toEqual(mockFiles);
      });

      const uncommittedCall = invokeHistory.find((h) => h.command === 'get_changed_files');
      expect(uncommittedCall).toBeDefined();
    });

    it('refetches data when mode changes', async () => {
      const uncommittedFiles: FileChange[] = [{ path: 'uncommitted.ts', status: 'modified' }];
      const branchFiles: FileChange[] = [{ path: 'branch.ts', status: 'added' }];

      mockInvokeResponses.set('get_changed_files', uncommittedFiles);
      mockInvokeResponses.set('get_branch_changed_files', branchFiles);
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('stop_watching', null);
      mockInvokeResponses.set('get_branch_info', {
        currentBranch: 'feature',
        baseBranch: 'main',
        isOnBaseBranch: false,
      });

      const { result, rerender } = renderHook(
        ({ mode }) =>
          useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' }, { mode }),
        { initialProps: { mode: 'uncommitted' as const } }
      );

      await waitFor(() => {
        expect(result.current.files).toEqual(uncommittedFiles);
      });

      // Switch to branch mode
      rerender({ mode: 'branch' });

      await waitFor(() => {
        expect(result.current.files).toEqual(branchFiles);
      });
    });

    it('does not start watcher in branch mode', async () => {
      mockInvokeResponses.set('get_branch_changed_files', []);
      mockInvokeResponses.set('get_branch_info', {
        currentBranch: 'feature',
        baseBranch: 'main',
        isOnBaseBranch: false,
      });

      renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' }, { mode: 'branch' })
      );

      await waitFor(() => {
        // Should not have called start_watching
        const watchCall = invokeHistory.find((h) => h.command === 'start_watching');
        expect(watchCall).toBeUndefined();
      });
    });

    it('passes projectPath to get_branch_changed_files', async () => {
      mockInvokeResponses.set('get_branch_changed_files', []);
      mockInvokeResponses.set('get_branch_info', {
        currentBranch: 'feature',
        baseBranch: 'main',
        isOnBaseBranch: false,
      });

      renderHook(() =>
        useGitStatus(
          { id: 'worktree-1', path: '/path/to/worktree' },
          { mode: 'branch', projectPath: '/path/to/project' }
        )
      );

      await waitFor(() => {
        const branchCall = invokeHistory.find((h) => h.command === 'get_branch_changed_files');
        expect(branchCall?.args).toEqual({
          worktreePath: '/path/to/worktree',
          projectPath: '/path/to/project',
        });
      });
    });
  });

  describe('branchInfo', () => {
    it('fetches and exposes branchInfo', async () => {
      const mockBranchInfo = {
        currentBranch: 'feature-branch',
        baseBranch: 'main',
        isOnBaseBranch: false,
      };
      mockInvokeResponses.set('get_changed_files', []);
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('get_branch_info', mockBranchInfo);

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' })
      );

      await waitFor(() => {
        expect(result.current.branchInfo).toEqual(mockBranchInfo);
      });
    });

    it('sets branchInfo to null when target is null', () => {
      const { result } = renderHook(() => useGitStatus(null));
      expect(result.current.branchInfo).toBeNull();
    });

    it('handles branchInfo fetch error gracefully', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockInvokeResponses.set('get_changed_files', []);
      mockInvokeResponses.set('start_watching', null);
      // Use a promise rejection instead of throwing synchronously
      mockInvokeResponses.set('get_branch_info', Promise.reject(new Error('Branch info error')));

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      // branchInfo should remain null due to the error
      expect(result.current.branchInfo).toBeNull();
      expect(consoleSpy).toHaveBeenCalled();
      consoleSpy.mockRestore();
    });
  });

  describe('isGitRepo handling', () => {
    it('sets isGitRepo to true for valid git repository', async () => {
      mockInvokeResponses.set('get_changed_files', []);
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('get_branch_info', null);

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' })
      );

      await waitFor(() => {
        expect(result.current.loading).toBe(false);
      });

      expect(result.current.isGitRepo).toBe(true);
    });

    it('sets isGitRepo to false when path is not a git repository', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockInvokeResponses.set('get_changed_files', () => {
        const error = { code: 'NOT_GIT_REPO' };
        throw error;
      });
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('get_branch_info', null);

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/not/a/git/repo' })
      );

      // Wait for get_changed_files to be called (async setup must complete first)
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'get_changed_files')).toBe(true);
      });

      // Now wait for isGitRepo to be updated after error handling
      await waitFor(() => {
        expect(result.current.isGitRepo).toBe(false);
      });

      expect(result.current.files).toEqual([]);
      consoleSpy.mockRestore();
    });

    it('sets isGitRepo to false when error message contains "not a git repository"', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockInvokeResponses.set('get_changed_files', () => {
        throw new Error('could not find repository from path');
      });
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('get_branch_info', null);

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/not/a/git/repo' })
      );

      // Wait for get_changed_files to be called (async setup must complete first)
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'get_changed_files')).toBe(true);
      });

      // Now wait for isGitRepo to be updated after error handling
      await waitFor(() => {
        expect(result.current.isGitRepo).toBe(false);
      });

      consoleSpy.mockRestore();
    });

    it('isGitRepo stays true for generic errors', async () => {
      const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
      mockInvokeResponses.set('get_changed_files', () => {
        throw new Error('Network error');
      });
      mockInvokeResponses.set('start_watching', null);
      mockInvokeResponses.set('get_branch_info', null);

      const { result } = renderHook(() =>
        useGitStatus({ id: 'worktree-1', path: '/path/to/worktree' })
      );

      // Wait for get_changed_files to be called and loading to complete
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'get_changed_files')).toBe(true);
        expect(result.current.loading).toBe(false);
      });

      // Generic errors should not set isGitRepo to false
      expect(result.current.isGitRepo).toBe(true);
      consoleSpy.mockRestore();
    });
  });
});

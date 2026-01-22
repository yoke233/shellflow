import { useState, useEffect } from 'react';
import { listen } from '@tauri-apps/api/event';
import { GitMerge, AlertCircle, CheckCircle, Loader2, AlertTriangle } from 'lucide-react';
import { Worktree, MergeFeasibility, MergeStrategy, MergeProgress } from '../types';
import { MergeConfig } from '../hooks/useConfig';
import { checkMergeFeasibility, executeMergeWorkflow, cleanupWorktree } from '../lib/tauri';

interface MergeModalProps {
  worktree: Worktree;
  defaultConfig: MergeConfig;
  onClose: () => void;
  onMergeComplete: (worktreeId: string, deletedWorktree: boolean) => void;
  onModalOpen?: () => void;
  onModalClose?: () => void;
}

export function MergeModal({
  worktree,
  defaultConfig,
  onClose,
  onMergeComplete,
  onModalOpen,
  onModalClose,
}: MergeModalProps) {
  const [feasibility, setFeasibility] = useState<MergeFeasibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [progress, setProgress] = useState<MergeProgress | null>(null);

  // Form state
  const [strategy, setStrategy] = useState<MergeStrategy>(defaultConfig.strategy);
  const [deleteWorktree, setDeleteWorktree] = useState(defaultConfig.deleteWorktree);
  const [deleteLocalBranch, setDeleteLocalBranch] = useState(defaultConfig.deleteLocalBranch);
  const [deleteRemoteBranch, setDeleteRemoteBranch] = useState(defaultConfig.deleteRemoteBranch);

  // Register modal open/close for app-wide tracking
  useEffect(() => {
    onModalOpen?.();
    return () => onModalClose?.();
  }, [onModalOpen, onModalClose]);

  // Fetch feasibility on mount
  useEffect(() => {
    checkMergeFeasibility(worktree.path)
      .then(setFeasibility)
      .catch((err) => setError(err.toString()))
      .finally(() => setLoading(false));
  }, [worktree.path]);

  // Listen for progress events
  useEffect(() => {
    const unlisten = listen<MergeProgress>('merge-progress', (event) => {
      setProgress(event.payload);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  const handleMerge = async () => {
    setExecuting(true);
    setError(null);

    try {
      const result = await executeMergeWorkflow(worktree.id, {
        strategy,
        deleteWorktree,
        deleteLocalBranch,
        deleteRemoteBranch,
      });

      if (result.success) {
        onMergeComplete(worktree.id, deleteWorktree);
      } else {
        setError(result.error || 'Unknown error');
        setExecuting(false);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setExecuting(false);
    }
  };

  const handleCleanup = async () => {
    // Only allow cleanup if at least one option is selected
    if (!deleteWorktree && !deleteLocalBranch && !deleteRemoteBranch) {
      setError('Select at least one cleanup option');
      return;
    }

    setExecuting(true);
    setError(null);

    try {
      await cleanupWorktree(worktree.id, {
        deleteWorktree,
        deleteLocalBranch,
        deleteRemoteBranch,
      });

      onMergeComplete(worktree.id, deleteWorktree);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setExecuting(false);
    }
  };

  const renderStatus = () => {
    if (loading) {
      return (
        <div className="flex items-center gap-2 text-zinc-400">
          <Loader2 size={16} className="animate-spin" />
          Checking merge feasibility...
        </div>
      );
    }

    if (error && !executing) {
      return (
        <div className="flex items-center gap-2 text-red-400">
          <AlertCircle size={16} />
          {error}
        </div>
      );
    }

    if (!feasibility) return null;

    if (feasibility.error) {
      return (
        <div className="flex items-center gap-2 text-yellow-400">
          <AlertTriangle size={16} />
          {feasibility.error}
        </div>
      );
    }

    if (feasibility.hasUncommittedChanges) {
      return (
        <div className="flex items-center gap-2 text-yellow-400">
          <AlertTriangle size={16} />
          Uncommitted changes detected. Commit or stash before merging.
        </div>
      );
    }

    if (feasibility.isUpToDate) {
      return (
        <div className="flex items-center gap-2 text-zinc-400">
          <CheckCircle size={16} />
          Branch is up to date with {feasibility.targetBranch}
        </div>
      );
    }

    if (feasibility.canMerge) {
      return (
        <div className="space-y-2">
          <div className="flex items-center gap-2 text-green-400">
            <CheckCircle size={16} />
            Ready to merge
          </div>
          <div className="text-sm text-zinc-400">
            <span className="font-medium">{feasibility.currentBranch}</span>
            {' → '}
            <span className="font-medium">{feasibility.targetBranch}</span>
            {' • '}
            {feasibility.commitsAhead} commit{feasibility.commitsAhead !== 1 ? 's' : ''} ahead
            {feasibility.commitsBehind > 0 && (
              <>, {feasibility.commitsBehind} behind</>
            )}
            {feasibility.canFastForward && ' • Fast-forward possible'}
          </div>
        </div>
      );
    }

    return null;
  };

  const renderProgress = () => {
    if (!progress) return null;

    const getIcon = () => {
      switch (progress.phase) {
        case 'complete':
          return <CheckCircle size={16} className="text-green-400" />;
        case 'error':
          return <AlertCircle size={16} className="text-red-400" />;
        default:
          return <Loader2 size={16} className="animate-spin" />;
      }
    };

    return (
      <div className="flex items-center gap-2 text-zinc-300 mt-4 p-3 bg-zinc-800/50 rounded">
        {getIcon()}
        {progress.message}
      </div>
    );
  };

  const canExecute = feasibility?.canMerge && !executing && !error;
  const canCleanup = feasibility && !feasibility.canMerge && !feasibility.hasUncommittedChanges && !executing && !error;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={executing ? undefined : onClose} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-6 max-w-lg w-full mx-4">
        <div className="flex items-center gap-3 mb-4">
          <GitMerge size={24} className="text-zinc-400" />
          <h2 className="text-lg font-semibold text-zinc-100">
            Merge {worktree.name}
          </h2>
        </div>

        {/* Status */}
        <div className="mb-6">
          {renderStatus()}
          {executing && renderProgress()}
        </div>

        {/* Options */}
        {feasibility?.canMerge && !executing && (
          <div className="space-y-4 mb-6">
            {/* Strategy selector */}
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Strategy
              </label>
              <div className="flex gap-2">
                <button
                  onClick={() => setStrategy('merge')}
                  className={`flex-1 px-3 py-2 text-sm rounded border ${
                    strategy === 'merge'
                      ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-750'
                  }`}
                >
                  Merge
                </button>
                <button
                  onClick={() => setStrategy('rebase')}
                  className={`flex-1 px-3 py-2 text-sm rounded border ${
                    strategy === 'rebase'
                      ? 'bg-zinc-700 border-zinc-500 text-zinc-100'
                      : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-750'
                  }`}
                >
                  Rebase
                </button>
              </div>
            </div>

            {/* Cleanup options */}
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                After merge
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-zinc-400">
                  <input
                    type="checkbox"
                    checked={deleteWorktree}
                    onChange={(e) => setDeleteWorktree(e.target.checked)}
                    className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-zinc-900"
                  />
                  Delete worktree
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-400">
                  <input
                    type="checkbox"
                    checked={deleteLocalBranch}
                    onChange={(e) => setDeleteLocalBranch(e.target.checked)}
                    className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-zinc-900"
                  />
                  Delete local branch
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-400">
                  <input
                    type="checkbox"
                    checked={deleteRemoteBranch}
                    onChange={(e) => setDeleteRemoteBranch(e.target.checked)}
                    className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-zinc-900"
                  />
                  Delete remote branch
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Cleanup options when nothing to merge */}
        {canCleanup && (
          <div className="space-y-4 mb-6">
            <div>
              <label className="block text-sm font-medium text-zinc-300 mb-2">
                Cleanup options
              </label>
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm text-zinc-400">
                  <input
                    type="checkbox"
                    checked={deleteWorktree}
                    onChange={(e) => setDeleteWorktree(e.target.checked)}
                    className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-zinc-900"
                  />
                  Delete worktree
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-400">
                  <input
                    type="checkbox"
                    checked={deleteLocalBranch}
                    onChange={(e) => setDeleteLocalBranch(e.target.checked)}
                    className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-zinc-900"
                  />
                  Delete local branch
                </label>
                <label className="flex items-center gap-2 text-sm text-zinc-400">
                  <input
                    type="checkbox"
                    checked={deleteRemoteBranch}
                    onChange={(e) => setDeleteRemoteBranch(e.target.checked)}
                    className="rounded border-zinc-600 bg-zinc-800 text-blue-500 focus:ring-blue-500 focus:ring-offset-zinc-900"
                  />
                  Delete remote branch
                </label>
              </div>
            </div>
          </div>
        )}

        {/* Actions */}
        <div className="flex justify-end gap-3">
          <button
            onClick={onClose}
            disabled={executing}
            className="px-4 py-2 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded disabled:opacity-50"
          >
            {executing ? 'Close' : 'Cancel'}
          </button>
          {canExecute && (
            <button
              onClick={handleMerge}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded flex items-center gap-2"
            >
              <GitMerge size={14} />
              {strategy === 'rebase' ? 'Rebase & Merge' : 'Merge'}
            </button>
          )}
          {canCleanup && (deleteWorktree || deleteLocalBranch || deleteRemoteBranch) && (
            <button
              onClick={handleCleanup}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded"
            >
              Clean Up
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

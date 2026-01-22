import { useState, useEffect, useCallback } from 'react';
import { listen } from '@tauri-apps/api/event';
import { GitMerge, AlertCircle, CheckCircle, Loader2, AlertTriangle, Circle, Sparkles } from 'lucide-react';
import { Worktree, MergeFeasibility, MergeStrategy, MergeProgress, MergeCompleted } from '../types';
import { MergeConfig } from '../hooks/useConfig';
import { checkMergeFeasibility, executeMergeWorkflow, cleanupWorktree } from '../lib/tauri';

export interface ActionContext {
  worktreeDir: string;
  worktreeName: string;
  branch: string;
  targetBranch: string;
}

interface MergeModalProps {
  worktree: Worktree;
  projectPath: string;
  defaultConfig: MergeConfig;
  onClose: () => void;
  onMergeComplete: (worktreeId: string, deletedWorktree: boolean) => void;
  onTriggerAction?: (actionType: string, context: ActionContext) => void;
  onModalOpen?: () => void;
  onModalClose?: () => void;
}

interface Step {
  phase: string;
  label: string;
}

export function MergeModal({
  worktree,
  projectPath,
  defaultConfig,
  onClose,
  onMergeComplete,
  onTriggerAction,
  onModalOpen,
  onModalClose,
}: MergeModalProps) {
  const [feasibility, setFeasibility] = useState<MergeFeasibility | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [executing, setExecuting] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [completedPhases, setCompletedPhases] = useState<Set<string>>(new Set());

  // Form state
  const [strategy, setStrategy] = useState<MergeStrategy>(defaultConfig.strategy);
  const [deleteWorktree, setDeleteWorktree] = useState(defaultConfig.deleteWorktree);
  const [deleteLocalBranch, setDeleteLocalBranch] = useState(defaultConfig.deleteLocalBranch);
  const [deleteRemoteBranch, setDeleteRemoteBranch] = useState(defaultConfig.deleteRemoteBranch);

  // Track the steps that will be executed (captured when execution starts)
  const [executionSteps, setExecutionSteps] = useState<Step[]>([]);

  // Register modal open/close for app-wide tracking
  useEffect(() => {
    onModalOpen?.();
    return () => onModalClose?.();
  }, [onModalOpen, onModalClose]);

  // Fetch feasibility on mount
  useEffect(() => {
    checkMergeFeasibility(worktree.path, projectPath)
      .then(setFeasibility)
      .catch((err) => setError(err.toString()))
      .finally(() => setLoading(false));
  }, [worktree.path, projectPath]);

  // Build the list of steps based on current options
  const buildSteps = useCallback((isMerge: boolean, strat: MergeStrategy, delWorktree: boolean, delLocal: boolean, delRemote: boolean): Step[] => {
    const steps: Step[] = [];
    if (isMerge) {
      steps.push({ phase: strat, label: strat === 'rebase' ? 'Rebase' : 'Merge' });
    }
    if (delWorktree) {
      steps.push({ phase: 'delete-worktree', label: 'Delete worktree' });
    }
    if (delLocal) {
      steps.push({ phase: 'delete-local-branch', label: 'Delete local branch' });
    }
    if (delRemote) {
      steps.push({ phase: 'delete-remote-branch', label: 'Delete remote branch' });
    }
    return steps;
  }, []);

  // Listen for progress events
  useEffect(() => {
    const unlisten = listen<MergeProgress>('merge-progress', (event) => {
      const { phase } = event.payload;

      // Mark all phases complete on success
      if (phase === 'complete') {
        setCompletedPhases(new Set(executionSteps.map((s) => s.phase)));
        setCurrentPhase(phase);
        return;
      }

      if (phase === 'error') {
        setCurrentPhase(phase);
        return;
      }

      // Mark all previous phases as completed
      const currentIndex = executionSteps.findIndex((s) => s.phase === phase);
      if (currentIndex > 0) {
        const previousPhases = executionSteps.slice(0, currentIndex).map((s) => s.phase);
        setCompletedPhases(new Set(previousPhases));
      }

      setCurrentPhase(phase);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [executionSteps]);

  // Listen for completion events
  useEffect(() => {
    const unlisten = listen<MergeCompleted>('merge-completed', (event) => {
      const { worktreeId, success, deletedWorktree, error } = event.payload;

      // Only handle events for this worktree
      if (worktreeId !== worktree.id) return;

      if (success) {
        onMergeComplete(worktreeId, deletedWorktree);
      } else {
        setError(error || 'Unknown error');
        setExecuting(false);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [worktree.id, onMergeComplete]);

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  const handleMerge = useCallback(async () => {
    // Capture the steps before starting
    const steps = buildSteps(true, strategy, deleteWorktree, deleteLocalBranch, deleteRemoteBranch);
    setExecutionSteps(steps);
    setCompletedPhases(new Set());
    setCurrentPhase(null);
    setExecuting(true);
    setError(null);

    try {
      // Fire and forget - completion handled by merge-completed event listener
      await executeMergeWorkflow(worktree.id, {
        strategy,
        deleteWorktree,
        deleteLocalBranch,
        deleteRemoteBranch,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setExecuting(false);
    }
  }, [worktree.id, strategy, deleteWorktree, deleteLocalBranch, deleteRemoteBranch, buildSteps]);

  const handleCleanup = useCallback(async () => {
    // Only allow cleanup if at least one option is selected
    if (!deleteWorktree && !deleteLocalBranch && !deleteRemoteBranch) {
      setError('Select at least one cleanup option');
      return;
    }

    // Capture the steps before starting
    const steps = buildSteps(false, strategy, deleteWorktree, deleteLocalBranch, deleteRemoteBranch);
    setExecutionSteps(steps);
    setCompletedPhases(new Set());
    setCurrentPhase(null);
    setExecuting(true);
    setError(null);

    try {
      // Fire and forget - completion handled by merge-completed event listener
      await cleanupWorktree(worktree.id, {
        deleteWorktree,
        deleteLocalBranch,
        deleteRemoteBranch,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setExecuting(false);
    }
  }, [worktree.id, strategy, deleteWorktree, deleteLocalBranch, deleteRemoteBranch, buildSteps]);

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
          Nothing to merge — branch is up to date with {feasibility.targetBranch}
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

  const getStepIcon = (phase: string) => {
    if (completedPhases.has(phase)) {
      return <CheckCircle size={16} className="text-green-400" />;
    }
    if (currentPhase === phase) {
      return <Loader2 size={16} className="animate-spin text-blue-400" />;
    }
    return <Circle size={16} className="text-zinc-600" />;
  };

  const getStepTextClass = (phase: string) => {
    if (completedPhases.has(phase)) {
      return 'text-zinc-400';
    }
    if (currentPhase === phase) {
      return 'text-zinc-100';
    }
    return 'text-zinc-600';
  };

  const renderProgress = () => {
    if (executionSteps.length === 0) return null;

    return (
      <div className="space-y-2 mt-4">
        {executionSteps.map((step) => (
          <div key={step.phase} className="flex items-center gap-3">
            {getStepIcon(step.phase)}
            <span className={`text-sm ${getStepTextClass(step.phase)}`}>
              {step.label}
            </span>
          </div>
        ))}
      </div>
    );
  };

  const canExecute = feasibility?.canMerge && !executing && !error;
  const canCleanup = feasibility && !feasibility.canMerge && !feasibility.isUpToDate && !feasibility.hasUncommittedChanges && !executing && !error;
  const showCleanupButton = canCleanup && (deleteWorktree || deleteLocalBranch || deleteRemoteBranch);

  // Keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !executing) {
        e.preventDefault();
        onClose();
      } else if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
        e.preventDefault();
        if (canExecute) {
          handleMerge();
        } else if (showCleanupButton) {
          handleCleanup();
        }
      }
    };

    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [onClose, executing, canExecute, showCleanupButton, handleMerge, handleCleanup, isMac]);

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
            className="px-4 py-2 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded disabled:opacity-50 inline-flex items-center gap-2"
          >
            {executing ? 'Close' : 'Cancel'}
          </button>
          {/* Show "Resolve with AI" when there's a conflict error */}
          {error && !executing && onTriggerAction && feasibility && error.toLowerCase().includes('conflict') && (
            <button
              onClick={() => {
                onTriggerAction('merge_worktree_with_conflicts', {
                  worktreeDir: worktree.path,
                  worktreeName: worktree.name,
                  branch: feasibility.currentBranch,
                  targetBranch: feasibility.targetBranch,
                });
                onClose();
              }}
              className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded flex items-center gap-2"
            >
              <Sparkles size={14} />
              Resolve with AI
            </button>
          )}
          {canExecute && (
            <button
              onClick={handleMerge}
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded flex items-center gap-2"
            >
              <GitMerge size={14} />
              Merge
            </button>
          )}
          {showCleanupButton && (
            <button
              onClick={handleCleanup}
              className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded inline-flex items-center gap-2"
            >
              Clean Up
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

import { useState, useEffect, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { GitMerge, AlertCircle, CheckCircle, Loader2, AlertTriangle, Circle, Sparkles } from 'lucide-react';
import { Worktree, MergeFeasibility, MergeStrategy, MergeProgress, MergeCompleted } from '../types';
import { MergeConfig } from '../hooks/useConfig';
import { checkMergeFeasibility, executeMergeWorkflow, cleanupWorktree, abortMerge, abortRebase, MergeOptions } from '../lib/tauri';
import { Modal, ModalHeader, ModalBody, ModalActions, ModalButton } from './Modal';

// Re-export for consumers
export type { MergeOptions };

export interface ActionContext {
  worktreeDir: string;
  worktreeName: string;
  branch: string;
  targetBranch: string;
  mergeOptions?: MergeOptions;
  strategy?: MergeStrategy;
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

  const [executionSteps, setExecutionSteps] = useState<Step[]>([]);

  // Fetch feasibility on mount
  useEffect(() => {
    checkMergeFeasibility(worktree.path, projectPath)
      .then(setFeasibility)
      .catch((err) => setError(err.toString()))
      .finally(() => setLoading(false));
  }, [worktree.path, projectPath]);

  const buildSteps = useCallback((isMerge: boolean, strat: MergeStrategy, delWorktree: boolean, delLocal: boolean, delRemote: boolean): Step[] => {
    const steps: Step[] = [];
    if (isMerge) {
      steps.push({ phase: strat, label: strat === 'rebase' ? 'Rebase' : 'Merge' });
    }
    if (delWorktree) steps.push({ phase: 'delete-worktree', label: 'Delete worktree' });
    if (delLocal) steps.push({ phase: 'delete-local-branch', label: 'Delete local branch' });
    if (delRemote) steps.push({ phase: 'delete-remote-branch', label: 'Delete remote branch' });
    return steps;
  }, []);

  // Listen for progress events
  useEffect(() => {
    const unlisten = listen<MergeProgress>('merge-progress', (event) => {
      const { phase } = event.payload;

      if (phase === 'complete') {
        setCompletedPhases(new Set(executionSteps.map((s) => s.phase)));
        setCurrentPhase(phase);
        return;
      }

      if (phase === 'error') {
        setCurrentPhase(phase);
        return;
      }

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

  const handleMerge = useCallback(async () => {
    const steps = buildSteps(true, strategy, deleteWorktree, deleteLocalBranch, deleteRemoteBranch);
    setExecutionSteps(steps);
    setCompletedPhases(new Set());
    setCurrentPhase(null);
    setExecuting(true);
    setError(null);

    try {
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
    if (!deleteWorktree && !deleteLocalBranch && !deleteRemoteBranch) {
      setError('Select at least one cleanup option');
      return;
    }

    const steps = buildSteps(false, strategy, deleteWorktree, deleteLocalBranch, deleteRemoteBranch);
    setExecutionSteps(steps);
    setCompletedPhases(new Set());
    setCurrentPhase(null);
    setExecuting(true);
    setError(null);

    try {
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

  const canExecute = feasibility?.canMerge && !executing && !error;
  const canCleanup = feasibility && !feasibility.canMerge && !feasibility.isUpToDate && !feasibility.hasUncommittedChanges && !executing && !error;
  const showCleanupButton = canCleanup && (deleteWorktree || deleteLocalBranch || deleteRemoteBranch);
  const hasConflict = error && error.toLowerCase().includes('conflict');
  const canResolveWithAI = hasConflict && !executing && onTriggerAction && feasibility;

  // Close with abort when there's a conflict
  const handleClose = useCallback(async () => {
    if (hasConflict) {
      const abortFn = strategy === 'rebase' ? abortRebase : abortMerge;
      const abortPath = strategy === 'rebase' ? worktree.path : projectPath;
      await abortFn(abortPath).catch(() => {});
    }
    onClose();
  }, [hasConflict, projectPath, worktree.path, onClose, strategy]);

  const handleResolveWithAI = useCallback(() => {
    if (!feasibility || !onTriggerAction) return;
    const actionType = strategy === 'rebase'
      ? 'rebase_worktree_with_conflicts'
      : 'merge_worktree_with_conflicts';
    const conflictDir = strategy === 'rebase' ? worktree.path : projectPath;
    onTriggerAction(actionType, {
      worktreeDir: conflictDir,
      worktreeName: worktree.name,
      branch: feasibility.currentBranch,
      targetBranch: feasibility.targetBranch,
      mergeOptions: { deleteWorktree, deleteLocalBranch, deleteRemoteBranch },
      strategy,
    });
    onClose();
  }, [feasibility, onTriggerAction, worktree.name, worktree.path, projectPath, onClose, deleteWorktree, deleteLocalBranch, deleteRemoteBranch, strategy]);

  // Primary action for Cmd+Enter - falls back through available actions
  const submitAction = useMemo(() => {
    if (canExecute) return handleMerge;
    if (canResolveWithAI) return handleResolveWithAI;
    if (showCleanupButton) return handleCleanup;
    return undefined;
  }, [canExecute, canResolveWithAI, showCleanupButton, handleMerge, handleResolveWithAI, handleCleanup]);

  const getStepIcon = (phase: string) => {
    if (completedPhases.has(phase)) return <CheckCircle size={14} className="text-green-400" />;
    if (currentPhase === phase) return <Loader2 size={14} className="animate-spin text-blue-400" />;
    return <Circle size={14} className="text-zinc-600" />;
  };

  const getStepTextClass = (phase: string) => {
    if (completedPhases.has(phase)) return 'text-zinc-400';
    if (currentPhase === phase) return 'text-zinc-100';
    return 'text-zinc-600';
  };

  const renderStatus = () => {
    if (loading) {
      return (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--modal-item-text-muted)' }}>
          <Loader2 size={14} className="animate-spin" />
          Checking merge feasibility...
        </div>
      );
    }

    if (error && !executing) {
      return (
        <div className="flex items-center gap-2 text-[13px] text-red-400">
          <AlertCircle size={14} />
          {error}
        </div>
      );
    }

    if (!feasibility) return null;

    if (feasibility.error) {
      return (
        <div className="flex items-center gap-2 text-[13px] text-yellow-400">
          <AlertTriangle size={14} />
          {feasibility.error}
        </div>
      );
    }

    if (feasibility.hasUncommittedChanges) {
      return (
        <div className="flex items-center gap-2 text-[13px] text-yellow-400">
          <AlertTriangle size={14} />
          Uncommitted changes detected. Commit or stash before merging.
        </div>
      );
    }

    if (feasibility.isUpToDate) {
      return (
        <div className="flex items-center gap-2 text-[13px]" style={{ color: 'var(--modal-item-text-muted)' }}>
          <CheckCircle size={14} />
          Nothing to merge — branch is up to date with {feasibility.targetBranch}
        </div>
      );
    }

    if (feasibility.canMerge) {
      return (
        <div className="space-y-1.5">
          <div className="flex items-center gap-2 text-[13px] text-green-400">
            <CheckCircle size={14} />
            Ready to merge
          </div>
          <div className="text-[12px]" style={{ color: 'var(--modal-item-text-muted)' }}>
            <span className="font-medium">{feasibility.currentBranch}</span>
            {' → '}
            <span className="font-medium">{feasibility.targetBranch}</span>
            {' • '}
            {feasibility.commitsAhead} commit{feasibility.commitsAhead !== 1 ? 's' : ''} ahead
            {feasibility.commitsBehind > 0 && <>, {feasibility.commitsBehind} behind</>}
            {feasibility.canFastForward && ' • Fast-forward possible'}
          </div>
        </div>
      );
    }

    return null;
  };

  const renderProgress = () => {
    if (executionSteps.length === 0) return null;

    return (
      <div className="space-y-1.5 mt-3">
        {executionSteps.map((step) => (
          <div key={step.phase} className="flex items-center gap-2.5">
            {getStepIcon(step.phase)}
            <span className={`text-[13px] ${getStepTextClass(step.phase)}`}>{step.label}</span>
          </div>
        ))}
      </div>
    );
  };

  const renderOptions = () => (
    <div className="space-y-3 mb-5">
      <div>
        <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--modal-item-text-muted)' }}>
          Strategy
        </label>
        <div className="flex gap-1.5">
          {(['merge', 'rebase'] as const).map((s) => (
            <button
              key={s}
              onClick={() => setStrategy(s)}
              className="modal-toggle flex-1 px-2.5 py-1.5 text-[13px] rounded-[4px] border transition-all duration-100"
              style={{
                background: strategy === s ? 'var(--modal-item-highlight)' : 'transparent',
                borderColor: 'var(--modal-input-border)',
                color: strategy === s ? 'var(--modal-item-text)' : 'var(--modal-item-text-muted)',
              }}
            >
              {s.charAt(0).toUpperCase() + s.slice(1)}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--modal-item-text-muted)' }}>
          {feasibility?.canMerge ? 'After merge' : 'Cleanup options'}
        </label>
        <div className="space-y-1.5">
          {[
            { checked: deleteWorktree, onChange: setDeleteWorktree, label: 'Delete worktree' },
            { checked: deleteLocalBranch, onChange: setDeleteLocalBranch, label: 'Delete local branch' },
            { checked: deleteRemoteBranch, onChange: setDeleteRemoteBranch, label: 'Delete remote branch' },
          ].map(({ checked, onChange, label }) => (
            <label key={label} className="flex items-center gap-2 text-[13px] cursor-pointer" style={{ color: 'var(--modal-item-text)' }}>
              <input
                type="checkbox"
                checked={checked}
                onChange={(e) => onChange(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-700/50 text-blue-500 focus:ring-blue-500 focus:ring-offset-zinc-800"
              />
              {label}
            </label>
          ))}
        </div>
      </div>
    </div>
  );

  return (
    <Modal
      onClose={handleClose}
      onSubmit={submitAction}
      onModalOpen={onModalOpen}
      onModalClose={onModalClose}
      closeOnBackdrop={!executing}
      widthClass="max-w-md"
    >
      <ModalHeader icon={<GitMerge size={18} style={{ color: 'var(--modal-item-text-muted)' }} />}>
        Merge {worktree.name}
      </ModalHeader>

      <ModalBody>
        {renderStatus()}
        {executing && renderProgress()}
        {(feasibility?.canMerge || canCleanup) && !executing && renderOptions()}
      </ModalBody>

      <ModalActions>
        <ModalButton onClick={handleClose} disabled={executing}>
          {executing ? 'Close' : 'Cancel'}
        </ModalButton>
        {canResolveWithAI && (
          <ModalButton onClick={handleResolveWithAI} variant="purple" icon={<Sparkles size={13} />}>
            Resolve with AI
          </ModalButton>
        )}
        {canExecute && (
          <ModalButton onClick={handleMerge} variant="primary" icon={<GitMerge size={13} />}>
            {strategy === 'rebase' ? 'Rebase' : 'Merge'}
          </ModalButton>
        )}
        {showCleanupButton && (
          <ModalButton onClick={handleCleanup} variant="danger">
            Clean Up
          </ModalButton>
        )}
      </ModalActions>
    </Modal>
  );
}

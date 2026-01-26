import { useState, useEffect, useCallback, useMemo } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Trash2, AlertCircle, CheckCircle, Loader2, Circle } from 'lucide-react';
import { Worktree, DeleteWorktreeProgress, DeleteWorktreeCompleted } from '../types';
import { executeDeleteWorktreeWorkflow } from '../lib/tauri';
import { Modal, ModalHeader, ModalBody, ModalActions, ModalButton, ModalText } from './Modal';

interface DeleteWorktreeModalProps {
  worktree: Worktree;
  onClose: () => void;
  onDeleteComplete: (worktreeId: string) => void;
  onModalOpen?: () => void;
  onModalClose?: () => void;
}

const STEPS = [
  { phase: 'stop-watcher', label: 'Stop file watcher' },
  { phase: 'remove-worktree', label: 'Remove worktree' },
  { phase: 'save', label: 'Save' },
] as const;

type StepPhase = typeof STEPS[number]['phase'];

function getPhaseIndex(phase: string): number {
  return STEPS.findIndex((s) => s.phase === phase);
}

export function DeleteWorktreeModal({
  worktree,
  onClose,
  onDeleteComplete,
  onModalOpen,
  onModalClose,
}: DeleteWorktreeModalProps) {
  const [executing, setExecuting] = useState(false);
  const [currentPhase, setCurrentPhase] = useState<string | null>(null);
  const [completedPhases, setCompletedPhases] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);

  // Listen for progress events
  useEffect(() => {
    const unlisten = listen<DeleteWorktreeProgress>('delete-worktree-progress', (event) => {
      const { phase } = event.payload;

      if (phase === 'complete') {
        setCompletedPhases(new Set(STEPS.map((s) => s.phase)));
        setCurrentPhase(phase);
        return;
      }

      if (phase === 'error') {
        setCurrentPhase(phase);
        return;
      }

      const currentIndex = getPhaseIndex(phase);
      if (currentIndex > 0) {
        const previousPhases = STEPS.slice(0, currentIndex).map((s) => s.phase);
        setCompletedPhases(new Set(previousPhases));
      }

      setCurrentPhase(phase);
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, []);

  // Listen for completion events
  useEffect(() => {
    const unlisten = listen<DeleteWorktreeCompleted>('delete-worktree-completed', (event) => {
      const { worktreeId, success, error } = event.payload;

      if (worktreeId !== worktree.id) return;

      if (success) {
        onDeleteComplete(worktreeId);
      } else {
        setError(error || 'Unknown error');
        setExecuting(false);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [worktree.id, onDeleteComplete]);

  const handleDelete = useCallback(async () => {
    setExecuting(true);
    setError(null);
    setCompletedPhases(new Set());
    setCurrentPhase(null);

    try {
      await executeDeleteWorktreeWorkflow(worktree.id);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setExecuting(false);
    }
  }, [worktree.id]);

  // Only allow submit when not executing
  const submitAction = useMemo(() => {
    return executing ? undefined : handleDelete;
  }, [executing, handleDelete]);

  const getStepIcon = (phase: StepPhase) => {
    if (completedPhases.has(phase)) {
      return <CheckCircle size={14} className="text-green-400" />;
    }
    if (currentPhase === phase) {
      return <Loader2 size={14} className="animate-spin text-blue-400" />;
    }
    return <Circle size={14} className="text-zinc-600" />;
  };

  const getStepTextClass = (phase: StepPhase) => {
    if (completedPhases.has(phase)) {
      return 'text-zinc-400';
    }
    if (currentPhase === phase) {
      return 'text-zinc-100';
    }
    return 'text-zinc-600';
  };

  return (
    <Modal
      onClose={onClose}
      onSubmit={submitAction}
      onModalOpen={onModalOpen}
      onModalClose={onModalClose}
      closeOnBackdrop={!executing}
    >
      <ModalHeader icon={<Trash2 size={18} className="text-red-400" />}>
        Delete Worktree
      </ModalHeader>

      <ModalBody>
        {!executing && !error && (
          <ModalText muted>
            Are you sure you want to delete "{worktree.name}"? This will remove the worktree and cannot be undone.
          </ModalText>
        )}

        {error && (
          <div className="flex items-center gap-2 text-[13px] text-red-400">
            <AlertCircle size={14} />
            {error}
          </div>
        )}

        {executing && (
          <div className="space-y-1.5">
            {STEPS.map((step) => (
              <div key={step.phase} className="flex items-center gap-2.5">
                {getStepIcon(step.phase)}
                <span className={`text-[13px] ${getStepTextClass(step.phase)}`}>
                  {step.label}
                </span>
              </div>
            ))}
          </div>
        )}
      </ModalBody>

      <ModalActions>
        <ModalButton onClick={onClose} disabled={executing}>Cancel</ModalButton>
        {!executing && (
          <ModalButton onClick={handleDelete} variant="danger" icon={<Trash2 size={13} />}>
            Delete
          </ModalButton>
        )}
      </ModalActions>
    </Modal>
  );
}

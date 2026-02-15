import { useMemo } from 'react';
import { Loader2, Sparkles } from 'lucide-react';
import { Modal, ModalHeader, ModalBody, ModalActions, ModalButton, ModalText } from './Modal';

interface CreateWorktreeModalProps {
  projectName: string;
  worktreeName: string;
  isCreating?: boolean;
  error?: string | null;
  onWorktreeNameChange: (name: string) => void;
  onCreateWithDefault: () => void;
  onCreateWithCustomName: () => void;
  onCancel: () => void;
  onModalOpen?: () => void;
  onModalClose?: () => void;
}

export function CreateWorktreeModal({
  projectName,
  worktreeName,
  isCreating = false,
  error = null,
  onWorktreeNameChange,
  onCreateWithDefault,
  onCreateWithCustomName,
  onCancel,
  onModalOpen,
  onModalClose,
}: CreateWorktreeModalProps) {
  const trimmedName = worktreeName.trim();

  const submitAction = useMemo(() => {
    if (isCreating) return undefined;
    return trimmedName.length > 0 ? onCreateWithCustomName : onCreateWithDefault;
  }, [isCreating, trimmedName.length, onCreateWithCustomName, onCreateWithDefault]);

  return (
    <Modal
      onClose={onCancel}
      onSubmit={submitAction}
      onModalOpen={onModalOpen}
      onModalClose={onModalClose}
      closeOnBackdrop={!isCreating}
    >
      <ModalHeader icon={<Sparkles size={18} className="text-blue-400" />}>
        Create Worktree
      </ModalHeader>

      <ModalBody>
        <ModalText muted>
          Create a new worktree for <span className="font-medium" style={{ color: 'var(--modal-item-text)' }}>{projectName}</span>.
        </ModalText>

        <div className="mt-3">
          <label className="block text-[12px] font-medium mb-1.5" style={{ color: 'var(--modal-item-text-muted)' }}>
            Worktree Name (optional)
          </label>
          <input
            value={worktreeName}
            onChange={(event) => onWorktreeNameChange(event.target.value)}
            placeholder="Leave empty to use default generated name"
            className="w-full px-2.5 py-2 rounded border text-[13px] outline-none transition-colors"
            style={{
              background: 'var(--modal-item-bg)',
              borderColor: 'var(--modal-item-border)',
              color: 'var(--modal-item-text)',
            }}
            disabled={isCreating}
            autoFocus
          />
        </div>

        {error && (
          <div className="mt-3 p-2.5 bg-red-900/20 border border-red-700/50 rounded text-[13px] text-red-300">
            <p className="font-medium mb-1">Failed to create worktree:</p>
            <p className="text-red-400 font-mono text-[11px] break-all">{error}</p>
          </div>
        )}
      </ModalBody>

      <ModalActions>
        <ModalButton onClick={onCreateWithDefault} disabled={isCreating}>
          {isCreating ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Creating...
            </>
          ) : (
            'Use Default Name'
          )}
        </ModalButton>
        <ModalButton
          onClick={onCreateWithCustomName}
          disabled={isCreating || trimmedName.length === 0}
          variant="primary"
        >
          {isCreating ? (
            <>
              <Loader2 size={13} className="animate-spin" />
              Creating...
            </>
          ) : (
            'Create With This Name'
          )}
        </ModalButton>
      </ModalActions>
    </Modal>
  );
}

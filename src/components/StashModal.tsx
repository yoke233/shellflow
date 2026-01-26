import { useMemo } from 'react';
import { Modal, ModalHeader, ModalBody, ModalActions, ModalButton, ModalText } from './Modal';

interface StashModalProps {
  projectName: string;
  onStashAndCreate: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null;
  onModalOpen?: () => void;
  onModalClose?: () => void;
}

export function StashModal({
  projectName,
  onStashAndCreate,
  onCancel,
  isLoading = false,
  error = null,
  onModalOpen,
  onModalClose,
}: StashModalProps) {
  // Only allow submit when not loading
  const submitAction = useMemo(() => {
    return isLoading ? undefined : onStashAndCreate;
  }, [isLoading, onStashAndCreate]);

  return (
    <Modal
      onClose={onCancel}
      onSubmit={submitAction}
      onModalOpen={onModalOpen}
      onModalClose={onModalClose}
      closeOnBackdrop={!isLoading}
    >
      <ModalHeader>Uncommitted Changes</ModalHeader>

      <ModalBody>
        <ModalText muted>
          <span className="font-medium" style={{ color: 'var(--modal-item-text)' }}>{projectName}</span> has uncommitted changes.
          Would you like to stash them before creating the worktree?
        </ModalText>
        <ModalText muted size="xs">
          Your changes will be automatically restored after the worktree is created.
        </ModalText>

        {error && (
          <div className="mt-3 p-2.5 bg-red-900/20 border border-red-700/50 rounded text-[13px] text-red-300">
            <p className="font-medium mb-1">Failed to create worktree:</p>
            <p className="text-red-400 font-mono text-[11px] break-all">{error}</p>
          </div>
        )}
      </ModalBody>

      <ModalActions>
        <ModalButton onClick={onCancel} disabled={isLoading}>Cancel</ModalButton>
        <ModalButton onClick={onStashAndCreate} disabled={isLoading} variant="primary">
          {isLoading ? (
            <>
              <svg className="animate-spin h-3.5 w-3.5" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              Creating...
            </>
          ) : error ? (
            'Retry'
          ) : (
            'Stash & Create'
          )}
        </ModalButton>
      </ModalActions>
    </Modal>
  );
}

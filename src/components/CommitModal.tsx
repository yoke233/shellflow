import { useMemo } from 'react';
import { Modal, ModalHeader, ModalBody, ModalActions, ModalButton, ModalText } from './Modal';

interface CommitModalProps {
  message: string;
  onMessageChange: (value: string) => void;
  branchName: string;
  suggestedBranchName?: string | null;
  currentBranch?: string | null;
  canCreateBranch?: boolean;
  canRenameBranch?: boolean;
  onBranchNameChange: (value: string) => void;
  onCreateBranch: () => void;
  onUseSuggestedBranch?: () => void;
  onGenerate: () => void;
  onCommit: () => void;
  onPushBranch: () => void;
  onMergeToMain: () => void;
  onPushMain: () => void;
  onClose: () => void;
  isBusy?: boolean;
  busyLabel?: string | null;
  error?: string | null;
  hasCommitted?: boolean;
  canMergeToMain?: boolean;
  onModalOpen?: () => void;
  onModalClose?: () => void;
}

export function CommitModal({
  message,
  onMessageChange,
  branchName,
  suggestedBranchName,
  currentBranch,
  canCreateBranch = false,
  canRenameBranch = false,
  onBranchNameChange,
  onCreateBranch,
  onUseSuggestedBranch,
  onGenerate,
  onCommit,
  onPushBranch,
  onMergeToMain,
  onPushMain,
  onClose,
  isBusy = false,
  busyLabel,
  error,
  hasCommitted = false,
  canMergeToMain = true,
  onModalOpen,
  onModalClose,
}: CommitModalProps) {
  const submitAction = useMemo(() => {
    return isBusy ? undefined : onCommit;
  }, [isBusy, onCommit]);
  const showBranchInput = canCreateBranch || canRenameBranch;
  const branchActionLabel = canRenameBranch && !canCreateBranch ? 'Rename branch' : 'Create branch';

  return (
    <Modal
      onClose={onClose}
      onSubmit={submitAction}
      onModalOpen={onModalOpen}
      onModalClose={onModalClose}
      closeOnBackdrop={false}
      widthClass="max-w-2xl"
    >
      <ModalHeader>Commit Changes</ModalHeader>

      <ModalBody>
        <div className="space-y-3">
          <div>
            <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--modal-item-text-muted)' }}>
              Commit message
            </label>
            <textarea
              value={message}
              onChange={(e) => onMessageChange(e.target.value)}
              rows={4}
              disabled={isBusy}
              placeholder="e.g. Add commit modal for git workflow"
              className="w-full text-sm px-2.5 py-2 rounded focus:outline-none placeholder-theme-3 transition-colors resize-none"
              style={{
                background: 'var(--modal-input-bg)',
                border: '1px solid var(--modal-input-border)',
                color: 'var(--modal-item-text)',
              }}
            />
            <ModalText muted size="xs">
              自动生成会先暂存全部改动（git add -A），再用暂存区 diff 生成文案。
            </ModalText>
          </div>

          {showBranchInput ? (
            <div>
              <label className="block text-[12px] font-medium mb-1" style={{ color: 'var(--modal-item-text-muted)' }}>
                Branch name
              </label>
              <input
                value={branchName}
                onChange={(e) => onBranchNameChange(e.target.value)}
                disabled={isBusy}
                placeholder={suggestedBranchName ? `e.g. ${suggestedBranchName}` : 'e.g. feature/my-change'}
                className="w-full text-sm px-2.5 py-2 rounded focus:outline-none placeholder-theme-3 transition-colors"
                style={{
                  background: 'var(--modal-input-bg)',
                  border: '1px solid var(--modal-input-border)',
                  color: 'var(--modal-item-text)',
                }}
              />
              <div className="mt-2 flex items-center justify-between gap-2">
                <ModalText muted size="xs">
                  留空将使用提交信息第一行生成
                  {suggestedBranchName ? `：${suggestedBranchName}` : ''}
                </ModalText>
                <div className="flex items-center gap-2">
                  {onUseSuggestedBranch && (
                    <button
                      onClick={onUseSuggestedBranch}
                      disabled={isBusy || !suggestedBranchName}
                      className="modal-btn px-2.5 py-1 text-[12px] rounded-[4px] border transition-all duration-100 disabled:opacity-40"
                    >
                      Use first line
                    </button>
                  )}
                  <button
                    onClick={onCreateBranch}
                    disabled={isBusy}
                    className="modal-btn px-2.5 py-1 text-[12px] rounded-[4px] border transition-all duration-100 disabled:opacity-40"
                  >
                    {branchActionLabel}
                  </button>
                </div>
              </div>
              {currentBranch && (
                <div className="mt-2">
                  <ModalText muted size="xs">当前分支：{currentBranch}</ModalText>
                </div>
              )}
            </div>
          ) : currentBranch ? (
            <ModalText muted size="xs">
              当前分支：{currentBranch}
            </ModalText>
          ) : null}

          {error && (
            <div
              className="p-2.5 rounded text-[13px]"
              style={{
                background: 'var(--modal-error-bg)',
                border: '1px solid var(--modal-error-border)',
                color: 'var(--modal-error-text)',
              }}
            >
              {error}
            </div>
          )}

          {busyLabel && (
            <ModalText muted size="xs">
              {busyLabel}
            </ModalText>
          )}

          <div className="pt-2" style={{ borderTop: '1px solid var(--modal-footer-border)' }}>
            <ModalText muted size="xs">
              提交后操作
            </ModalText>
            <div className="mt-2 flex flex-wrap gap-2">
              <button
                onClick={onPushBranch}
                disabled={!hasCommitted || isBusy}
                className="modal-btn px-2.5 py-1 text-[12px] rounded-[4px] border transition-all duration-100 disabled:opacity-40"
              >
                推送当前分支
              </button>
              <button
                onClick={onMergeToMain}
                disabled={!hasCommitted || isBusy || !canMergeToMain}
                className="modal-btn px-2.5 py-1 text-[12px] rounded-[4px] border transition-all duration-100 disabled:opacity-40"
              >
                合并到 main（本地）
              </button>
              <button
                onClick={onPushMain}
                disabled={!hasCommitted || isBusy}
                className="modal-btn px-2.5 py-1 text-[12px] rounded-[4px] border transition-all duration-100 disabled:opacity-40"
              >
                推送 main
              </button>
            </div>
          </div>
        </div>
      </ModalBody>

      <ModalActions>
        <ModalButton onClick={onClose} disabled={isBusy}>Cancel</ModalButton>
        <ModalButton onClick={onGenerate} disabled={isBusy}>
          Auto Generate
        </ModalButton>
        <ModalButton onClick={onCommit} disabled={isBusy || !message.trim()} variant="primary">
          {isBusy && !busyLabel ? 'Working...' : 'Commit'}
        </ModalButton>
      </ModalActions>
    </Modal>
  );
}

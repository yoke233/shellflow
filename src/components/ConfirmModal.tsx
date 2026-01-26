import { Modal, ModalHeader, ModalBody, ModalActions, ModalButton, ModalText } from './Modal';

interface ConfirmModalProps {
  title: string;
  message: string;
  confirmLabel?: string;
  onConfirm: () => void;
  onCancel: () => void;
  onModalOpen?: () => void;
  onModalClose?: () => void;
}

export function ConfirmModal({
  title,
  message,
  confirmLabel = 'Delete',
  onConfirm,
  onCancel,
  onModalOpen,
  onModalClose,
}: ConfirmModalProps) {
  return (
    <Modal
      onClose={onCancel}
      onSubmit={onConfirm}
      onModalOpen={onModalOpen}
      onModalClose={onModalClose}
    >
      <ModalHeader>{title}</ModalHeader>
      <ModalBody>
        <ModalText muted>{message}</ModalText>
      </ModalBody>
      <ModalActions>
        <ModalButton onClick={onCancel}>Cancel</ModalButton>
        <ModalButton onClick={onConfirm} variant="danger">{confirmLabel}</ModalButton>
      </ModalActions>
    </Modal>
  );
}

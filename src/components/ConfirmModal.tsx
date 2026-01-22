import { useEffect } from 'react';

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
  // Register modal open/close for app-wide tracking
  useEffect(() => {
    onModalOpen?.();
    return () => onModalClose?.();
  }, [onModalOpen, onModalClose]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={onCancel} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">{title}</h2>
        <p className="text-zinc-400 mb-6">{message}</p>
        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            className="px-4 py-2 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded"
          >
            Cancel
          </button>
          <button
            onClick={onConfirm}
            className="px-4 py-2 text-sm bg-red-600 hover:bg-red-500 text-white rounded"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

import { useCallback, useEffect, useState, useRef, ReactNode } from 'react';

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

interface ModalProps {
  children: ReactNode;
  onClose: () => void;
  /** Called when Cmd/Ctrl+Enter is pressed. Use for primary action. */
  onSubmit?: () => void;
  onModalOpen?: () => void;
  onModalClose?: () => void;
  /** Whether clicking the backdrop should close the modal. Defaults to true. */
  closeOnBackdrop?: boolean;
  /** Width class for the modal. Defaults to 'max-w-sm' */
  widthClass?: string;
}

export function Modal({
  children,
  onClose,
  onSubmit,
  onModalOpen,
  onModalClose,
  closeOnBackdrop = true,
  widthClass = 'max-w-sm',
}: ModalProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const modalRef = useRef<HTMLDivElement>(null);

  // Animate in on mount
  useEffect(() => {
    const timer = requestAnimationFrame(() => setIsVisible(true));
    return () => cancelAnimationFrame(timer);
  }, []);

  // Register modal open/close for app-wide tracking
  useEffect(() => {
    onModalOpen?.();
    return () => onModalClose?.();
  }, [onModalOpen, onModalClose]);

  // Auto-focus modal on mount
  useEffect(() => {
    modalRef.current?.focus();
  }, []);

  // Handle close with animation
  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 100);
  }, [onClose]);

  // Handle clicking outside to close
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (closeOnBackdrop && e.target === e.currentTarget) {
        handleClose();
      }
    },
    [closeOnBackdrop, handleClose]
  );

  // Handle keyboard shortcuts
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Escape to close
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
        return;
      }

      // Cmd/Ctrl+Enter to submit
      if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey) && onSubmit) {
        e.preventDefault();
        e.stopPropagation();
        onSubmit();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [handleClose, onSubmit]);

  const showContent = isVisible && !isClosing;

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center transition-opacity duration-100 ${
        showContent ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleBackdropClick}
    >
      <div
        className="absolute inset-0 backdrop-blur-[2px]"
        style={{ background: 'var(--modal-backdrop)' }}
      />
      <div
        ref={modalRef}
        tabIndex={-1}
        className={`relative backdrop-blur-xl rounded-lg p-5 w-full ${widthClass} mx-4 outline-none transition-all duration-100 max-h-[calc(100vh-48px)] overflow-y-auto ${
          showContent ? 'opacity-100 scale-100' : 'opacity-0 scale-[0.98]'
        }`}
        style={{
          background: 'var(--modal-bg)',
          border: '1px solid var(--modal-border)',
          boxShadow: 'var(--modal-shadow)',
        }}
      >
        {children}
      </div>
    </div>
  );
}

interface ModalHeaderProps {
  children: ReactNode;
  icon?: ReactNode;
}

export function ModalHeader({ children, icon }: ModalHeaderProps) {
  return (
    <div className="flex items-center gap-2.5 mb-3">
      {icon}
      <h2 className="text-[15px] font-semibold" style={{ color: 'var(--modal-item-text)' }}>
        {children}
      </h2>
    </div>
  );
}

interface ModalBodyProps {
  children: ReactNode;
}

export function ModalBody({ children }: ModalBodyProps) {
  return <div className="mb-5">{children}</div>;
}

interface ModalActionsProps {
  children: ReactNode;
}

export function ModalActions({ children }: ModalActionsProps) {
  return <div className="flex justify-end gap-2">{children}</div>;
}

interface ModalButtonProps {
  children: ReactNode;
  onClick: () => void;
  disabled?: boolean;
  variant?: 'secondary' | 'primary' | 'danger' | 'purple';
  icon?: ReactNode;
}

export function ModalButton({
  children,
  onClick,
  disabled = false,
  variant = 'secondary',
  icon,
}: ModalButtonProps) {
  const variantStyles = {
    secondary: {
      background: 'var(--btn-secondary-bg)',
      borderColor: 'var(--btn-secondary-border)',
      color: 'var(--btn-secondary-text)',
      '--hover-bg': 'var(--btn-secondary-bg-hover)',
    },
    primary: {
      background: 'var(--btn-primary-bg)',
      borderColor: 'var(--btn-primary-border)',
      color: 'var(--btn-primary-text)',
      '--hover-bg': 'var(--btn-primary-bg-hover)',
    },
    danger: {
      background: 'var(--btn-danger-bg)',
      borderColor: 'var(--btn-danger-border)',
      color: 'var(--btn-danger-text)',
      '--hover-bg': 'var(--btn-danger-bg-hover)',
    },
    purple: {
      background: 'var(--btn-purple-bg)',
      borderColor: 'var(--btn-purple-border)',
      color: 'var(--btn-purple-text)',
      '--hover-bg': 'var(--btn-purple-bg-hover)',
    },
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="modal-btn px-3 py-1.5 text-[13px] rounded-[4px] border transition-all duration-100 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1.5 font-medium"
      style={variantStyles[variant] as React.CSSProperties}
    >
      {icon}
      {children}
    </button>
  );
}

interface ModalTextProps {
  children: ReactNode;
  muted?: boolean;
  size?: 'sm' | 'xs';
}

export function ModalText({ children, muted = false, size = 'sm' }: ModalTextProps) {
  const sizeClass = size === 'xs' ? 'text-[12px]' : 'text-[13px]';
  return (
    <p
      className={`${sizeClass} leading-relaxed`}
      style={{
        color: muted ? 'var(--modal-item-text-muted)' : 'var(--modal-item-text)',
        opacity: muted && size === 'xs' ? 0.7 : 1,
      }}
    >
      {children}
    </p>
  );
}

import { useCallback, useEffect, useState, useRef, ReactNode } from 'react';

interface ModalContainerProps {
  children: ReactNode;
  onClose: () => void;
  onModalOpen?: () => void;
  onModalClose?: () => void;
  /** Width class for the modal. Defaults to 'max-w-lg' */
  widthClass?: string;
}

export function ModalContainer({
  children,
  onClose,
  onModalOpen,
  onModalClose,
  widthClass = 'max-w-lg',
}: ModalContainerProps) {
  const [isVisible, setIsVisible] = useState(false);
  const [isClosing, setIsClosing] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Capture focus during initial render (before any effects run)
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const didCaptureFocus = useRef(false);
  if (!didCaptureFocus.current) {
    previousFocusRef.current = document.activeElement as HTMLElement | null;
    didCaptureFocus.current = true;
  }

  // Restore focus on unmount
  useEffect(() => {
    const el = previousFocusRef.current;
    return () => {
      if (el && el.isConnected) {
        // Use setTimeout to ensure focus restoration happens after React cleanup
        setTimeout(() => {
          if (el.isConnected) {
            el.focus();
          }
        }, 0);
      }
    };
  }, []);

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

  // Trap focus within the modal - keep input focused
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const handleFocusOut = (e: FocusEvent) => {
      // If focus is leaving the modal, bring it back to the input
      if (!container.contains(e.relatedTarget as Node)) {
        e.preventDefault();
        const input = container.querySelector('input');
        input?.focus();
      }
    };

    container.addEventListener('focusout', handleFocusOut);
    return () => container.removeEventListener('focusout', handleFocusOut);
  }, []);

  // Handle close with animation
  const handleClose = useCallback(() => {
    setIsClosing(true);
    setTimeout(() => {
      onClose();
    }, 100); // Match transition duration
  }, [onClose]);

  // Handle clicking outside to close
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        handleClose();
      }
    },
    [handleClose]
  );

  // Handle escape key for closing
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        handleClose();
      }
    },
    [handleClose]
  );

  const showContent = isVisible && !isClosing;

  return (
    <div
      ref={containerRef}
      tabIndex={-1}
      className={`fixed inset-0 z-50 flex items-start justify-center pt-24 outline-none transition-opacity duration-100 ${
        showContent ? 'opacity-100' : 'opacity-0'
      }`}
      onClick={handleBackdropClick}
      onKeyDown={handleKeyDown}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className={`relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-full ${widthClass} mx-4 overflow-hidden transition-all duration-100 ${
          showContent ? 'opacity-100 scale-100' : 'opacity-0 scale-95'
        }`}
      >
        {children}
      </div>
    </div>
  );
}

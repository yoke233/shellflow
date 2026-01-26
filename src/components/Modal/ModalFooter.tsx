import { ReactNode } from 'react';

interface ModalFooterProps {
  children: ReactNode;
}

export function ModalFooter({ children }: ModalFooterProps) {
  return (
    <div
      className="px-3 py-2 text-[11px] flex justify-between"
      style={{
        background: 'var(--modal-footer-bg)',
        borderTop: '1px solid var(--modal-footer-border)',
        color: 'var(--modal-item-text-muted)',
      }}
    >
      {children}
    </div>
  );
}

interface KeyHintProps {
  keys: string[];
  label: string;
}

export function KeyHint({ keys, label }: KeyHintProps) {
  return (
    <span className="inline-flex items-center gap-1">
      {keys.map((key, i) => (
        <kbd
          key={i}
          className="inline-flex items-center justify-center min-w-[18px] h-[18px] px-1 text-[10px] font-medium rounded"
          style={{
            background: 'var(--kbd-bg)',
            border: '1px solid var(--kbd-border)',
            color: 'var(--kbd-text)',
            boxShadow: '0 1px 0 rgba(0,0,0,0.3)',
          }}
        >
          {key}
        </kbd>
      ))}
      {label && <span style={{ color: 'var(--modal-item-text-muted)' }}>{label}</span>}
    </span>
  );
}

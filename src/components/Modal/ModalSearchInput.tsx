import { useRef, useEffect, forwardRef, useImperativeHandle } from 'react';

interface ModalSearchInputProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  onKeyDown?: (e: React.KeyboardEvent) => void;
}

export interface ModalSearchInputRef {
  focus: () => void;
}

export const ModalSearchInput = forwardRef<ModalSearchInputRef, ModalSearchInputProps>(
  function ModalSearchInput({ value, onChange, placeholder = 'Search...', onKeyDown }, ref) {
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-focus input on mount
    useEffect(() => {
      inputRef.current?.focus();
    }, []);

    // Expose focus method to parent
    useImperativeHandle(ref, () => ({
      focus: () => inputRef.current?.focus(),
    }));

    return (
      <div className="p-2.5" style={{ borderBottom: '1px solid var(--modal-footer-border)' }}>
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full text-sm px-2.5 py-1.5 rounded focus:outline-none placeholder-zinc-500 transition-colors"
          style={{
            background: 'var(--modal-input-bg)',
            border: '1px solid var(--modal-input-border)',
            color: 'var(--modal-item-text)',
          }}
          onFocus={(e) => {
            e.currentTarget.style.borderColor = 'var(--modal-input-focus-border)';
          }}
          onBlur={(e) => {
            e.currentTarget.style.borderColor = 'var(--modal-input-border)';
          }}
        />
      </div>
    );
  }
);

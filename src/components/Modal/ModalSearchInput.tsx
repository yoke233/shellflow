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
      <div className="p-3 border-b border-zinc-700">
        <input
          ref={inputRef}
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder={placeholder}
          className="w-full bg-zinc-800 text-zinc-100 text-sm px-3 py-2 rounded border border-zinc-600 focus:border-zinc-500 focus:outline-none placeholder-zinc-500"
        />
      </div>
    );
  }
);

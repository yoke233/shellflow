import { ReactNode } from 'react';

interface ModalFooterProps {
  children: ReactNode;
}

export function ModalFooter({ children }: ModalFooterProps) {
  return (
    <div className="px-3 py-2 border-t border-zinc-700 text-[10px] text-zinc-500 flex justify-between">
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
    <span>
      {keys.map((key, i) => (
        <kbd key={i} className="px-1 py-0.5 bg-zinc-800 rounded ml-1 first:ml-0">
          {key}
        </kbd>
      ))}
      <span className="ml-1">{label}</span>
    </span>
  );
}

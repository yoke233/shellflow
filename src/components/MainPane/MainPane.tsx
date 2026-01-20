import { Terminal } from 'lucide-react';
import { MainTerminal } from './MainTerminal';
import { TerminalConfig } from '../../hooks/useConfig';

interface MainPaneProps {
  openWorktreeIds: Set<string>;
  activeWorktreeId: string | null;
  terminalConfig: TerminalConfig;
  shouldAutoFocus: boolean;
  onFocus: (worktreeId: string) => void;
}

export function MainPane({
  openWorktreeIds,
  activeWorktreeId,
  terminalConfig,
  shouldAutoFocus,
  onFocus,
}: MainPaneProps) {
  if (openWorktreeIds.size === 0 || !activeWorktreeId) {
    return (
      <div className="flex flex-col h-full bg-zinc-950 text-zinc-500 select-none items-center justify-center">
        <Terminal size={48} className="mb-4 opacity-50" />
        <p className="text-lg">No worktrees open</p>
        <p className="text-sm mt-1">Select a worktree from the sidebar to start</p>
      </div>
    );
  }

  return (
    <div className="h-full bg-zinc-950 relative">
      {Array.from(openWorktreeIds).map((worktreeId) => (
        <div
          key={worktreeId}
          className={`absolute inset-0 ${
            worktreeId === activeWorktreeId
              ? 'visible z-10'
              : 'invisible z-0 pointer-events-none'
          }`}
        >
          <MainTerminal
            worktreeId={worktreeId}
            isActive={worktreeId === activeWorktreeId}
            shouldAutoFocus={worktreeId === activeWorktreeId && shouldAutoFocus}
            terminalConfig={terminalConfig}
            onFocus={() => onFocus(worktreeId)}
          />
        </div>
      ))}
    </div>
  );
}

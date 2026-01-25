import { GitBranch, FolderPlus, Terminal, Keyboard } from 'lucide-react';
import { MainTerminal } from './MainTerminal';
import { TerminalConfig, ConfigError } from '../../hooks/useConfig';
import { ConfigErrorBanner } from '../ConfigErrorBanner';
import { Session, SessionKind } from '../../types';

interface MainPaneProps {
  // Unified session props
  sessions: Session[];
  openSessionIds: Set<string>;
  activeSessionId: string | null;

  // Common props
  terminalConfig: TerminalConfig;
  activityTimeout: number;
  shouldAutoFocus: boolean;
  /** Counter that triggers focus when incremented */
  focusTrigger?: number;
  configErrors: ConfigError[];
  onFocus: (sessionId: string) => void;
  onNotification?: (sessionId: string, title: string, body: string) => void;
  onThinkingChange?: (sessionId: string, isThinking: boolean) => void;
  onCwdChange?: (sessionId: string, cwd: string) => void;

  // Legacy props for backward compatibility during migration
  openWorktreeIds?: Set<string>;
  activeWorktreeId?: string | null;
  openProjectIds?: Set<string>;
  activeProjectId?: string | null;
  activeScratchId?: string | null;
  onWorktreeNotification?: (worktreeId: string, title: string, body: string) => void;
  onWorktreeThinkingChange?: (worktreeId: string, isThinking: boolean) => void;
  onProjectNotification?: (projectId: string, title: string, body: string) => void;
  onProjectThinkingChange?: (projectId: string, isThinking: boolean) => void;
  onScratchNotification?: (scratchId: string, title: string, body: string) => void;
  onScratchThinkingChange?: (scratchId: string, isThinking: boolean) => void;
  onScratchCwdChange?: (scratchId: string, cwd: string) => void;
}

// Map session kind to terminal type
function getTerminalType(kind: SessionKind): 'main' | 'project' | 'scratch' {
  switch (kind) {
    case 'worktree':
      return 'main';
    case 'project':
      return 'project';
    case 'scratch':
      return 'scratch';
  }
}

export function MainPane({
  sessions,
  openSessionIds,
  activeSessionId,
  terminalConfig,
  activityTimeout,
  shouldAutoFocus,
  focusTrigger,
  configErrors,
  onFocus,
  onNotification,
  onThinkingChange,
  onCwdChange,
  // Legacy props
  onWorktreeNotification,
  onWorktreeThinkingChange,
  onProjectNotification,
  onProjectThinkingChange,
  onScratchNotification,
  onScratchThinkingChange,
  onScratchCwdChange,
}: MainPaneProps) {
  const hasOpenSessions = openSessionIds.size > 0;

  if (!hasOpenSessions || !activeSessionId) {
    return (
      <div className="flex flex-col h-full bg-zinc-950 text-zinc-400 select-none items-center justify-center px-8">
        <h1 className="text-2xl font-semibold text-zinc-200 mb-2">Shellflow</h1>
        <p className="text-zinc-500 mb-8 text-center max-w-md">
          The terminal wrapper with worktree orchestration.
        </p>

        <div className="flex flex-col gap-4 text-sm max-w-sm">
          <div className="flex items-start gap-3">
            <FolderPlus size={18} className="text-zinc-500 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-zinc-300">Add a project</span>
              <span className="text-zinc-500"> — open any git repository to get started</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <GitBranch size={18} className="text-zinc-500 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-zinc-300">Create worktrees</span>
              <span className="text-zinc-500"> — each worktree is an isolated branch with its own terminal</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Terminal size={18} className="text-zinc-500 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-zinc-300">Run commands in parallel</span>
              <span className="text-zinc-500"> — switch between worktrees without losing context</span>
            </div>
          </div>
          <div className="flex items-start gap-3">
            <Keyboard size={18} className="text-zinc-500 mt-0.5 flex-shrink-0" />
            <div>
              <span className="text-zinc-300">Use keyboard shortcuts</span>
              <span className="text-zinc-500"> — press </span>
              <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400 text-xs font-mono">⌘⇧P</kbd>
              <span className="text-zinc-500"> for the command palette</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Get open sessions in their defined order
  const openSessions = sessions.filter(s => openSessionIds.has(s.id));

  return (
    <div className="h-full bg-zinc-950 flex flex-col">
      {/* Config error banner */}
      <ConfigErrorBanner errors={configErrors} />

      {/* Terminal container */}
      <div className="flex-1 relative">
        {openSessions.map((session) => {
          const isActive = session.id === activeSessionId;
          const terminalType = getTerminalType(session.kind);

          // Handle notifications - use unified handler or fall back to legacy
          const handleNotification = (title: string, body: string) => {
            if (onNotification) {
              onNotification(session.id, title, body);
            } else {
              // Legacy handlers
              if (session.kind === 'worktree') {
                onWorktreeNotification?.(session.id, title, body);
              } else if (session.kind === 'project') {
                onProjectNotification?.(session.id, title, body);
              } else {
                onScratchNotification?.(session.id, title, body);
              }
            }
          };

          // Handle thinking changes - use unified handler or fall back to legacy
          const handleThinkingChange = (isThinking: boolean) => {
            if (onThinkingChange) {
              onThinkingChange(session.id, isThinking);
            } else {
              // Legacy handlers
              if (session.kind === 'worktree') {
                onWorktreeThinkingChange?.(session.id, isThinking);
              } else if (session.kind === 'project') {
                onProjectThinkingChange?.(session.id, isThinking);
              } else {
                onScratchThinkingChange?.(session.id, isThinking);
              }
            }
          };

          // Handle cwd changes - only for scratch terminals
          const handleCwdChange = session.kind === 'scratch'
            ? (cwd: string) => {
                if (onCwdChange) {
                  onCwdChange(session.id, cwd);
                } else {
                  onScratchCwdChange?.(session.id, cwd);
                }
              }
            : undefined;

          return (
            <div
              key={session.id}
              className={`absolute inset-0 ${
                isActive
                  ? 'visible z-10'
                  : 'invisible z-0 pointer-events-none'
              }`}
            >
              <MainTerminal
                entityId={session.id}
                type={terminalType}
                isActive={isActive}
                shouldAutoFocus={isActive && shouldAutoFocus}
                focusTrigger={isActive ? focusTrigger : undefined}
                terminalConfig={terminalConfig}
                activityTimeout={activityTimeout}
                onFocus={() => onFocus(session.id)}
                onNotification={handleNotification}
                onThinkingChange={handleThinkingChange}
                onCwdChange={handleCwdChange}
              />
            </div>
          );
        })}
      </div>
    </div>
  );
}

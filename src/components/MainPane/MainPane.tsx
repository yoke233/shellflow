import { GitBranch, FolderPlus, Terminal, Keyboard } from 'lucide-react';
import { MainTerminal } from './MainTerminal';
import { TerminalConfig, MappingsConfig, ConfigError } from '../../hooks/useConfig';
import { ConfigErrorBanner } from '../ConfigErrorBanner';
import { ScratchTerminal } from '../../types';

interface MainPaneProps {
  // Worktree terminals
  openWorktreeIds: Set<string>;
  activeWorktreeId: string | null;
  // Project terminals
  openProjectIds: Set<string>;
  activeProjectId: string | null;
  // Scratch terminals
  scratchTerminals: ScratchTerminal[];
  activeScratchId: string | null;
  // Common props
  terminalConfig: TerminalConfig;
  mappings: MappingsConfig;
  activityTimeout: number;
  shouldAutoFocus: boolean;
  configErrors: ConfigError[];
  onFocus: (entityId: string) => void;
  onWorktreeNotification?: (worktreeId: string, title: string, body: string) => void;
  onWorktreeThinkingChange?: (worktreeId: string, isThinking: boolean) => void;
  onProjectNotification?: (projectId: string, title: string, body: string) => void;
  onProjectThinkingChange?: (projectId: string, isThinking: boolean) => void;
  onScratchNotification?: (scratchId: string, title: string, body: string) => void;
  onScratchThinkingChange?: (scratchId: string, isThinking: boolean) => void;
  onScratchCwdChange?: (scratchId: string, cwd: string) => void;
}

export function MainPane({
  openWorktreeIds,
  activeWorktreeId,
  openProjectIds,
  activeProjectId,
  scratchTerminals,
  activeScratchId,
  terminalConfig,
  mappings,
  activityTimeout,
  shouldAutoFocus,
  configErrors,
  onFocus,
  onWorktreeNotification,
  onWorktreeThinkingChange,
  onProjectNotification,
  onProjectThinkingChange,
  onScratchNotification,
  onScratchThinkingChange,
  onScratchCwdChange,
}: MainPaneProps) {
  // Determine the active entity (worktree takes precedence, then scratch, then project)
  const activeEntityId = activeWorktreeId ?? activeScratchId ?? activeProjectId;
  const hasOpenEntities = openWorktreeIds.size > 0 || openProjectIds.size > 0 || scratchTerminals.length > 0;

  if (!hasOpenEntities || !activeEntityId) {
    return (
      <div className="flex flex-col h-full bg-zinc-950 text-zinc-400 select-none items-center justify-center px-8">
        <h1 className="text-2xl font-semibold text-zinc-200 mb-2">One Man Band</h1>
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

  return (
    <div className="h-full bg-zinc-950 flex flex-col">
      {/* Config error banner */}
      <ConfigErrorBanner errors={configErrors} />

      {/* Terminal container */}
      <div className="flex-1 relative">
      {/* Render worktree terminals */}
      {Array.from(openWorktreeIds).map((worktreeId) => (
        <div
          key={worktreeId}
          className={`absolute inset-0 ${
            worktreeId === activeEntityId
              ? 'visible z-10'
              : 'invisible z-0 pointer-events-none'
          }`}
        >
          <MainTerminal
            entityId={worktreeId}
            type="main"
            isActive={worktreeId === activeEntityId}
            shouldAutoFocus={worktreeId === activeEntityId && shouldAutoFocus}
            terminalConfig={terminalConfig}
            mappings={mappings}
            activityTimeout={activityTimeout}
            onFocus={() => onFocus(worktreeId)}
            onNotification={(title, body) => onWorktreeNotification?.(worktreeId, title, body)}
            onThinkingChange={(isThinking) => onWorktreeThinkingChange?.(worktreeId, isThinking)}
          />
        </div>
      ))}
      {/* Render project terminals */}
      {Array.from(openProjectIds).map((projectId) => (
        <div
          key={`project-${projectId}`}
          className={`absolute inset-0 ${
            !activeWorktreeId && !activeScratchId && projectId === activeEntityId
              ? 'visible z-10'
              : 'invisible z-0 pointer-events-none'
          }`}
        >
          <MainTerminal
            entityId={projectId}
            type="project"
            isActive={!activeWorktreeId && !activeScratchId && projectId === activeEntityId}
            shouldAutoFocus={!activeWorktreeId && !activeScratchId && projectId === activeEntityId && shouldAutoFocus}
            terminalConfig={terminalConfig}
            mappings={mappings}
            activityTimeout={activityTimeout}
            onFocus={() => onFocus(projectId)}
            onNotification={(title, body) => onProjectNotification?.(projectId, title, body)}
            onThinkingChange={(isThinking) => onProjectThinkingChange?.(projectId, isThinking)}
          />
        </div>
      ))}
      {/* Render scratch terminals */}
      {scratchTerminals.map((scratch) => (
        <div
          key={`scratch-${scratch.id}`}
          className={`absolute inset-0 ${
            scratch.id === activeScratchId
              ? 'visible z-10'
              : 'invisible z-0 pointer-events-none'
          }`}
        >
          <MainTerminal
            entityId={scratch.id}
            type="scratch"
            isActive={scratch.id === activeScratchId}
            shouldAutoFocus={scratch.id === activeScratchId && shouldAutoFocus}
            terminalConfig={terminalConfig}
            mappings={mappings}
            activityTimeout={activityTimeout}
            onFocus={() => onFocus(scratch.id)}
            onNotification={(title, body) => onScratchNotification?.(scratch.id, title, body)}
            onThinkingChange={(isThinking) => onScratchThinkingChange?.(scratch.id, isThinking)}
            onCwdChange={(cwd) => onScratchCwdChange?.(scratch.id, cwd)}
          />
        </div>
      ))}
      </div>
    </div>
  );
}

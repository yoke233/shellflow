import { Terminal } from 'lucide-react';
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
}: MainPaneProps) {
  // Determine the active entity (worktree takes precedence, then scratch, then project)
  const activeEntityId = activeWorktreeId ?? activeScratchId ?? activeProjectId;
  const hasOpenEntities = openWorktreeIds.size > 0 || openProjectIds.size > 0 || scratchTerminals.length > 0;

  if (!hasOpenEntities || !activeEntityId) {
    return (
      <div className="flex flex-col h-full bg-zinc-950 text-zinc-500 select-none items-center justify-center">
        <Terminal size={48} className="mb-4 opacity-50" />
        <p className="text-lg">No worktrees open</p>
        <p className="text-sm mt-1">Select a worktree from the sidebar to start</p>
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
          />
        </div>
      ))}
      </div>
    </div>
  );
}

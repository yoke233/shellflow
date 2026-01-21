import { Terminal } from 'lucide-react';
import { ProjectTerminal } from './ProjectTerminal';
import { TerminalConfig, MappingsConfig } from '../../hooks/useConfig';

interface ProjectPaneProps {
  openProjectIds: Set<string>;
  activeProjectId: string | null;
  isVisible: boolean; // Whether the project pane itself is visible (vs worktree pane)
  terminalConfig: TerminalConfig;
  mappings: MappingsConfig;
  onFocus: (projectId: string) => void;
}

export function ProjectPane({
  openProjectIds,
  activeProjectId,
  isVisible,
  terminalConfig,
  mappings,
  onFocus,
}: ProjectPaneProps) {
  if (openProjectIds.size === 0 || !activeProjectId) {
    return (
      <div className="flex flex-col h-full bg-zinc-950 text-zinc-500 select-none items-center justify-center">
        <Terminal size={48} className="mb-4 opacity-50" />
        <p className="text-lg">No project selected</p>
        <p className="text-sm mt-1">Click on a project name to open a shell</p>
      </div>
    );
  }

  return (
    <div className="h-full bg-zinc-950 relative">
      {Array.from(openProjectIds).map((projectId) => {
        const isThisProjectActive = projectId === activeProjectId && isVisible;
        return (
          <div
            key={projectId}
            className={`absolute inset-0 ${
              projectId === activeProjectId
                ? 'visible z-10'
                : 'invisible z-0 pointer-events-none'
            }`}
          >
            <ProjectTerminal
              projectId={projectId}
              isActive={isThisProjectActive}
              shouldAutoFocus={isThisProjectActive}
              terminalConfig={terminalConfig}
              mappings={mappings}
              onFocus={() => onFocus(projectId)}
            />
          </div>
        );
      })}
    </div>
  );
}

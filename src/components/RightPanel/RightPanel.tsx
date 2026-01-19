import { Group as PanelGroup, Panel, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { ChangedFiles } from './ChangedFiles';
import { Terminal } from './Terminal';
import { Workspace, FileChange } from '../../types';
import { TerminalConfig } from '../../hooks/useConfig';

interface RightPanelProps {
  workspace: Workspace | null;
  changedFiles: FileChange[];
  terminalConfig: TerminalConfig;
}

export function RightPanel({ workspace, changedFiles, terminalConfig }: RightPanelProps) {
  if (!workspace) {
    return (
      <div className="h-full bg-zinc-900 border-l border-zinc-800 flex flex-col text-zinc-500 text-sm">
        <div className="flex-1 flex items-center justify-center">
          Select a workspace
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-zinc-900 border-l border-zinc-800 flex flex-col">
      <PanelGroup
        orientation="vertical"
        className="flex-1"
        onLayoutChange={() => { window.dispatchEvent(new Event('resize')); }}
      >
        <Panel defaultSize="50%" minSize="20%">
          <div className="h-full w-full overflow-hidden">
            <ChangedFiles files={changedFiles} />
          </div>
        </Panel>
        <PanelResizeHandle className="h-px bg-zinc-800 hover:bg-zinc-600 transition-colors focus:outline-none cursor-row-resize" />
        <Panel defaultSize="50%" minSize="20%">
          <div className="h-full w-full overflow-hidden">
            <Terminal workspace={workspace} terminalConfig={terminalConfig} />
          </div>
        </Panel>
      </PanelGroup>
    </div>
  );
}

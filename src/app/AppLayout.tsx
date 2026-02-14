import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, PanelImperativeHandle } from 'react-resizable-panels';
import type { ComponentProps, RefObject } from 'react';
import { Sidebar } from '../components/Sidebar/Sidebar';
import { MainPane } from '../components/MainPane/MainPane';
import { RightPanel } from '../components/RightPanel/RightPanel';
import { DeleteWorktreeModal } from '../components/DeleteWorktreeModal';
import { ConfirmModal } from '../components/ConfirmModal';
import { MergeModal } from '../components/MergeModal';
import { StashModal } from '../components/StashModal';
import { CommitModal } from '../components/CommitModal';
import { ShutdownScreen } from '../components/ShutdownScreen';
import { TaskSwitcher } from '../components/TaskSwitcher/TaskSwitcher';
import { CommandPalette } from '../components/CommandPalette';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { ProjectSwitcher } from '../components/ProjectSwitcher';
import { AppearanceSettingsModal } from '../components/Settings/AppearanceSettingsModal';
import { ToastContainer } from '../components/Toast';
import type { ToastData } from '../components/Toast';
import { ThemeProvider } from '../theme';
import type { ThemeBorderStyle, ThemeConfig } from '../theme';
import type { Config } from '../hooks/useConfig';
import type { Project, Worktree } from '../types';
import type { ActionPromptContext } from '../lib/tauri';

type SidebarProps = ComponentProps<typeof Sidebar>;
type MainPaneProps = ComponentProps<typeof MainPane>;
type RightPanelProps = ComponentProps<typeof RightPanel>;
type TaskSwitcherProps = ComponentProps<typeof TaskSwitcher>;
type CommandPaletteProps = ComponentProps<typeof CommandPalette>;
type ProjectSwitcherProps = ComponentProps<typeof ProjectSwitcher>;
type ThemeSwitcherProps = ComponentProps<typeof ThemeSwitcher>;
type AppearanceSettingsProps = ComponentProps<typeof AppearanceSettingsModal>;

type PanelRef = RefObject<PanelImperativeHandle | null>;

interface AppLayoutThemeProps {
  themeConfig?: ThemeConfig;
  borderStyle: ThemeBorderStyle;
  onThemeChange?: (themeName: string) => void;
  onBorderStyleChange?: (style: ThemeBorderStyle) => void;
}

interface AppLayoutOverlaysProps {
  isShuttingDown: boolean;
  pendingDeleteInfo: { worktree: Worktree; projectPath: string } | null;
  pendingCloseProject: Project | null;
  pendingMergeInfo: { worktree: Worktree; projectPath: string } | null;
  pendingStashProject: Project | null;
  showCommitModal: boolean;
  commitModalProps: ComponentProps<typeof CommitModal>;
  stashError: string | null;
  isStashing: boolean;
  onClearPendingDelete: () => void;
  onClearPendingCloseProject: () => void;
  onClearPendingMerge: () => void;
  onDeleteComplete: (worktreeId: string) => void;
  onConfirmCloseProject: () => void;
  onMergeComplete: (worktreeId: string, deletedWorktree: boolean) => void;
  onTriggerAction: (
    worktreeId: string,
    projectPath: string,
    actionType: string,
    context: ActionPromptContext
  ) => void;
  onStashAndCreate: () => void;
  onCancelStash: () => void;
  onModalOpen: () => void;
  onModalClose: () => void;
}

interface AppLayoutPickersProps {
  showTaskSwitcher: boolean;
  taskSwitcherProps: TaskSwitcherProps;
  showCommandPalette: boolean;
  commandPaletteProps: CommandPaletteProps;
  showProjectSwitcher: boolean;
  projectSwitcherProps: ProjectSwitcherProps;
  showThemeSwitcher: boolean;
  themeSwitcherProps: ThemeSwitcherProps;
  showAppearanceSettings: boolean;
  appearanceSettingsProps: AppearanceSettingsProps;
}

interface AppLayoutPanelsProps {
  sidebarProps: SidebarProps;
  mainPaneProps: MainPaneProps;
  rightPanelProps: RightPanelProps;
  rightPanelRef: PanelRef;
  isRightPanelOpen: boolean;
  onRightPanelResize: (size: { inPixels: number }) => void;
}

interface AppLayoutToastsProps {
  items: ToastData[];
  onDismiss: (id: string) => void;
}

interface AppLayoutProps {
  theme: AppLayoutThemeProps;
  config: Config;
  overlays: AppLayoutOverlaysProps;
  pickers: AppLayoutPickersProps;
  layout: AppLayoutPanelsProps;
  toasts: AppLayoutToastsProps;
}

export function AppLayout({ theme, config, overlays, pickers, layout, toasts }: AppLayoutProps) {
  const {
    isShuttingDown,
    pendingDeleteInfo,
    pendingCloseProject,
    pendingMergeInfo,
    pendingStashProject,
    showCommitModal,
    commitModalProps,
    stashError,
    isStashing,
    onClearPendingDelete,
    onClearPendingCloseProject,
    onClearPendingMerge,
    onDeleteComplete,
    onConfirmCloseProject,
    onMergeComplete,
    onTriggerAction,
    onStashAndCreate,
    onCancelStash,
    onModalOpen,
    onModalClose,
  } = overlays;

  const {
    showTaskSwitcher,
    taskSwitcherProps,
    showCommandPalette,
    commandPaletteProps,
    showProjectSwitcher,
    projectSwitcherProps,
    showThemeSwitcher,
    themeSwitcherProps,
    showAppearanceSettings,
    appearanceSettingsProps,
  } = pickers;

  const {
    sidebarProps,
    mainPaneProps,
    rightPanelProps,
    rightPanelRef,
    isRightPanelOpen,
    onRightPanelResize,
  } = layout;

  const { items: toastItems, onDismiss: onDismissToast } = toasts;

  return (
    <ThemeProvider
      themeConfig={theme.themeConfig}
      borderStyle={theme.borderStyle}
      onThemeChange={theme.onThemeChange}
      onBorderStyleChange={theme.onBorderStyleChange}
    >
      <div className="h-screen w-screen overflow-hidden flex flex-col">
        <ShutdownScreen isVisible={isShuttingDown} />

        {pendingDeleteInfo && (
          <DeleteWorktreeModal
            worktree={pendingDeleteInfo.worktree}
            projectPath={pendingDeleteInfo.projectPath}
            defaultConfig={config.worktree.delete}
            onClose={onClearPendingDelete}
            onDeleteComplete={onDeleteComplete}
            onModalOpen={onModalOpen}
            onModalClose={onModalClose}
          />
        )}

        {pendingCloseProject && (
          <ConfirmModal
            title="Close Project"
            message={`Are you sure you want to close "${pendingCloseProject.name}"?`}
            confirmLabel="Close"
            onConfirm={onConfirmCloseProject}
            onCancel={onClearPendingCloseProject}
            onModalOpen={onModalOpen}
            onModalClose={onModalClose}
          />
        )}

        {pendingMergeInfo && (
          <MergeModal
            worktree={pendingMergeInfo.worktree}
            projectPath={pendingMergeInfo.projectPath}
            defaultConfig={config.worktree.merge}
            onClose={onClearPendingMerge}
            onMergeComplete={onMergeComplete}
            onTriggerAction={(actionType, context) => {
              onTriggerAction(
                pendingMergeInfo.worktree.id,
                pendingMergeInfo.projectPath,
                actionType,
                context
              );
            }}
            onModalOpen={onModalOpen}
            onModalClose={onModalClose}
          />
        )}

        {pendingStashProject && (
          <StashModal
            projectName={pendingStashProject.name}
            onStashAndCreate={onStashAndCreate}
            onCancel={onCancelStash}
            isLoading={isStashing}
            error={stashError}
            onModalOpen={onModalOpen}
            onModalClose={onModalClose}
          />
        )}

        {showCommitModal && (
          <CommitModal {...commitModalProps} />
        )}

        {showTaskSwitcher && (
          <TaskSwitcher {...taskSwitcherProps} />
        )}

        {showCommandPalette && (
          <CommandPalette {...commandPaletteProps} />
        )}

        {showProjectSwitcher && (
          <ProjectSwitcher {...projectSwitcherProps} />
        )}

        {showThemeSwitcher && (
          <ThemeSwitcher {...themeSwitcherProps} />
        )}

        {showAppearanceSettings && (
          <AppearanceSettingsModal {...appearanceSettingsProps} />
        )}

        <PanelGroup orientation="horizontal" className="flex-1">
          <Panel defaultSize="230px" minSize="180px" maxSize="420px">
            <div className="h-full w-full overflow-hidden">
              <Sidebar {...sidebarProps} />
            </div>
          </Panel>

          <PanelResizeHandle className="w-px bg-resize-handle hover:bg-resize-handle-hover transition-colors focus:outline-none cursor-col-resize" />

          <Panel minSize="300px">
            <div className="h-full">
              <MainPane {...mainPaneProps} />
            </div>
          </Panel>

          <PanelResizeHandle
            className={`w-px transition-colors focus:outline-none cursor-col-resize ${
              isRightPanelOpen
                ? 'bg-resize-handle hover:bg-resize-handle-hover'
                : 'bg-transparent pointer-events-none'
            }`}
          />
          <Panel
            panelRef={rightPanelRef}
            defaultSize="0px"
            minSize="150px"
            maxSize="450px"
            collapsible
            collapsedSize="0px"
            onResize={onRightPanelResize}
          >
            <div className="h-full w-full overflow-hidden">
              <RightPanel {...rightPanelProps} />
            </div>
          </Panel>
        </PanelGroup>

        <ToastContainer toasts={toastItems} onDismiss={onDismissToast} />
      </div>
    </ThemeProvider>
  );
}

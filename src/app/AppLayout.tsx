import { Group as PanelGroup, Panel, Separator as PanelResizeHandle, PanelImperativeHandle } from 'react-resizable-panels';
import type { ComponentProps, RefObject } from 'react';
import { Sidebar } from '../components/Sidebar/Sidebar';
import { MainPane } from '../components/MainPane/MainPane';
import { RightPanel } from '../components/RightPanel/RightPanel';
import { Drawer, DrawerTab } from '../components/Drawer/Drawer';
import { DrawerTerminal } from '../components/Drawer/DrawerTerminal';
import { TaskTerminal } from '../components/Drawer/TaskTerminal';
import { ActionTerminal } from '../components/Drawer/ActionTerminal';
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
import type { Config, TerminalConfig } from '../hooks/useConfig';
import type { Project, Worktree } from '../types';
import type { ActionPromptContext } from '../lib/tauri';

type SidebarProps = ComponentProps<typeof Sidebar>;
type MainPaneProps = ComponentProps<typeof MainPane>;
type DrawerProps = ComponentProps<typeof Drawer>;
type RightPanelProps = ComponentProps<typeof RightPanel>;
type TaskSwitcherProps = ComponentProps<typeof TaskSwitcher>;
type CommandPaletteProps = ComponentProps<typeof CommandPalette>;
type ProjectSwitcherProps = ComponentProps<typeof ProjectSwitcher>;
type ThemeSwitcherProps = ComponentProps<typeof ThemeSwitcher>;
type AppearanceSettingsProps = ComponentProps<typeof AppearanceSettingsModal>;

type PanelRef = RefObject<PanelImperativeHandle | null>;

type FocusedPane = 'main' | 'drawer';

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
  drawerProps: DrawerProps;
  rightPanelProps: RightPanelProps;
  mainPanelRef: PanelRef;
  drawerPanelRef: PanelRef;
  rightPanelRef: PanelRef;
  isDrawerOpen: boolean;
  isDrawerExpanded: boolean;
  isRightPanelOpen: boolean;
  activeEntityId: string | null;
  activeDrawerTabId: string | null;
  activeFocusState: FocusedPane;
  drawerTabs: Map<string, DrawerTab[]>;
  drawerTerminalConfig: TerminalConfig;
  getEntityDirectory: (entityId: string) => string | undefined;
  onTaskPtyIdReady: (entityId: string, taskName: string, ptyId: string) => void;
  onTaskExit: (entityId: string, taskName: string, exitCode: number) => void;
  onDrawerFocused: (entityId: string) => void;
  onCloseDrawerTab: (tabId: string, entityId?: string) => void;
  onDrawerPtyIdReady: (tabId: string, ptyId: string) => void;
  onDrawerTabTitleChange: (entityId: string, tabId: string, title: string) => void;
  onDrawerResize: (size: { inPixels: number }) => void;
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
    drawerProps,
    rightPanelProps,
    mainPanelRef,
    drawerPanelRef,
    rightPanelRef,
    isDrawerOpen,
    isDrawerExpanded,
    isRightPanelOpen,
    activeEntityId,
    activeDrawerTabId,
    activeFocusState,
    drawerTabs,
    drawerTerminalConfig,
    getEntityDirectory,
    onTaskPtyIdReady,
    onTaskExit,
    onDrawerFocused,
    onCloseDrawerTab,
    onDrawerPtyIdReady,
    onDrawerTabTitleChange,
    onDrawerResize,
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
            <PanelGroup orientation="vertical" className="h-full">
              <Panel panelRef={mainPanelRef} minSize="0px" collapsible collapsedSize="0px">
                <div
                  className="h-full transition-opacity duration-150"
                  style={{
                    opacity:
                      isDrawerOpen && activeFocusState === 'drawer'
                        ? (config.main.unfocusedOpacity ?? config.panes.unfocusedOpacity)
                        : 1,
                  }}
                >
                  <MainPane {...mainPaneProps} />
                </div>
              </Panel>

              <PanelResizeHandle
                className={`transition-colors focus:outline-none !cursor-row-resize ${
                  isDrawerOpen && !isDrawerExpanded
                    ? 'h-px bg-resize-handle hover:bg-resize-handle-hover'
                    : 'h-0 pointer-events-none'
                }`}
              />
              <Panel
                panelRef={drawerPanelRef}
                defaultSize="0px"
                minSize="100px"
                maxSize={isDrawerExpanded ? '100%' : '70%'}
                collapsible
                collapsedSize="0px"
                onResize={onDrawerResize}
              >
                <div
                  className="h-full overflow-hidden transition-opacity duration-150"
                  style={{
                    opacity: isDrawerOpen && activeFocusState !== 'drawer'
                      ? config.drawer.unfocusedOpacity
                      : 1,
                  }}
                >
                  <Drawer {...drawerProps}>
                    {Array.from(drawerTabs.entries()).flatMap(([entityId, tabs]) =>
                      tabs.map((tab) => (
                        <div
                          key={tab.id}
                          className={`absolute inset-0 ${
                            entityId === activeEntityId &&
                            isDrawerOpen &&
                            tab.id === activeDrawerTabId
                              ? 'z-10'
                              : 'opacity-0 z-0 pointer-events-none'
                          }`}
                        >
                          {tab.type === 'task' && tab.taskName ? (
                            <TaskTerminal
                              id={tab.id}
                              entityId={entityId}
                              taskName={tab.taskName}
                              isActive={
                                entityId === activeEntityId &&
                                isDrawerOpen &&
                                tab.id === activeDrawerTabId &&
                                activeFocusState === 'drawer'
                              }
                              shouldAutoFocus={
                                entityId === activeEntityId &&
                                isDrawerOpen &&
                                tab.id === activeDrawerTabId &&
                                activeFocusState === 'drawer'
                              }
                              terminalConfig={drawerTerminalConfig}
                              onPtyIdReady={(ptyId) => onTaskPtyIdReady(entityId, tab.taskName!, ptyId)}
                              onTaskExit={(exitCode) => onTaskExit(entityId, tab.taskName!, exitCode)}
                              onFocus={() => onDrawerFocused(entityId)}
                            />
                          ) : tab.type === 'action' && tab.actionPrompt ? (
                            <ActionTerminal
                              id={tab.id}
                              worktreeId={entityId}
                              actionType={tab.actionType}
                              actionPrompt={tab.actionPrompt}
                              mergeOptions={tab.mergeOptions}
                              strategy={tab.strategy}
                              isActive={
                                entityId === activeEntityId &&
                                isDrawerOpen &&
                                tab.id === activeDrawerTabId &&
                                activeFocusState === 'drawer'
                              }
                              shouldAutoFocus={
                                entityId === activeEntityId &&
                                isDrawerOpen &&
                                tab.id === activeDrawerTabId &&
                                activeFocusState === 'drawer'
                              }
                              terminalConfig={drawerTerminalConfig}
                              onFocus={() => onDrawerFocused(entityId)}
                            />
                          ) : (
                            <DrawerTerminal
                              id={tab.id}
                              entityId={entityId}
                              directory={tab.directory ?? getEntityDirectory(entityId)}
                              command={tab.command}
                              isActive={
                                entityId === activeEntityId &&
                                isDrawerOpen &&
                                tab.id === activeDrawerTabId &&
                                activeFocusState === 'drawer'
                              }
                              shouldAutoFocus={
                                entityId === activeEntityId &&
                                isDrawerOpen &&
                                tab.id === activeDrawerTabId &&
                                activeFocusState === 'drawer'
                              }
                              terminalConfig={drawerTerminalConfig}
                              onClose={() => onCloseDrawerTab(tab.id, entityId)}
                              onFocus={() => onDrawerFocused(entityId)}
                              onPtyIdReady={(ptyId) => onDrawerPtyIdReady(tab.id, ptyId)}
                              onTitleChange={(title) => onDrawerTabTitleChange(entityId, tab.id, title)}
                            />
                          )}
                        </div>
                      ))
                    )}
                  </Drawer>
                </div>
              </Panel>
            </PanelGroup>
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

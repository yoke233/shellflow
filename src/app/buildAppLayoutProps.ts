import type { ComponentProps, MutableRefObject, RefObject } from 'react';
import type { PanelImperativeHandle } from 'react-resizable-panels';
import { AppLayout } from './AppLayout';
import { Sidebar } from '../components/Sidebar/Sidebar';
import { MainPane } from '../components/MainPane/MainPane';
import { Drawer } from '../components/Drawer/Drawer';
import { RightPanel } from '../components/RightPanel/RightPanel';
import { TaskSwitcher } from '../components/TaskSwitcher/TaskSwitcher';
import { CommandPalette } from '../components/CommandPalette';
import { ProjectSwitcher } from '../components/ProjectSwitcher';
import { ThemeSwitcher } from '../components/ThemeSwitcher';
import { AppearanceSettingsModal } from '../components/Settings/AppearanceSettingsModal';
import type { Config, TerminalConfig, TaskConfig, AppsConfig } from '../hooks/useConfig';
import type { Project, Worktree, ScratchTerminal, RunningTask, ChangedFilesViewMode, BranchInfo } from '../types';
import type { ThemeBorderStyle } from '../theme';
import type { ActionContext, ActionId as PaletteActionId } from '../lib/actions';
import type { ActionId as MappingActionId } from '../lib/mappings';
import type { ActionPromptContext } from '../lib/tauri';
import type { ToastData } from '../components/Toast';
import type { DrawerTab } from '../components/Drawer/Drawer';

const noop = () => {};

type AppLayoutProps = ComponentProps<typeof AppLayout>;

type SidebarProps = ComponentProps<typeof Sidebar>;

type MainPaneProps = ComponentProps<typeof MainPane>;

type DrawerProps = ComponentProps<typeof Drawer>;

type RightPanelProps = ComponentProps<typeof RightPanel>;

type TaskSwitcherProps = ComponentProps<typeof TaskSwitcher>;

type CommandPaletteProps = ComponentProps<typeof CommandPalette>;

type ProjectSwitcherProps = ComponentProps<typeof ProjectSwitcher>;

type ThemeSwitcherProps = ComponentProps<typeof ThemeSwitcher>;

type AppearanceSettingsProps = ComponentProps<typeof AppearanceSettingsModal>;

interface BuildAppLayoutDeps {
  projects: Project[];
  activeProjectId: string | null;
  activeWorktreeId: string | null;
  activeScratchId: string | null;
  activeWorktree: Worktree | null;
  scratchTerminals: ScratchTerminal[];
  openProjectIds: Set<string>;
  openWorktreeIds: Set<string>;
  openEntitiesInOrder: Array<{ type: 'scratch' | 'worktree' | 'project'; id: string }>;
  isCtrlCmdKeyHeld: boolean;
  isPickerOpen: boolean;
  loadingWorktrees: Set<string>;
  notifiedWorktreeIds: Set<string>;
  thinkingWorktreeIds: Set<string>;
  idleWorktreeIds: Set<string>;
  notifiedProjectIds: Set<string>;
  thinkingProjectIds: Set<string>;
  idleProjectIds: Set<string>;
  notifiedScratchIds: Set<string>;
  thinkingScratchIds: Set<string>;
  idleScratchIds: Set<string>;
  runningTaskCounts: Map<string, number>;
  expandedProjects: Set<string>;
  isDrawerOpen: boolean;
  isDrawerExpanded: boolean;
  isRightPanelOpen: boolean;
  tasks: TaskConfig[];
  activeSelectedTask: string | null;
  activeRunningTask: RunningTask | null;
  runningTasks: Map<string, RunningTask[]>;
  terminalFontFamily: string;
  appsConfig: AppsConfig;
  showIdleCheck: boolean;
  activeScratchCwd: string | null;
  homeDir: string | null;
  branchInfo: BranchInfo | null;
  changedFilesCount: number;
  changedFilesMode: ChangedFilesViewMode;
  autoEditWorktreeId: string | null;
  editingScratchId: string | null;
  focusToRestoreRef: MutableRefObject<HTMLElement | null>;
  onFocusMain: () => void;
  onToggleProject: (projectId: string) => void;
  onSelectProject: (project: Project) => void;
  onSelectWorktree: (worktree: Worktree) => void;
  onAddProject: () => void;
  onAddWorktree: (projectId: string) => void;
  onDeleteWorktree: (worktreeId: string) => void;
  onCloseWorktree: (worktreeId: string) => void;
  onCloseProject: (projectOrId: Project | string) => void;
  onHideProject: (projectOrId: Project | string) => void;
  onMergeWorktree: (worktreeId: string) => void;
  onToggleDrawer: () => void;
  onToggleRightPanel: () => void;
  onSelectTask: (taskName: string) => void;
  onStartTask: (taskNameOverride?: string) => void;
  onStopTask: () => void;
  onForceKillTask: () => void;
  onRenameWorktree: (worktreeId: string, newName: string) => Promise<void>;
  onReorderProjects: (projectIds: string[]) => void;
  onReorderWorktrees: (projectId: string, worktreeIds: string[]) => void;
  onAddScratchTerminal: () => void;
  onSelectScratch: (scratchId: string) => void;
  onCloseScratch: (scratchId: string) => void;
  onRenameScratch: (scratchId: string, newName: string) => void;
  onReorderScratchTerminals: (scratchIds: string[]) => void;
  onAutoEditConsumed: () => void;
  onEditingScratchConsumed: () => void;
  onOpenInDrawer: (directory: string, command: string) => void;
  onOpenInTab: (directory: string, command: string) => void;
  onOpenAppearanceSettings: () => void;
  onOpenCommitModal: () => void;
  sessions: MainPaneProps['sessions'];
  openSessionIds: MainPaneProps['openSessionIds'];
  activeSessionId: MainPaneProps['activeSessionId'];
  allSessionTabs: MainPaneProps['allSessionTabs'];
  activeSessionTabId: MainPaneProps['activeSessionTabId'];
  sessionLastActiveTabIds: MainPaneProps['sessionLastActiveTabIds'];
  isCtrlKeyHeld: boolean;
  onSelectSessionTab: MainPaneProps['onSelectSessionTab'];
  onCloseSessionTab: MainPaneProps['onCloseSessionTab'];
  onAddSessionTab: MainPaneProps['onAddSessionTab'];
  onReorderSessionTabs: MainPaneProps['onReorderSessionTabs'];
  onRenameSessionTab: MainPaneProps['onRenameSessionTab'];
  terminalConfig: MainPaneProps['terminalConfig'];
  editorConfig: MainPaneProps['editorConfig'];
  activityTimeout: number;
  unfocusedPaneOpacity: number;
  shouldAutoFocus: MainPaneProps['shouldAutoFocus'];
  focusTrigger: MainPaneProps['focusTrigger'];
  configErrors: MainPaneProps['configErrors'];
  onFocus: MainPaneProps['onFocus'];
  onWorktreeNotification: MainPaneProps['onWorktreeNotification'];
  onWorktreeThinkingChange: MainPaneProps['onWorktreeThinkingChange'];
  onProjectNotification: MainPaneProps['onProjectNotification'];
  onProjectThinkingChange: MainPaneProps['onProjectThinkingChange'];
  onScratchNotification: MainPaneProps['onScratchNotification'];
  onScratchThinkingChange: MainPaneProps['onScratchThinkingChange'];
  onScratchCwdChange: MainPaneProps['onScratchCwdChange'];
  onClearNotification: MainPaneProps['onClearNotification'];
  onTabTitleChange: MainPaneProps['onTabTitleChange'];
  onPtyIdReady: MainPaneProps['onPtyIdReady'];
  drawerTabs: Map<string, DrawerTab[]>;
  activeDrawerTabs: DrawerProps['tabs'];
  activeDrawerTabId: DrawerProps['activeTabId'];
  activeTaskStatuses: DrawerProps['taskStatuses'];
  onSelectDrawerTab: DrawerProps['onSelectTab'];
  onCloseDrawerTab: DrawerProps['onCloseTab'];
  onAddDrawerTab: DrawerProps['onAddTab'];
  onToggleExpand: DrawerProps['onToggleExpand'];
  onReorderDrawerTabs: DrawerProps['onReorderTabs'];
  changedFiles: RightPanelProps['changedFiles'];
  isGitRepo: RightPanelProps['isGitRepo'];
  loading: RightPanelProps['loading'];
  onModeChange: RightPanelProps['onModeChange'];
  showModeToggle: RightPanelProps['showModeToggle'];
  onFileClick: RightPanelProps['onFileClick'];
  selectedFile: RightPanelProps['selectedFile'];
  onOpenDiff: RightPanelProps['onOpenDiff'];
  actionContext: ActionContext;
  getShortcut: (id: MappingActionId) => string | null;
  labelOverrides: Partial<Record<PaletteActionId, string>>;
  navigableEntitiesInOrder: Array<{ type: 'scratch' | 'project' | 'worktree'; id: string }>;
  onExecuteAction: (actionId: PaletteActionId) => void;
  onRunTask: (taskName: string) => void;
  onNavigate: (type: 'scratch' | 'project' | 'worktree', id: string) => void;
  onCloseCommandPalette: () => void;
  onCloseTaskSwitcher: () => void;
  onCloseProjectSwitcher: () => void;
  onCloseThemeSwitcher: () => void;
  onCloseAppearanceSettings: () => void;
  onProjectSwitcherSelect: (projectId: string) => void;
  onThemeChange: (themeName: string) => void;
  onBorderStyleChange: (style: ThemeBorderStyle) => void;
  onFontChange: (patch: { fontFamily?: string; fontSize?: number; fontLigatures?: boolean }) => void;
  onModalOpen: () => void;
  onModalClose: () => void;
  isCommitModalOpen: boolean;
  commitMessage: string;
  commitBranchName: string;
  commitSuggestedBranchName: string | null;
  commitCurrentBranch: string | null;
  commitError: string | null;
  commitBusy: boolean;
  commitBusyLabel: string | null;
  commitHasCommitted: boolean;
  commitCanMergeToMain: boolean;
  commitCanCreateBranch: boolean;
  commitCanRenameBranch: boolean;
  onCommitMessageChange: (value: string) => void;
  onCommitBranchNameChange: (value: string) => void;
  onCommitAutoGenerate: () => void;
  onCommitUseSuggestedBranch: () => void;
  onCommitSubmit: () => void;
  onCommitCreateBranch: () => void;
  onCommitPushBranch: () => void;
  onCommitMergeToMain: () => void;
  onCommitPushMain: () => void;
  onCommitClose: () => void;
  isTaskSwitcherOpen: boolean;
  isCommandPaletteOpen: boolean;
  isProjectSwitcherOpen: boolean;
  isThemeSwitcherOpen: boolean;
  isAppearanceSettingsOpen: boolean;
  isShuttingDown: boolean;
  pendingDeleteInfo: { worktree: Worktree; projectPath: string } | null;
  pendingCloseProject: Project | null;
  pendingMergeInfo: { worktree: Worktree; projectPath: string } | null;
  pendingStashProject: Project | null;
  stashError: string | null;
  isStashing: boolean;
  onClearPendingDelete: () => void;
  onClearPendingCloseProject: () => void;
  onClearPendingMerge: () => void;
  onDeleteComplete: (worktreeId: string) => void;
  onConfirmCloseProject: () => void;
  onMergeComplete: (worktreeId: string, deletedWorktree: boolean) => void;
  onTriggerAction: (worktreeId: string, projectPath: string, actionType: string, context: ActionPromptContext) => void;
  onStashAndCreate: () => void;
  onCancelStash: () => void;
  mainPanelRef: RefObject<PanelImperativeHandle | null>;
  drawerPanelRef: RefObject<PanelImperativeHandle | null>;
  rightPanelRef: RefObject<PanelImperativeHandle | null>;
  activeEntityId: string | null;
  activeFocusState: 'main' | 'drawer';
  drawerTerminalConfig: TerminalConfig;
  getEntityDirectory: (entityId: string) => string | undefined;
  onTaskPtyIdReady: (entityId: string, taskName: string, ptyId: string) => void;
  onTaskExit: (entityId: string, taskName: string, exitCode: number) => void;
  onDrawerFocused: (entityId: string) => void;
  onDrawerPtyIdReady: (tabId: string, ptyId: string) => void;
  onDrawerTabTitleChange: (entityId: string, tabId: string, title: string) => void;
  onDrawerResize: (size: { inPixels: number }) => void;
  onRightPanelResize: (size: { inPixels: number }) => void;
  config: Config;
  effectiveBorderStyle: ThemeBorderStyle;
  toasts: ToastData[];
  onDismissToast: (id: string) => void;
}

interface AppLayoutParts {
  themeProps: AppLayoutProps['theme'];
  overlaysProps: AppLayoutProps['overlays'];
  pickersProps: AppLayoutProps['pickers'];
  layoutProps: AppLayoutProps['layout'];
  toastProps: AppLayoutProps['toasts'];
}

export function buildAppLayoutProps(deps: BuildAppLayoutDeps): AppLayoutParts {
  const shortcuts = {
    drawerToggle: deps.getShortcut('drawer::toggle'),
    rightPanelToggle: deps.getShortcut('rightPanel::toggle'),
    diffOpen: deps.getShortcut('diff::open'),
    sessionNewTab: deps.getShortcut('session::newTab'),
    drawerNewTab: deps.getShortcut('drawer::newTab'),
    commandPalette: deps.getShortcut('palette::toggle'),
  };

  const sidebarProps: SidebarProps = {
    projects: deps.projects,
    activeProjectId: deps.activeProjectId,
    activeWorktreeId: deps.activeWorktreeId,
    activeScratchId: deps.activeScratchId,
    activeWorktree: deps.activeWorktree,
    scratchTerminals: deps.scratchTerminals,
    openProjectIds: deps.openProjectIds,
    openWorktreeIds: deps.openWorktreeIds,
    openEntitiesInOrder: deps.openEntitiesInOrder,
    isModifierKeyHeld: deps.isCtrlCmdKeyHeld && !deps.isPickerOpen,
    loadingWorktrees: deps.loadingWorktrees,
    notifiedWorktreeIds: deps.notifiedWorktreeIds,
    thinkingWorktreeIds: deps.thinkingWorktreeIds,
    idleWorktreeIds: deps.idleWorktreeIds,
    notifiedProjectIds: deps.notifiedProjectIds,
    thinkingProjectIds: deps.thinkingProjectIds,
    idleProjectIds: deps.idleProjectIds,
    notifiedScratchIds: deps.notifiedScratchIds,
    thinkingScratchIds: deps.thinkingScratchIds,
    idleScratchIds: deps.idleScratchIds,
    runningTaskCounts: deps.runningTaskCounts,
    expandedProjects: deps.expandedProjects,
    isDrawerOpen: deps.isDrawerOpen,
    isRightPanelOpen: deps.isRightPanelOpen,
    tasks: deps.tasks,
    selectedTask: deps.activeSelectedTask,
    runningTask: deps.activeRunningTask && deps.activeEntityId
      ? {
          ...deps.activeRunningTask,
          worktreeId: deps.activeEntityId,
          kind: deps.tasks.find(t => t.name === deps.activeRunningTask?.taskName)?.kind ?? 'command',
        }
      : null,
    allRunningTasks: deps.activeEntityId ? deps.runningTasks.get(deps.activeEntityId) ?? [] : [],
    terminalFontFamily: deps.terminalFontFamily,
    appsConfig: deps.appsConfig,
    showIdleCheck: deps.showIdleCheck,
    activeScratchCwd: deps.activeScratchCwd,
    homeDir: deps.homeDir,
    branchInfo: deps.branchInfo,
    changedFilesCount: deps.changedFilesCount,
    changedFilesMode: deps.changedFilesMode,
    autoEditWorktreeId: deps.autoEditWorktreeId,
    editingScratchId: deps.editingScratchId,
    focusToRestoreRef: deps.focusToRestoreRef,
    onFocusMain: deps.onFocusMain,
    onToggleProject: deps.onToggleProject,
    onSelectProject: deps.onSelectProject,
    onSelectWorktree: deps.onSelectWorktree,
    onAddProject: deps.onAddProject,
    onAddWorktree: deps.onAddWorktree,
    onDeleteWorktree: deps.onDeleteWorktree,
    onCloseWorktree: deps.onCloseWorktree,
    onCloseProject: deps.onCloseProject,
    onHideProject: deps.onHideProject,
    onMergeWorktree: deps.onMergeWorktree,
    onToggleDrawer: deps.onToggleDrawer,
    onToggleRightPanel: deps.onToggleRightPanel,
    toggleDrawerShortcut: shortcuts.drawerToggle,
    toggleRightPanelShortcut: shortcuts.rightPanelToggle,
    onSelectTask: deps.onSelectTask,
    onStartTask: deps.onStartTask,
    onStopTask: deps.onStopTask,
    onForceKillTask: deps.onForceKillTask,
    onRenameWorktree: deps.onRenameWorktree,
    onReorderProjects: deps.onReorderProjects,
    onReorderWorktrees: deps.onReorderWorktrees,
    onAddScratchTerminal: deps.onAddScratchTerminal,
    onSelectScratch: deps.onSelectScratch,
    onCloseScratch: deps.onCloseScratch,
    onRenameScratch: deps.onRenameScratch,
    onReorderScratchTerminals: deps.onReorderScratchTerminals,
    onAutoEditConsumed: deps.onAutoEditConsumed,
    onEditingScratchConsumed: deps.onEditingScratchConsumed,
    onOpenInDrawer: deps.onOpenInDrawer,
    onOpenInTab: deps.onOpenInTab,
    onOpenAppearanceSettings: deps.onOpenAppearanceSettings,
    onOpenCommitModal: deps.onOpenCommitModal,
  };

  const mainPaneProps: MainPaneProps = {
    sessions: deps.sessions,
    openSessionIds: deps.openSessionIds,
    activeSessionId: deps.activeSessionId,
    allSessionTabs: deps.allSessionTabs,
    activeSessionTabId: deps.activeSessionTabId,
    sessionLastActiveTabIds: deps.sessionLastActiveTabIds,
    isCtrlKeyHeld: deps.isCtrlKeyHeld && !deps.isPickerOpen,
    onSelectSessionTab: deps.onSelectSessionTab,
    onCloseSessionTab: deps.onCloseSessionTab,
    onAddSessionTab: deps.onAddSessionTab,
    onReorderSessionTabs: deps.onReorderSessionTabs,
    onRenameSessionTab: deps.onRenameSessionTab,
    newTabShortcut: shortcuts.sessionNewTab,
    commandPaletteShortcut: shortcuts.commandPalette,
    terminalConfig: deps.terminalConfig,
    editorConfig: deps.editorConfig,
    activityTimeout: deps.activityTimeout,
    unfocusedPaneOpacity: deps.unfocusedPaneOpacity,
    shouldAutoFocus: deps.shouldAutoFocus,
    focusTrigger: deps.focusTrigger,
    configErrors: deps.configErrors,
    onFocus: deps.onFocus,
    onWorktreeNotification: deps.onWorktreeNotification,
    onWorktreeThinkingChange: deps.onWorktreeThinkingChange,
    onProjectNotification: deps.onProjectNotification,
    onProjectThinkingChange: deps.onProjectThinkingChange,
    onScratchNotification: deps.onScratchNotification,
    onScratchThinkingChange: deps.onScratchThinkingChange,
    onScratchCwdChange: deps.onScratchCwdChange,
    onClearNotification: deps.onClearNotification,
    onTabTitleChange: deps.onTabTitleChange,
    onPtyIdReady: deps.onPtyIdReady,
  };

  const drawerProps: DrawerProps = {
    isOpen: deps.isDrawerOpen,
    isExpanded: deps.isDrawerExpanded,
    worktreeId: deps.activeEntityId,
    tabs: deps.activeDrawerTabs,
    activeTabId: deps.activeDrawerTabId,
    taskStatuses: deps.activeTaskStatuses,
    isCtrlKeyHeld: deps.isCtrlKeyHeld && !deps.isPickerOpen,
    onSelectTab: deps.onSelectDrawerTab,
    onCloseTab: deps.onCloseDrawerTab,
    onAddTab: deps.onAddDrawerTab,
    onToggleExpand: deps.onToggleExpand,
    onReorderTabs: deps.onReorderDrawerTabs,
    newTabShortcut: shortcuts.drawerNewTab,
  };

  const rightPanelProps: RightPanelProps = {
    changedFiles: deps.changedFiles,
    isGitRepo: deps.isGitRepo,
    loading: deps.loading,
    mode: deps.changedFilesMode,
    onModeChange: deps.onModeChange,
    showModeToggle: deps.showModeToggle ?? false,
    onFileClick: deps.onFileClick,
    selectedFile: deps.selectedFile,
    onOpenDiff: deps.onOpenDiff,
    openDiffShortcut: shortcuts.diffOpen,
  };

  const taskSwitcherProps: TaskSwitcherProps = {
    tasks: deps.tasks,
    selectedTask: deps.activeSelectedTask,
    runningTasks: deps.activeEntityId ? deps.runningTasks.get(deps.activeEntityId) ?? [] : [],
    onSelect: deps.onSelectTask,
    onRun: deps.onRunTask,
    onClose: deps.onCloseTaskSwitcher ?? noop,
    onModalOpen: deps.onModalOpen,
    onModalClose: deps.onModalClose,
  };

  const commandPaletteProps: CommandPaletteProps = {
    actionContext: deps.actionContext,
    getShortcut: deps.getShortcut,
    labelOverrides: deps.labelOverrides,
    tasks: deps.tasks,
    projects: deps.projects,
    scratchTerminals: deps.scratchTerminals,
    openEntitiesInOrder: deps.navigableEntitiesInOrder,
    onExecute: deps.onExecuteAction,
    onRunTask: deps.onRunTask,
    onNavigate: deps.onNavigate,
    onClose: deps.onCloseCommandPalette,
    onModalOpen: deps.onModalOpen,
    onModalClose: deps.onModalClose,
  };

  const projectSwitcherProps: ProjectSwitcherProps = {
    projects: deps.projects,
    activeProjectId: deps.activeProjectId,
    onSelect: deps.onProjectSwitcherSelect,
    onClose: deps.onCloseProjectSwitcher,
    onModalOpen: deps.onModalOpen,
    onModalClose: deps.onModalClose,
  };

  const themeSwitcherProps: ThemeSwitcherProps = {
    onClose: deps.onCloseThemeSwitcher,
    onModalOpen: deps.onModalOpen,
    onModalClose: deps.onModalClose,
  };

  const appearanceSettingsProps: AppearanceSettingsProps = {
    onClose: deps.onCloseAppearanceSettings,
    borderStyle: deps.effectiveBorderStyle,
    fontFamily: deps.config.main.fontFamily,
    fontSize: deps.config.main.fontSize,
    fontLigatures: deps.config.main.fontLigatures,
    onFontChange: deps.onFontChange,
    onBorderStyleChange: deps.onBorderStyleChange,
    onModalOpen: deps.onModalOpen,
    onModalClose: deps.onModalClose,
  };

  const overlaysProps: AppLayoutProps['overlays'] = {
    isShuttingDown: deps.isShuttingDown,
    pendingDeleteInfo: deps.pendingDeleteInfo,
    pendingCloseProject: deps.pendingCloseProject,
    pendingMergeInfo: deps.pendingMergeInfo,
    pendingStashProject: deps.pendingStashProject,
    showCommitModal: deps.isCommitModalOpen,
    commitModalProps: {
      message: deps.commitMessage,
      onMessageChange: deps.onCommitMessageChange,
      branchName: deps.commitBranchName,
      suggestedBranchName: deps.commitSuggestedBranchName ?? undefined,
      currentBranch: deps.commitCurrentBranch ?? undefined,
      canCreateBranch: deps.commitCanCreateBranch,
      canRenameBranch: deps.commitCanRenameBranch,
      onBranchNameChange: deps.onCommitBranchNameChange,
      onCreateBranch: deps.onCommitCreateBranch,
      onUseSuggestedBranch: deps.onCommitUseSuggestedBranch,
      onGenerate: deps.onCommitAutoGenerate,
      onCommit: deps.onCommitSubmit,
      onPushBranch: deps.onCommitPushBranch,
      onMergeToMain: deps.onCommitMergeToMain,
      onPushMain: deps.onCommitPushMain,
      onClose: deps.onCommitClose,
      isBusy: deps.commitBusy,
      busyLabel: deps.commitBusyLabel ?? undefined,
      error: deps.commitError ?? undefined,
      hasCommitted: deps.commitHasCommitted,
      canMergeToMain: deps.commitCanMergeToMain,
      onModalOpen: deps.onModalOpen,
      onModalClose: deps.onModalClose,
    },
    stashError: deps.stashError,
    isStashing: deps.isStashing,
    onClearPendingDelete: deps.onClearPendingDelete,
    onClearPendingCloseProject: deps.onClearPendingCloseProject,
    onClearPendingMerge: deps.onClearPendingMerge,
    onDeleteComplete: deps.onDeleteComplete,
    onConfirmCloseProject: deps.onConfirmCloseProject,
    onMergeComplete: deps.onMergeComplete,
    onTriggerAction: deps.onTriggerAction,
    onStashAndCreate: deps.onStashAndCreate,
    onCancelStash: deps.onCancelStash,
    onModalOpen: deps.onModalOpen,
    onModalClose: deps.onModalClose,
  };

  const pickersProps: AppLayoutProps['pickers'] = {
    showTaskSwitcher: deps.isTaskSwitcherOpen && !!deps.activeEntityId,
    taskSwitcherProps,
    showCommandPalette: deps.isCommandPaletteOpen,
    commandPaletteProps,
    showProjectSwitcher: deps.isProjectSwitcherOpen,
    projectSwitcherProps,
    showThemeSwitcher: deps.isThemeSwitcherOpen,
    themeSwitcherProps,
    showAppearanceSettings: deps.isAppearanceSettingsOpen,
    appearanceSettingsProps,
  };

  const layoutProps: AppLayoutProps['layout'] = {
    sidebarProps,
    mainPaneProps,
    drawerProps,
    rightPanelProps,
    mainPanelRef: deps.mainPanelRef,
    drawerPanelRef: deps.drawerPanelRef,
    rightPanelRef: deps.rightPanelRef,
    isDrawerOpen: deps.isDrawerOpen,
    isDrawerExpanded: deps.isDrawerExpanded,
    isRightPanelOpen: deps.isRightPanelOpen,
    activeEntityId: deps.activeEntityId,
    activeDrawerTabId: deps.activeDrawerTabId,
    activeFocusState: deps.activeFocusState,
    drawerTabs: deps.drawerTabs,
    drawerTerminalConfig: deps.drawerTerminalConfig,
    getEntityDirectory: deps.getEntityDirectory,
    onTaskPtyIdReady: deps.onTaskPtyIdReady,
    onTaskExit: deps.onTaskExit,
    onDrawerFocused: deps.onDrawerFocused,
    onCloseDrawerTab: deps.onCloseDrawerTab,
    onDrawerPtyIdReady: deps.onDrawerPtyIdReady,
    onDrawerTabTitleChange: deps.onDrawerTabTitleChange,
    onDrawerResize: deps.onDrawerResize,
    onRightPanelResize: deps.onRightPanelResize,
  };

  const themeProps: AppLayoutProps['theme'] = {
    themeConfig: deps.config.theme,
    borderStyle: deps.effectiveBorderStyle,
    onThemeChange: deps.onThemeChange,
    onBorderStyleChange: deps.onBorderStyleChange,
  };

  const toastProps: AppLayoutProps['toasts'] = {
    items: deps.toasts,
    onDismiss: deps.onDismissToast,
  };

  return {
    themeProps,
    overlaysProps,
    pickersProps,
    layoutProps,
    toastProps,
  };
}

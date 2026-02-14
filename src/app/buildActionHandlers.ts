import type { MutableRefObject, Dispatch, SetStateAction } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { openUrl } from '@tauri-apps/plugin-opener';
import type { Project } from '../types';
import type { ActionHandlers } from '../hooks/useActions';
import { getAppCommand, getAppTarget, type AppsConfig } from '../hooks/useConfig';
import { substitutePathTemplate } from '../lib/pathTemplate';

type EntityOrderEntry = { type: 'scratch' | 'project' | 'worktree'; id: string };

interface BuildActionHandlersDeps {
  activeProjectId: string | null;
  activeWorktreeId: string | null;
  activeScratchId: string | null;
  activeDrawerTabId: string | null;
  activeFocusState: 'main' | 'drawer';
  isDrawerOpen: boolean;
  activeEntityId: string | null;
  projects: Project[];
  scratchCwds: Map<string, string>;
  appsConfig: AppsConfig;
  showWarning: (message: string) => void;
  openEntitiesInOrder: EntityOrderEntry[];
  getCurrentEntityIndex: () => number;
  selectEntityAtIndex: (index: number) => void;
  focusToRestoreRef: MutableRefObject<HTMLElement | null>;
  setEditingScratchId: Dispatch<SetStateAction<string | null>>;
  setIsDrawerOpen: Dispatch<SetStateAction<boolean>>;
  handleRefreshProjects: () => void;
  handleAddProject: () => void;
  handleToggleProjectSwitcher: () => void;
  handleOpenCommitModal: () => void;
  handleAddWorktree: (projectId: string) => void;
  handleAddScratchTerminal: () => void;
  handleAddSessionTab: () => void;
  handleCloseDrawerTab: (tabId: string) => void;
  handleCloseScratch: (scratchId: string) => void;
  handleCloseWorktree: (worktreeId: string) => void;
  handleCloseProject: (projectOrId: Project | string) => void;
  handleAddDrawerTab: () => void;
  handleOpenInDrawer: (directory: string, command: string) => void;
  handleOpenInTab: (directory: string, command: string) => void;
  handleOpenThemeSwitcher: () => void;
  handleToggleCommandPalette: () => void;
  handleToggleDrawer: () => void;
  handleToggleDrawerExpand: () => void;
  handleToggleRightPanel: () => void;
  handleCycleBorderStyle: () => void;
  handleZoomIn: () => void;
  handleZoomOut: () => void;
  handleZoomReset: () => void;
  handleNavigateBack: () => void;
  handleNavigateForward: () => void;
  handleSwitchFocus: () => void;
  handleRenameBranch: (worktreeId: string) => void;
  handleMergeWorktree: (worktreeId: string) => void;
  handleDeleteWorktree: (worktreeId: string) => void;
  handleToggleTask: () => void;
  handleToggleTaskSwitcher: () => void;
  handleOpenDiff: () => void;
  handleNextChangedFile: () => void;
  handlePrevChangedFile: () => void;
  handleToggleDiffMode: () => void;
}

export function buildActionHandlers(deps: BuildActionHandlersDeps): ActionHandlers {
  const {
    activeProjectId,
    activeWorktreeId,
    activeScratchId,
    activeDrawerTabId,
    activeFocusState,
    isDrawerOpen,
    activeEntityId,
    projects,
    scratchCwds,
    appsConfig,
    showWarning,
    openEntitiesInOrder,
    getCurrentEntityIndex,
    selectEntityAtIndex,
    focusToRestoreRef,
    setEditingScratchId,
    setIsDrawerOpen,
    handleRefreshProjects,
    handleAddProject,
    handleToggleProjectSwitcher,
    handleOpenCommitModal,
    handleAddWorktree,
    handleAddScratchTerminal,
    handleAddSessionTab,
    handleCloseDrawerTab,
    handleCloseScratch,
    handleCloseWorktree,
    handleCloseProject,
    handleAddDrawerTab,
    handleOpenInDrawer,
    handleOpenInTab,
    handleOpenThemeSwitcher,
    handleToggleCommandPalette,
    handleToggleDrawer,
    handleToggleDrawerExpand,
    handleToggleRightPanel,
    handleCycleBorderStyle,
    handleZoomIn,
    handleZoomOut,
    handleZoomReset,
    handleNavigateBack,
    handleNavigateForward,
    handleSwitchFocus,
    handleRenameBranch,
    handleMergeWorktree,
    handleDeleteWorktree,
    handleToggleTask,
    handleToggleTaskSwitcher,
    handleOpenDiff,
    handleNextChangedFile,
    handlePrevChangedFile,
    handleToggleDiffMode,
  } = deps;

  return {
    'app::quit': () => {
      getCurrentWindow().emit('close-requested');
    },
    'app::addProject': handleAddProject,
    'palette::projectSwitcher': handleToggleProjectSwitcher,
    'worktree::new': () => activeProjectId && handleAddWorktree(activeProjectId),
    'scratch::new': handleAddScratchTerminal,
    'session::newTab': handleAddSessionTab,
    'session::closeTab': () => {
      if (isDrawerOpen && activeFocusState === 'drawer' && activeDrawerTabId) {
        handleCloseDrawerTab(activeDrawerTabId);
      } else if (activeScratchId) {
        handleCloseScratch(activeScratchId);
      } else if (activeWorktreeId) {
        handleCloseWorktree(activeWorktreeId);
      } else if (activeProjectId) {
        handleCloseProject(activeProjectId);
      }
    },
    'app::openInFinder': () => {
      let path: string | undefined;
      if (activeWorktreeId) {
        path = projects.flatMap(p => p.worktrees).find(w => w.id === activeWorktreeId)?.path;
      } else if (activeScratchId) {
        path = scratchCwds.get(activeScratchId);
      } else if (activeProjectId) {
        path = projects.find(p => p.id === activeProjectId)?.path;
      }
      if (path) invoke('open_folder', { path });
    },
    'app::openInTerminal': () => {
      const target = getAppTarget(appsConfig.terminal);
      const command = getAppCommand(appsConfig.terminal);

      let path: string | undefined;
      if (activeWorktreeId) {
        path = projects.flatMap(p => p.worktrees).find(w => w.id === activeWorktreeId)?.path;
      } else if (activeScratchId) {
        path = scratchCwds.get(activeScratchId);
      } else if (activeProjectId) {
        path = projects.find(p => p.id === activeProjectId)?.path;
      }
      if (!path) return;

      if (target === 'drawer') {
        if (activeEntityId) {
          handleAddDrawerTab();
          if (!isDrawerOpen) setIsDrawerOpen(true);
        }
      } else if (target === 'tab') {
        handleAddSessionTab();
      } else {
        invoke('open_in_terminal', { path, app: command ?? null });
      }
    },
    'app::openInEditor': () => {
      const command = getAppCommand(appsConfig.editor);
      const target = appsConfig.editor ? getAppTarget(appsConfig.editor) : getAppTarget(undefined, 'terminal');
      const terminalCommand = getAppCommand(appsConfig.terminal);

      let path: string | undefined;
      if (activeWorktreeId) {
        path = projects.flatMap(p => p.worktrees).find(w => w.id === activeWorktreeId)?.path;
      } else if (activeScratchId) {
        path = scratchCwds.get(activeScratchId);
      } else if (activeProjectId) {
        path = projects.find(p => p.id === activeProjectId)?.path;
      }
      if (!path) return;

      if (!command) {
        showWarning('未配置 editor。请在配置文件中设置 apps.editor 后重试。');
        return;
      }

      if (target === 'drawer') {
        handleOpenInDrawer(path, substitutePathTemplate(command, path));
      } else if (target === 'tab') {
        handleOpenInTab(path, substitutePathTemplate(command, path));
      } else {
        invoke('open_in_editor', {
          path,
          app: command,
          target,
          terminalApp: terminalCommand ?? null,
        }).catch((err) => {
          console.error('Failed to open editor:', err);
          const message = err instanceof Error ? err.message : String(err);
          showWarning(`打开编辑器失败：${message}`);
        });
      }
    },
    'app::openSettings': () => {
      (async () => {
        try {
          const path = await invoke<string>('get_config_file_path', { fileType: 'settings' });
          const editorCommand = getAppCommand(appsConfig.editor);
          const editorTarget = appsConfig.editor
            ? getAppTarget(appsConfig.editor)
            : getAppTarget(undefined, 'external');
          const terminalCommand = getAppCommand(appsConfig.terminal);

          if (editorCommand) {
            if (editorTarget === 'drawer') {
              handleOpenInDrawer(path, substitutePathTemplate(editorCommand, path));
              return;
            }
            if (editorTarget === 'tab') {
              handleOpenInTab(path, substitutePathTemplate(editorCommand, path));
              return;
            }

            await invoke('open_in_editor', {
              path,
              app: editorCommand,
              target: editorTarget,
              terminalApp: terminalCommand ?? null,
            });
            return;
          }

          try {
            await invoke('open_with_app', { path, app: 'code' });
            return;
          } catch (openErr) {
            console.warn('Failed to open settings in VS Code, falling back to Notepad:', openErr);
          }

          await invoke('open_with_app', { path, app: 'notepad' });
        } catch (err) {
          console.error('Failed to open settings:', err);
        }
      })();
    },
    'app::openMappings': () => {
      (async () => {
        try {
          const path = await invoke<string>('get_config_file_path', { fileType: 'mappings' });
          await invoke('open_default', { path });
        } catch (err) {
          console.error('Failed to open mappings:', err);
        }
      })();
    },
    'project::close': () => {
      if (activeProjectId && !activeWorktreeId) {
        handleCloseProject(activeProjectId);
      }
    },
    'project::refresh': handleRefreshProjects,
    'git::commit': handleOpenCommitModal,
    'palette::toggle': handleToggleCommandPalette,
    'drawer::toggle': handleToggleDrawer,
    'drawer::expand': handleToggleDrawerExpand,
    'rightPanel::toggle': handleToggleRightPanel,
    'view::switchTheme': handleOpenThemeSwitcher,
    'view::cycleBorderStyle': handleCycleBorderStyle,
    'view::zoomIn': handleZoomIn,
    'view::zoomOut': handleZoomOut,
    'view::zoomReset': handleZoomReset,
    'navigate::prev': () => {
      if (openEntitiesInOrder.length === 0) return;
      const currentIndex = getCurrentEntityIndex();
      const prevIndex = currentIndex !== -1
        ? (currentIndex === 0 ? openEntitiesInOrder.length - 1 : currentIndex - 1)
        : openEntitiesInOrder.length - 1;
      selectEntityAtIndex(prevIndex);
    },
    'navigate::next': () => {
      if (openEntitiesInOrder.length === 0) return;
      const currentIndex = getCurrentEntityIndex();
      const nextIndex = currentIndex !== -1
        ? (currentIndex === openEntitiesInOrder.length - 1 ? 0 : currentIndex + 1)
        : 0;
      selectEntityAtIndex(nextIndex);
    },
    'navigate::back': handleNavigateBack,
    'navigate::forward': handleNavigateForward,
    'focus::switch': handleSwitchFocus,
    'navigate::toEntity1': () => selectEntityAtIndex(0),
    'navigate::toEntity2': () => selectEntityAtIndex(1),
    'navigate::toEntity3': () => selectEntityAtIndex(2),
    'navigate::toEntity4': () => selectEntityAtIndex(3),
    'navigate::toEntity5': () => selectEntityAtIndex(4),
    'navigate::toEntity6': () => selectEntityAtIndex(5),
    'navigate::toEntity7': () => selectEntityAtIndex(6),
    'navigate::toEntity8': () => selectEntityAtIndex(7),
    'navigate::toEntity9': () => selectEntityAtIndex(8),
    'worktree::renameBranch': () => activeWorktreeId && handleRenameBranch(activeWorktreeId),
    'scratch::renameSession': () => {
      if (activeScratchId) {
        focusToRestoreRef.current = document.activeElement as HTMLElement | null;
        setEditingScratchId(activeScratchId);
      }
    },
    'worktree::merge': () => activeWorktreeId && handleMergeWorktree(activeWorktreeId),
    'worktree::delete': () => activeWorktreeId && handleDeleteWorktree(activeWorktreeId),
    'task::run': handleToggleTask,
    'task::switcher': handleToggleTaskSwitcher,
    'diff::open': handleOpenDiff,
    'diff::nextFile': handleNextChangedFile,
    'diff::prevFile': handlePrevChangedFile,
    'diff::toggleMode': handleToggleDiffMode,
    'app::helpDocs': () => openUrl('https://github.com/shkm/shellflow#readme'),
    'app::helpReportIssue': () => openUrl('https://github.com/shkm/shellflow/issues/new'),
    'app::helpReleaseNotes': () => openUrl('https://github.com/shkm/shellflow/releases'),
  };
}

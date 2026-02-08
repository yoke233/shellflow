import { useEffect, type MutableRefObject } from 'react';
import { listen } from '@tauri-apps/api/event';
import { getActiveContexts, type ContextState, type ActiveContexts } from '../lib/contexts';
import { executeAction, type ActionHandlerMap } from '../lib/actionHandlers';
import { getMenuAvailability, type ActionContext } from '../lib/actions';
import { updateActionAvailability } from '../lib/tauri';
import type { ResolvedBinding } from '../lib/mappings';
import type { SessionKind } from '../types';

interface GlobalBindingsOptions {
  activeSessionId: string | null;
  activeSessionKind: SessionKind | null;
  activeScratchId: string | null;
  activeWorktreeId: string | null;
  activeProjectId: string | null;
  activeFocusState: 'main' | 'drawer';
  isDrawerOpen: boolean;
  isRightPanelOpen: boolean;
  isCommandPaletteOpen: boolean;
  isTaskSwitcherOpen: boolean;
  isProjectSwitcherOpen: boolean;
  pendingCloseProject: unknown;
  pendingDeleteId: string | null;
  pendingMergeId: string | null;
  pendingStashProject: unknown;
  isAppearanceSettingsOpen: boolean;
  openEntityCount: number;
  canGoBack: boolean;
  canGoForward: boolean;
  isDiffViewOpen: boolean;
  hasSplits: boolean;
  resolveKeyEvent: (event: KeyboardEvent, contexts: ActiveContexts) => ResolvedBinding | null;
  contextActionHandlers: ActionHandlerMap;
  isPickerOpenRef: MutableRefObject<boolean>;
  executeByMenuIdRef: MutableRefObject<(menuId: string) => void>;
  actionContext: ActionContext;
  setIsModifierKeyHeld: (value: boolean) => void;
  setIsCtrlCmdKeyHeld: (value: boolean) => void;
}

export function useAppGlobalBindings(options: GlobalBindingsOptions) {
  const {
    activeSessionId,
    activeSessionKind,
    activeScratchId,
    activeWorktreeId,
    activeProjectId,
    activeFocusState,
    isDrawerOpen,
    isRightPanelOpen,
    isCommandPaletteOpen,
    isTaskSwitcherOpen,
    isProjectSwitcherOpen,
    pendingCloseProject,
    pendingDeleteId,
    pendingMergeId,
    pendingStashProject,
    isAppearanceSettingsOpen,
    openEntityCount,
    canGoBack,
    canGoForward,
    isDiffViewOpen,
    hasSplits,
    resolveKeyEvent,
    contextActionHandlers,
    isPickerOpenRef,
    executeByMenuIdRef,
    actionContext,
    setIsModifierKeyHeld,
    setIsCtrlCmdKeyHeld,
  } = options;

  // Context-aware keyboard shortcuts (new system)
  useEffect(() => {
    const handleContextKeyDown = (e: KeyboardEvent) => {
      const contextState: ContextState = {
        activeSessionId,
        activeSessionKind,
        activeScratchId,
        activeWorktreeId,
        activeProjectId,
        focusState: activeFocusState,
        isDrawerOpen,
        isRightPanelOpen,
        isCommandPaletteOpen,
        isTaskSwitcherOpen,
        isProjectSwitcherOpen,
        hasOpenModal: !!(pendingCloseProject || pendingDeleteId || pendingMergeId || pendingStashProject || isAppearanceSettingsOpen),
        openEntityCount,
        canGoBack,
        canGoForward,
        isDiffViewOpen,
        hasSplits,
      };

      const contexts = getActiveContexts(contextState);
      const binding = resolveKeyEvent(e, contexts);

      if (binding) {
        const handled = executeAction(binding.actionId, binding.args, contextActionHandlers);
        if (handled) {
          e.preventDefault();
          e.stopPropagation();
          console.log(`[ContextKeys] ${binding.actionId} (context: ${binding.context ?? 'global'})`);
        }
      }
    };

    window.addEventListener('keydown', handleContextKeyDown, true);
    return () => {
      window.removeEventListener('keydown', handleContextKeyDown, true);
    };
  }, [
    activeSessionId,
    activeSessionKind,
    activeScratchId,
    activeWorktreeId,
    activeProjectId,
    activeFocusState,
    isDrawerOpen,
    isRightPanelOpen,
    isCommandPaletteOpen,
    isTaskSwitcherOpen,
    isProjectSwitcherOpen,
    pendingCloseProject,
    pendingDeleteId,
    pendingMergeId,
    pendingStashProject,
    isAppearanceSettingsOpen,
    openEntityCount,
    canGoBack,
    canGoForward,
    isDiffViewOpen,
    hasSplits,
    resolveKeyEvent,
    contextActionHandlers,
  ]);

  // Modifier key tracking (for UI feedback like showing shortcut numbers)
  useEffect(() => {
    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if ((isMac && e.metaKey) || (!isMac && e.ctrlKey)) {
        setIsModifierKeyHeld(true);
      }
      if (e.ctrlKey && ((isMac && e.metaKey) || (!isMac && e.ctrlKey))) {
        setIsCtrlCmdKeyHeld(true);
      }
    };

    const handleKeyUp = (e: KeyboardEvent) => {
      if ((isMac && e.key === 'Meta') || (!isMac && e.key === 'Control')) {
        setIsModifierKeyHeld(false);
      }
      if (e.key === 'Control' || (isMac && e.key === 'Meta')) {
        setIsCtrlCmdKeyHeld(false);
      }
    };

    const handleBlur = () => {
      setIsModifierKeyHeld(false);
      setIsCtrlCmdKeyHeld(false);
    };

    window.addEventListener('keydown', handleKeyDown);
    window.addEventListener('keyup', handleKeyUp);
    window.addEventListener('blur', handleBlur);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      window.removeEventListener('keyup', handleKeyUp);
      window.removeEventListener('blur', handleBlur);
    };
  }, [setIsModifierKeyHeld, setIsCtrlCmdKeyHeld]);

  // Listen for menu bar actions from the backend
  useEffect(() => {
    const unlistenMenu = listen<string>('menu-action', (event) => {
      if (isPickerOpenRef.current) {
        return;
      }
      executeByMenuIdRef.current(event.payload);
    });

    return () => {
      unlistenMenu.then((fn) => fn());
    };
  }, [executeByMenuIdRef, isPickerOpenRef]);

  // Sync action availability to menu bar
  useEffect(() => {
    const menuAvailability = getMenuAvailability(actionContext);
    updateActionAvailability(menuAvailability);
  }, [actionContext]);
}

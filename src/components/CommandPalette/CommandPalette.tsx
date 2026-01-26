import { useState, useMemo, useCallback } from 'react';
import {
  ModalContainer,
  ModalSearchInput,
  ModalList,
  ModalListItem,
  ModalFooter,
  KeyHint,
  useModalNavigation,
} from '../Modal';
import {
  ActionId,
  ActionContext,
  ACTION_METADATA,
  getAvailablePaletteActions,
} from '../../lib/actions';
import type { TaskConfig } from '../../hooks/useConfig';
import type { Project, ScratchTerminal } from '../../types';
import type { ActionId as MappingsActionId } from '../../lib/mappings';

/** Maps old action IDs to new namespaced action IDs for shortcut lookup */
const OLD_TO_NEW_ACTION: Partial<Record<ActionId, MappingsActionId>> = {
  toggleDrawer: 'drawer::toggle',
  expandDrawer: 'drawer::expand',
  toggleRightPanel: 'rightPanel::toggle',
  commandPalette: 'palette::toggle',
  worktreePrev: 'navigate::prev',
  worktreeNext: 'navigate::next',
  previousView: 'navigate::back',
  switchFocus: 'focus::switch',
  zoomIn: 'view::zoomIn',
  zoomOut: 'view::zoomOut',
  zoomReset: 'view::zoomReset',
  runTask: 'task::run',
  taskSwitcher: 'task::switcher',
  newWorktree: 'worktree::new',
  newScratchTerminal: 'scratch::new',
  newTab: 'session::newTab',
  renameBranch: 'worktree::renameBranch',
};

const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

type PaletteItem =
  | { type: 'action'; id: ActionId; label: string; shortcut?: string }
  | { type: 'task'; name: string }
  | { type: 'scratch'; id: string; name: string }
  | { type: 'project'; id: string; name: string }
  | { type: 'worktree'; id: string; name: string; projectName: string };

// Get display label for an item (also used for searching)
function getItemLabel(item: PaletteItem): string {
  switch (item.type) {
    case 'action':
      return item.label;
    case 'task':
      return `Run: ${item.name}`;
    case 'scratch':
      return `Scratch: ${item.name}`;
    case 'project':
      return `Project: ${item.name}`;
    case 'worktree':
      return `Worktree: ${item.projectName} / ${item.name}`;
  }
}

interface CommandPaletteProps {
  actionContext: ActionContext;
  /** Get formatted shortcut for a namespaced action ID */
  getShortcut: (actionId: MappingsActionId) => string | null;
  tasks: TaskConfig[];
  projects: Project[];
  scratchTerminals: ScratchTerminal[];
  openEntitiesInOrder: Array<{ type: 'scratch' | 'project' | 'worktree'; id: string }>;
  onExecute: (actionId: ActionId) => void;
  onRunTask: (taskName: string) => void;
  onNavigate: (type: 'scratch' | 'project' | 'worktree', id: string) => void;
  onClose: () => void;
  onModalOpen?: () => void;
  onModalClose?: () => void;
}

export function CommandPalette({
  actionContext,
  getShortcut,
  tasks,
  projects,
  scratchTerminals,
  openEntitiesInOrder,
  onExecute,
  onRunTask,
  onNavigate,
  onClose,
  onModalOpen,
  onModalClose,
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');

  // Build list of palette items (actions + tasks + navigation)
  const allItems = useMemo(() => {
    const items: PaletteItem[] = [];

    // Add available actions
    const availableActions = getAvailablePaletteActions(actionContext);
    for (const actionId of availableActions) {
      const meta = ACTION_METADATA[actionId];
      let shortcut: string | undefined;

      // Look up shortcut using the new namespaced action ID
      const newActionId = OLD_TO_NEW_ACTION[actionId];
      if (newActionId) {
        const formatted = getShortcut(newActionId);
        if (formatted) {
          shortcut = formatted;
        }
      }

      items.push({ type: 'action', id: actionId, label: meta.label, shortcut });
    }

    // Add tasks (only if there's an active entity)
    if (actionContext.activeEntityId) {
      for (const task of tasks) {
        items.push({ type: 'task', name: task.name });
      }
    }

    // Add navigation items in sidebar order
    for (const entity of openEntitiesInOrder) {
      if (entity.type === 'scratch') {
        const scratch = scratchTerminals.find(s => s.id === entity.id);
        if (scratch) {
          items.push({ type: 'scratch', id: scratch.id, name: scratch.name });
        }
      } else if (entity.type === 'project') {
        const project = projects.find(p => p.id === entity.id);
        if (project) {
          items.push({ type: 'project', id: project.id, name: project.name });
        }
      } else if (entity.type === 'worktree') {
        // Find the project this worktree belongs to
        for (const project of projects) {
          const worktree = project.worktrees.find(w => w.id === entity.id);
          if (worktree) {
            items.push({
              type: 'worktree',
              id: worktree.id,
              name: worktree.name,
              projectName: project.name
            });
            break;
          }
        }
      }
    }

    return items;
  }, [actionContext, getShortcut, tasks, projects, scratchTerminals, openEntitiesInOrder]);

  // Filter items by query (searches the full display label)
  const filteredItems = useMemo(() => {
    if (!query.trim()) return allItems;

    const lowerQuery = query.toLowerCase();
    return allItems.filter((item) => {
      const label = getItemLabel(item);
      return label.toLowerCase().includes(lowerQuery);
    });
  }, [allItems, query]);

  // Handle item selection
  const handleSelect = useCallback(
    (index: number) => {
      const item = filteredItems[index];
      if (!item) return;

      switch (item.type) {
        case 'action':
          onExecute(item.id);
          break;
        case 'task':
          onRunTask(item.name);
          break;
        case 'scratch':
          onNavigate('scratch', item.id);
          break;
        case 'project':
          onNavigate('project', item.id);
          break;
        case 'worktree':
          onNavigate('worktree', item.id);
          break;
      }
      onClose();
    },
    [filteredItems, onExecute, onRunTask, onNavigate, onClose]
  );

  // Keyboard navigation
  const { highlightedIndex, setHighlightedIndex, handleKeyDown } = useModalNavigation({
    itemCount: filteredItems.length,
    onSelect: handleSelect,
    onClose,
  });

  return (
    <ModalContainer onClose={onClose} onModalOpen={onModalOpen} onModalClose={onModalClose}>
      <ModalSearchInput
        value={query}
        onChange={setQuery}
        placeholder="Type a command..."
        onKeyDown={handleKeyDown}
      />

      <ModalList isEmpty={filteredItems.length === 0} emptyMessage="No commands found">
        {filteredItems.map((item, index) => {
          const isHighlighted = index === highlightedIndex;
          const label = getItemLabel(item);
          const shortcut = item.type === 'action' ? item.shortcut : undefined;

          return (
            <ModalListItem
              key={
                item.type === 'action' ? item.id :
                item.type === 'task' ? `task-${item.name}` :
                `${item.type}-${item.id}`
              }
              isHighlighted={isHighlighted}
              onClick={() => handleSelect(index)}
              onMouseEnter={() => setHighlightedIndex(index)}
              rightContent={
                shortcut && (
                  <span className="text-xs font-mono" style={{ color: 'var(--modal-item-text-muted)' }}>{shortcut}</span>
                )
              }
            >
              <div className="text-sm">{label}</div>
            </ModalListItem>
          );
        })}
      </ModalList>

      <ModalFooter>
        <div>
          <KeyHint keys={['↑↓']} label="" />
          <span className="mx-1">or</span>
          <KeyHint keys={[isMac ? '⌘' : 'Ctrl', 'J/K']} label="navigate" />
        </div>
        <div>
          <KeyHint keys={['Enter']} label="run" />
        </div>
      </ModalFooter>
    </ModalContainer>
  );
}

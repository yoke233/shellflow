import { useState, useMemo, useCallback } from 'react';
import { TaskConfig } from '../../hooks/useConfig';
import {
  ModalContainer,
  ModalSearchInput,
  ModalList,
  ModalListItem,
  ModalFooter,
  KeyHint,
  useModalNavigation,
} from '../Modal';

interface TaskSwitcherProps {
  tasks: TaskConfig[];
  selectedTask: string | null;
  runningTasks: Array<{ taskName: string; status: 'running' | 'stopping' | 'stopped' }>;
  onSelect: (taskName: string) => void;
  onRun: (taskName: string) => void;
  onClose: () => void;
  onModalOpen?: () => void;
  onModalClose?: () => void;
}

export function TaskSwitcher({
  tasks,
  selectedTask,
  runningTasks,
  onSelect,
  onRun,
  onClose,
  onModalOpen,
  onModalClose,
}: TaskSwitcherProps) {
  const [query, setQuery] = useState('');

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  // Filter tasks based on query (match name only)
  const filteredTasks = useMemo(() => {
    if (!query.trim()) return tasks;
    const lowerQuery = query.toLowerCase();
    return tasks.filter((task) => task.name.toLowerCase().includes(lowerQuery));
  }, [tasks, query]);

  // Check if a task is running
  const isTaskRunning = useCallback(
    (taskName: string) => {
      return runningTasks.some((t) => t.taskName === taskName && t.status === 'running');
    },
    [runningTasks]
  );

  // Handle task selection
  const handleSelect = useCallback(
    (index: number) => {
      const task = filteredTasks[index];
      if (task) {
        onSelect(task.name);
      }
    },
    [filteredTasks, onSelect]
  );

  // Keyboard navigation with custom Enter handling for Cmd+Enter
  const { highlightedIndex, setHighlightedIndex, handleKeyDown: baseHandleKeyDown } = useModalNavigation({
    itemCount: filteredTasks.length,
    onSelect: handleSelect,
    onClose,
  });

  // Custom key handler to support Cmd+Enter for running tasks
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter' && filteredTasks.length > 0) {
        e.preventDefault();
        const task = filteredTasks[highlightedIndex];
        if ((isMac && e.metaKey) || (!isMac && e.ctrlKey)) {
          // Cmd/Ctrl+Enter: run the task
          onRun(task.name);
        } else {
          // Enter: select the task
          onSelect(task.name);
        }
        return;
      }
      baseHandleKeyDown(e);
    },
    [filteredTasks, highlightedIndex, isMac, onSelect, onRun, baseHandleKeyDown]
  );

  return (
    <ModalContainer onClose={onClose} onModalOpen={onModalOpen} onModalClose={onModalClose}>
      <ModalSearchInput
        value={query}
        onChange={setQuery}
        placeholder="Search tasks..."
        onKeyDown={handleKeyDown}
      />

      <ModalList isEmpty={filteredTasks.length === 0} emptyMessage="No tasks found">
        {filteredTasks.map((task, index) => {
          const isHighlighted = index === highlightedIndex;
          const isRunning = isTaskRunning(task.name);
          const isSelected = task.name === selectedTask;

          return (
            <ModalListItem
              key={task.name}
              isHighlighted={isHighlighted}
              onClick={() => onSelect(task.name)}
              onMouseEnter={() => setHighlightedIndex(index)}
              rightContent={
                isRunning && (
                  <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                )
              }
            >
              <div
                className={`text-sm truncate ${
                  isSelected ? 'text-blue-400' : 'text-zinc-100'
                }`}
              >
                {task.name}
              </div>
              <div className="text-xs text-zinc-500 truncate">{task.command}</div>
            </ModalListItem>
          );
        })}
      </ModalList>

      <ModalFooter>
        <div>
          <KeyHint keys={[isMac ? '⌘' : 'Ctrl', 'J/K']} label="navigate" />
        </div>
        <div>
          <KeyHint keys={['Enter']} label="select" />
          <span className="mx-1.5">|</span>
          <KeyHint keys={[isMac ? '⌘' : 'Ctrl', 'Enter']} label="run" />
        </div>
      </ModalFooter>
    </ModalContainer>
  );
}

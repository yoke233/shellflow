import { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { TaskConfig } from '../../hooks/useConfig';

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
  const [highlightedIndex, setHighlightedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  // Filter tasks based on query (match name or command)
  const filteredTasks = useMemo(() => {
    if (!query.trim()) return tasks;
    const lowerQuery = query.toLowerCase();
    return tasks.filter(
      (task) =>
        task.name.toLowerCase().includes(lowerQuery) ||
        task.command.toLowerCase().includes(lowerQuery)
    );
  }, [tasks, query]);

  // Reset highlighted index when filtered tasks change
  useEffect(() => {
    setHighlightedIndex(0);
  }, [filteredTasks.length]);

  // Auto-focus input on mount
  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Register modal open/close for app-wide tracking
  useEffect(() => {
    onModalOpen?.();
    return () => onModalClose?.();
  }, [onModalOpen, onModalClose]);

  // Scroll highlighted item into view
  useEffect(() => {
    const listElement = listRef.current;
    if (!listElement) return;

    const highlightedElement = listElement.children[highlightedIndex] as HTMLElement;
    if (highlightedElement) {
      highlightedElement.scrollIntoView({ block: 'nearest' });
    }
  }, [highlightedIndex]);

  // Check if a task is running
  const isTaskRunning = useCallback(
    (taskName: string) => {
      return runningTasks.some((t) => t.taskName === taskName && t.status === 'running');
    },
    [runningTasks]
  );

  // Handle keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      // Navigate down: ArrowDown, Ctrl+N (macOS), Ctrl+J (vim)
      if (e.key === 'ArrowDown' || (e.ctrlKey && (e.key === 'n' || e.key === 'j'))) {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev < filteredTasks.length - 1 ? prev + 1 : 0
        );
        return;
      }

      // Navigate up: ArrowUp, Ctrl+P (macOS), Ctrl+K (vim)
      if (e.key === 'ArrowUp' || (e.ctrlKey && (e.key === 'p' || e.key === 'k'))) {
        e.preventDefault();
        setHighlightedIndex((prev) =>
          prev > 0 ? prev - 1 : filteredTasks.length - 1
        );
        return;
      }

      switch (e.key) {
        case 'Enter':
          e.preventDefault();
          if (filteredTasks.length > 0) {
            const task = filteredTasks[highlightedIndex];
            if ((isMac && e.metaKey) || (!isMac && e.ctrlKey)) {
              // Cmd/Ctrl+Enter: run the task
              onRun(task.name);
            } else {
              // Enter: select the task
              onSelect(task.name);
            }
          }
          break;
        case 'Escape':
          e.preventDefault();
          onClose();
          break;
      }
    },
    [filteredTasks, highlightedIndex, isMac, onSelect, onRun, onClose]
  );

  // Handle clicking outside to close
  const handleBackdropClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === e.currentTarget) {
        onClose();
      }
    },
    [onClose]
  );

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-24"
      onClick={handleBackdropClick}
    >
      <div className="absolute inset-0 bg-black/50" />
      <div
        className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl w-full max-w-md mx-4 overflow-hidden"
        onKeyDown={handleKeyDown}
      >
        {/* Search input */}
        <div className="p-3 border-b border-zinc-700">
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search tasks..."
            className="w-full bg-zinc-800 text-zinc-100 text-sm px-3 py-2 rounded border border-zinc-600 focus:border-blue-500 focus:outline-none placeholder-zinc-500"
          />
        </div>

        {/* Task list */}
        <div ref={listRef} className="max-h-64 overflow-y-auto">
          {filteredTasks.length === 0 ? (
            <div className="px-3 py-4 text-sm text-zinc-500 text-center">
              No tasks found
            </div>
          ) : (
            filteredTasks.map((task, index) => {
              const isHighlighted = index === highlightedIndex;
              const isRunning = isTaskRunning(task.name);
              const isSelected = task.name === selectedTask;

              return (
                <button
                  key={task.name}
                  onClick={() => onSelect(task.name)}
                  onDoubleClick={() => onRun(task.name)}
                  onMouseEnter={() => setHighlightedIndex(index)}
                  className={`w-full px-3 py-2 text-left flex items-center gap-2 ${
                    isHighlighted ? 'bg-zinc-800' : ''
                  }`}
                >
                  {/* Running indicator */}
                  {isRunning && (
                    <div className="w-2 h-2 rounded-full bg-green-500 flex-shrink-0" />
                  )}

                  {/* Task info */}
                  <div className="flex-1 min-w-0">
                    <div
                      className={`text-sm truncate ${
                        isSelected ? 'text-blue-400' : 'text-zinc-100'
                      }`}
                    >
                      {task.name}
                    </div>
                    <div className="text-xs text-zinc-500 truncate">
                      {task.command}
                    </div>
                  </div>

                </button>
              );
            })
          )}
        </div>

        {/* Footer with hints */}
        <div className="px-3 py-2 border-t border-zinc-700 text-[10px] text-zinc-500 flex justify-between">
          <div>
            <kbd className="px-1 py-0.5 bg-zinc-800 rounded">&uarr;</kbd>
            <kbd className="px-1 py-0.5 bg-zinc-800 rounded ml-1">&darr;</kbd> navigate
          </div>
          <div>
            <kbd className="px-1 py-0.5 bg-zinc-800 rounded">Enter</kbd> select
            <span className="mx-1.5">|</span>
            <kbd className="px-1 py-0.5 bg-zinc-800 rounded">{isMac ? '⌘' : 'Ctrl'}+Enter</kbd> run
          </div>
        </div>
      </div>
    </div>
  );
}

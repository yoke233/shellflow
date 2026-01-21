import { Play, Square, ChevronDown, Skull } from 'lucide-react';
import { TaskConfig } from '../../hooks/useConfig';
import { RunningTask } from '../../types';
import { useState, useRef, useEffect } from 'react';

interface TaskSelectorProps {
  tasks: TaskConfig[];
  selectedTask: string | null;
  runningTask: RunningTask | null;
  onSelectTask: (taskName: string) => void;
  onStartTask: () => void;
  onStopTask: () => void;
  onForceKillTask: () => void;
}

export function TaskSelector({
  tasks,
  selectedTask,
  runningTask,
  onSelectTask,
  onStartTask,
  onStopTask,
  onForceKillTask,
}: TaskSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      return () => document.removeEventListener('mousedown', handleClickOutside);
    }
  }, [isOpen]);

  if (tasks.length === 0) {
    return null;
  }

  const currentTask = tasks.find((t) => t.name === selectedTask);
  // Check if the selected task is running or stopping
  const isSelectedTaskRunning =
    runningTask?.status === 'running' &&
    runningTask?.taskName === selectedTask;
  const isSelectedTaskStopping =
    runningTask?.status === 'stopping' &&
    runningTask?.taskName === selectedTask;

  return (
    <div className="flex items-center gap-1 h-8 px-1 border-t border-zinc-800 flex-shrink-0">
      {/* Task dropdown */}
      <div ref={dropdownRef} className="relative flex-1 min-w-0">
        <button
          onClick={() => setIsOpen(!isOpen)}
          className="flex items-center justify-between w-full gap-1 px-2 py-1 text-sm text-zinc-300 bg-zinc-800 rounded hover:bg-zinc-700"
        >
          <span className="truncate">{currentTask?.name || 'Select task...'}</span>
          <ChevronDown size={14} className="flex-shrink-0 text-zinc-500" />
        </button>

        {isOpen && (
          <div className="absolute bottom-full left-0 right-0 mb-1 py-1 bg-zinc-800 border border-zinc-700 rounded shadow-lg z-50 max-h-48 overflow-y-auto">
            {tasks.map((task) => (
              <button
                key={task.name}
                onClick={() => {
                  onSelectTask(task.name);
                  setIsOpen(false);
                }}
                className={`w-full px-2 py-1 text-sm text-left hover:bg-zinc-700 ${
                  task.name === selectedTask ? 'text-blue-400' : 'text-zinc-300'
                }`}
              >
                <div className="truncate">{task.name}</div>
                <div className="text-xs text-zinc-500 truncate">{task.command}</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Play/Stop/Kill buttons */}
      {isSelectedTaskStopping ? (
        <button
          onClick={onForceKillTask}
          className="p-1.5 rounded text-orange-400 hover:bg-zinc-800 flex-shrink-0 animate-pulse"
          title="Force kill task (SIGKILL)"
        >
          <Skull size={16} />
        </button>
      ) : isSelectedTaskRunning ? (
        <button
          onClick={onStopTask}
          className="p-1.5 rounded text-red-400 hover:bg-zinc-800 flex-shrink-0"
          title="Stop task"
        >
          <Square size={16} />
        </button>
      ) : (
        <button
          onClick={onStartTask}
          disabled={!selectedTask}
          className={`p-1.5 rounded flex-shrink-0 ${
            selectedTask
              ? 'text-green-400 hover:bg-zinc-800'
              : 'text-zinc-600 cursor-not-allowed'
          }`}
          title={selectedTask ? 'Start task' : 'Select a task first'}
        >
          <Play size={16} />
        </button>
      )}
    </div>
  );
}

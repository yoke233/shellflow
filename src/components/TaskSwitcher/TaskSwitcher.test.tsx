import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TaskSwitcher } from './TaskSwitcher';
import { resetMocks } from '../../test/setup';
import type { TaskConfig } from '../../hooks/useConfig';

describe('TaskSwitcher', () => {
  const createTask = (overrides: Partial<TaskConfig> = {}): TaskConfig => ({
    name: 'test-task',
    command: 'npm run test',
    ...overrides,
  });

  const defaultProps = {
    tasks: [],
    selectedTask: null,
    runningTasks: [] as Array<{ taskName: string; status: 'running' | 'stopping' | 'stopped' }>,
    onSelect: vi.fn(),
    onRun: vi.fn(),
    onClose: vi.fn(),
    onModalOpen: vi.fn(),
    onModalClose: vi.fn(),
  };

  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders search input', () => {
      render(<TaskSwitcher {...defaultProps} />);
      expect(screen.getByPlaceholderText('Search tasks...')).toBeInTheDocument();
    });

    it('renders empty message when no tasks', () => {
      render(<TaskSwitcher {...defaultProps} />);
      expect(screen.getByText('No tasks found')).toBeInTheDocument();
    });

    it('renders task list', () => {
      const tasks = [
        createTask({ name: 'build', command: 'npm run build' }),
        createTask({ name: 'test', command: 'npm test' }),
      ];

      render(<TaskSwitcher {...defaultProps} tasks={tasks} />);

      expect(screen.getByText('build')).toBeInTheDocument();
      expect(screen.getByText('test')).toBeInTheDocument();
    });

    it('shows task commands', () => {
      const tasks = [createTask({ name: 'lint', command: 'eslint src/' })];

      render(<TaskSwitcher {...defaultProps} tasks={tasks} />);

      expect(screen.getByText('eslint src/')).toBeInTheDocument();
    });

    it('highlights selected task', () => {
      const tasks = [
        createTask({ name: 'selected-task' }),
        createTask({ name: 'other-task' }),
      ];

      render(<TaskSwitcher {...defaultProps} tasks={tasks} selectedTask="selected-task" />);

      const selectedTask = screen.getByText('selected-task');
      expect(selectedTask).toHaveStyle({ color: 'rgb(96, 165, 250)' });
    });

    it('shows running indicator for running tasks', () => {
      const tasks = [createTask({ name: 'running-task' })];
      const runningTasks = [{ taskName: 'running-task', status: 'running' as const }];

      render(<TaskSwitcher {...defaultProps} tasks={tasks} runningTasks={runningTasks} />);

      // Should show green running dot - traverse up to find the list item container
      const taskText = screen.getByText('running-task');
      // Find the parent that contains both the task name and the indicator
      let container = taskText.parentElement;
      while (container && !container.querySelector('.bg-green-500')) {
        container = container.parentElement;
      }
      const indicator = container?.querySelector('.bg-green-500');
      expect(indicator).toBeInTheDocument();
    });

    it('renders keyboard hints', () => {
      render(<TaskSwitcher {...defaultProps} />);

      expect(screen.getByText('navigate')).toBeInTheDocument();
      expect(screen.getByText('select')).toBeInTheDocument();
      expect(screen.getByText('run')).toBeInTheDocument();
    });
  });

  describe('filtering', () => {
    it('filters tasks by name', async () => {
      const tasks = [
        createTask({ name: 'build-dev' }),
        createTask({ name: 'test-unit' }),
      ];
      const user = userEvent.setup();

      render(<TaskSwitcher {...defaultProps} tasks={tasks} />);

      await user.type(screen.getByPlaceholderText('Search tasks...'), 'build');

      expect(screen.getByText('build-dev')).toBeInTheDocument();
      expect(screen.queryByText('test-unit')).not.toBeInTheDocument();
    });

    it('is case insensitive', async () => {
      const tasks = [createTask({ name: 'MyTask' })];
      const user = userEvent.setup();

      render(<TaskSwitcher {...defaultProps} tasks={tasks} />);

      await user.type(screen.getByPlaceholderText('Search tasks...'), 'mytask');

      expect(screen.getByText('MyTask')).toBeInTheDocument();
    });

    it('shows empty message when no matches', async () => {
      const tasks = [createTask({ name: 'existing-task' })];
      const user = userEvent.setup();

      render(<TaskSwitcher {...defaultProps} tasks={tasks} />);

      await user.type(screen.getByPlaceholderText('Search tasks...'), 'nonexistent');

      expect(screen.getByText('No tasks found')).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    it('calls onSelect when task is clicked', async () => {
      const tasks = [createTask({ name: 'clickable-task' })];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<TaskSwitcher {...defaultProps} tasks={tasks} onSelect={onSelect} />);

      await user.click(screen.getByText('clickable-task'));

      expect(onSelect).toHaveBeenCalledWith('clickable-task');
    });

    it('calls onSelect with Enter key', async () => {
      const tasks = [createTask({ name: 'first-task' })];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<TaskSwitcher {...defaultProps} tasks={tasks} onSelect={onSelect} />);

      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('first-task');
    });

    it('calls onRun with Cmd+Enter', async () => {
      const tasks = [createTask({ name: 'runnable-task' })];
      const onRun = vi.fn();
      const user = userEvent.setup();

      render(<TaskSwitcher {...defaultProps} tasks={tasks} onRun={onRun} />);

      await user.keyboard('{Meta>}{Enter}{/Meta}');

      expect(onRun).toHaveBeenCalledWith('runnable-task');
    });
  });

  describe('keyboard navigation', () => {
    it('navigates down with ArrowDown', async () => {
      const tasks = [
        createTask({ name: 'first' }),
        createTask({ name: 'second' }),
      ];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<TaskSwitcher {...defaultProps} tasks={tasks} onSelect={onSelect} />);

      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('second');
    });

    it('navigates up with ArrowUp', async () => {
      const tasks = [
        createTask({ name: 'first' }),
        createTask({ name: 'second' }),
      ];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<TaskSwitcher {...defaultProps} tasks={tasks} onSelect={onSelect} />);

      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowUp}');
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('first');
    });

    it('wraps around when navigating past end', async () => {
      const tasks = [
        createTask({ name: 'first' }),
        createTask({ name: 'second' }),
      ];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<TaskSwitcher {...defaultProps} tasks={tasks} onSelect={onSelect} />);

      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('first');
    });

    it('closes on Escape', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();

      render(<TaskSwitcher {...defaultProps} onClose={onClose} />);

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalled();
    });

    it('navigates with Cmd+J/K on Mac', async () => {
      const tasks = [
        createTask({ name: 'first' }),
        createTask({ name: 'second' }),
      ];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<TaskSwitcher {...defaultProps} tasks={tasks} onSelect={onSelect} />);

      // Cmd+J should go down
      await user.keyboard('{Meta>}j{/Meta}');
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('second');
    });
  });

  describe('mouse interaction', () => {
    it('highlights task on hover', async () => {
      const tasks = [
        createTask({ name: 'first' }),
        createTask({ name: 'second' }),
      ];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<TaskSwitcher {...defaultProps} tasks={tasks} onSelect={onSelect} />);

      await user.hover(screen.getByText('second'));
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('second');
    });
  });

  describe('running tasks', () => {
    it('does not show indicator for stopped tasks', () => {
      const tasks = [createTask({ name: 'stopped-task' })];
      const runningTasks = [{ taskName: 'stopped-task', status: 'stopped' as const }];

      render(<TaskSwitcher {...defaultProps} tasks={tasks} runningTasks={runningTasks} />);

      // Should not show green running dot
      const indicator = screen.getByText('stopped-task').closest('div')?.parentElement?.querySelector('.bg-green-500');
      expect(indicator).not.toBeInTheDocument();
    });

    it('does not show indicator for stopping tasks', () => {
      const tasks = [createTask({ name: 'stopping-task' })];
      const runningTasks = [{ taskName: 'stopping-task', status: 'stopping' as const }];

      render(<TaskSwitcher {...defaultProps} tasks={tasks} runningTasks={runningTasks} />);

      const indicator = screen.getByText('stopping-task').closest('div')?.parentElement?.querySelector('.bg-green-500');
      expect(indicator).not.toBeInTheDocument();
    });
  });

  describe('modal callbacks', () => {
    it('calls onModalOpen on mount', () => {
      const onModalOpen = vi.fn();

      render(<TaskSwitcher {...defaultProps} onModalOpen={onModalOpen} />);

      expect(onModalOpen).toHaveBeenCalled();
    });

    it('calls onModalClose on unmount', () => {
      const onModalClose = vi.fn();

      const { unmount } = render(<TaskSwitcher {...defaultProps} onModalClose={onModalClose} />);

      unmount();

      expect(onModalClose).toHaveBeenCalled();
    });
  });
});

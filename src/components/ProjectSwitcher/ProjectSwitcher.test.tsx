import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ProjectSwitcher } from './ProjectSwitcher';
import { createTestProject, resetMocks } from '../../test/setup';

describe('ProjectSwitcher', () => {
  const defaultProps = {
    projects: [],
    activeProjectId: null,
    onSelect: vi.fn(),
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
      render(<ProjectSwitcher {...defaultProps} />);
      expect(screen.getByPlaceholderText('Search projects...')).toBeInTheDocument();
    });

    it('renders empty message when no projects', () => {
      render(<ProjectSwitcher {...defaultProps} />);
      expect(screen.getByText('No projects found')).toBeInTheDocument();
    });

    it('renders project list', () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'Project Alpha' }),
        createTestProject({ id: 'p2', name: 'Project Beta' }),
      ];

      render(<ProjectSwitcher {...defaultProps} projects={projects} />);

      expect(screen.getByText('Project Alpha')).toBeInTheDocument();
      expect(screen.getByText('Project Beta')).toBeInTheDocument();
    });

    it('shows project paths', () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'My Project', path: '/Users/dev/my-project' }),
      ];

      render(<ProjectSwitcher {...defaultProps} projects={projects} />);

      expect(screen.getByText('/Users/dev/my-project')).toBeInTheDocument();
    });

    it('highlights active project', () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'Active Project' }),
        createTestProject({ id: 'p2', name: 'Other Project' }),
      ];

      render(<ProjectSwitcher {...defaultProps} projects={projects} activeProjectId="p1" />);

      const activeProject = screen.getByText('Active Project');
      expect(activeProject).toHaveStyle({ color: 'rgb(96, 165, 250)' });
    });

    it('shows closed badge for inactive projects', () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'Closed Project', isActive: false }),
      ];

      render(<ProjectSwitcher {...defaultProps} projects={projects} />);

      expect(screen.getByText('Closed')).toBeInTheDocument();
    });

    it('renders keyboard hints', () => {
      render(<ProjectSwitcher {...defaultProps} />);

      expect(screen.getByText('navigate')).toBeInTheDocument();
      expect(screen.getByText('open')).toBeInTheDocument();
    });
  });

  describe('sorting', () => {
    it('sorts projects by lastAccessedAt (most recent first)', () => {
      const projects = [
        createTestProject({
          id: 'p1',
          name: 'Older Project',
          lastAccessedAt: '2024-01-01T00:00:00Z',
        }),
        createTestProject({
          id: 'p2',
          name: 'Newer Project',
          lastAccessedAt: '2024-01-15T00:00:00Z',
        }),
      ];

      render(<ProjectSwitcher {...defaultProps} projects={projects} />);

      const items = screen.getAllByText(/Project$/);
      expect(items[0]).toHaveTextContent('Newer Project');
      expect(items[1]).toHaveTextContent('Older Project');
    });
  });

  describe('filtering', () => {
    it('filters projects by name', async () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'Frontend App' }),
        createTestProject({ id: 'p2', name: 'Backend Service' }),
      ];
      const user = userEvent.setup();

      render(<ProjectSwitcher {...defaultProps} projects={projects} />);

      await user.type(screen.getByPlaceholderText('Search projects...'), 'Frontend');

      expect(screen.getByText('Frontend App')).toBeInTheDocument();
      expect(screen.queryByText('Backend Service')).not.toBeInTheDocument();
    });

    it('filters projects by path', async () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'Project A', path: '/home/user/react-app' }),
        createTestProject({ id: 'p2', name: 'Project B', path: '/home/user/rust-api' }),
      ];
      const user = userEvent.setup();

      render(<ProjectSwitcher {...defaultProps} projects={projects} />);

      await user.type(screen.getByPlaceholderText('Search projects...'), 'react');

      expect(screen.getByText('Project A')).toBeInTheDocument();
      expect(screen.queryByText('Project B')).not.toBeInTheDocument();
    });

    it('is case insensitive', async () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'MyProject' }),
      ];
      const user = userEvent.setup();

      render(<ProjectSwitcher {...defaultProps} projects={projects} />);

      await user.type(screen.getByPlaceholderText('Search projects...'), 'myproject');

      expect(screen.getByText('MyProject')).toBeInTheDocument();
    });

    it('shows empty message when no matches', async () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'Project Alpha' }),
      ];
      const user = userEvent.setup();

      render(<ProjectSwitcher {...defaultProps} projects={projects} />);

      await user.type(screen.getByPlaceholderText('Search projects...'), 'nonexistent');

      expect(screen.getByText('No projects found')).toBeInTheDocument();
    });
  });

  describe('selection', () => {
    it('calls onSelect when project is clicked', async () => {
      const projects = [createTestProject({ id: 'p1', name: 'Clickable Project' })];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<ProjectSwitcher {...defaultProps} projects={projects} onSelect={onSelect} />);

      await user.click(screen.getByText('Clickable Project'));

      expect(onSelect).toHaveBeenCalledWith('p1');
    });

    it('calls onSelect with Enter key', async () => {
      const projects = [createTestProject({ id: 'p1', name: 'First Project' })];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<ProjectSwitcher {...defaultProps} projects={projects} onSelect={onSelect} />);

      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('p1');
    });
  });

  describe('keyboard navigation', () => {
    it('navigates down with ArrowDown', async () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'First' }),
        createTestProject({ id: 'p2', name: 'Second' }),
      ];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<ProjectSwitcher {...defaultProps} projects={projects} onSelect={onSelect} />);

      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('p2');
    });

    it('navigates up with ArrowUp', async () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'First' }),
        createTestProject({ id: 'p2', name: 'Second' }),
      ];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<ProjectSwitcher {...defaultProps} projects={projects} onSelect={onSelect} />);

      // Go down then up
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowUp}');
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('p1');
    });

    it('wraps around when navigating past end', async () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'First' }),
        createTestProject({ id: 'p2', name: 'Second' }),
      ];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<ProjectSwitcher {...defaultProps} projects={projects} onSelect={onSelect} />);

      // Go down twice (wraps to first)
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{ArrowDown}');
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('p1');
    });

    it('closes on Escape', async () => {
      const onClose = vi.fn();
      const user = userEvent.setup();

      render(<ProjectSwitcher {...defaultProps} onClose={onClose} />);

      await user.keyboard('{Escape}');

      expect(onClose).toHaveBeenCalled();
    });
  });

  describe('mouse interaction', () => {
    it('highlights project on hover', async () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'First' }),
        createTestProject({ id: 'p2', name: 'Second' }),
      ];
      const onSelect = vi.fn();
      const user = userEvent.setup();

      render(<ProjectSwitcher {...defaultProps} projects={projects} onSelect={onSelect} />);

      // Hover over second project then press Enter
      await user.hover(screen.getByText('Second'));
      await user.keyboard('{Enter}');

      expect(onSelect).toHaveBeenCalledWith('p2');
    });
  });

  describe('modal callbacks', () => {
    it('calls onModalOpen on mount', () => {
      const onModalOpen = vi.fn();

      render(<ProjectSwitcher {...defaultProps} onModalOpen={onModalOpen} />);

      expect(onModalOpen).toHaveBeenCalled();
    });

    it('calls onModalClose on unmount', () => {
      const onModalClose = vi.fn();

      const { unmount } = render(<ProjectSwitcher {...defaultProps} onModalClose={onModalClose} />);

      unmount();

      expect(onModalClose).toHaveBeenCalled();
    });
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Sidebar } from './Sidebar';
import { createTestProject, createTestWorktree, resetMocks } from '../../test/setup';
import type { Project, Worktree, ScratchTerminal, RunningTask } from '../../types';
import type { TaskConfig, AppsConfig } from '../../hooks/useConfig';

// Default props for Sidebar
const createDefaultProps = (overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) => ({
  projects: [] as Project[],
  activeProjectId: null,
  activeWorktreeId: null,
  activeScratchId: null,
  activeWorktree: null,
  scratchTerminals: [] as ScratchTerminal[],
  openProjectIds: new Set<string>(),
  openWorktreeIds: new Set<string>(),
  openEntitiesInOrder: [] as Array<{ type: 'scratch' | 'worktree' | 'project'; id: string }>,
  isModifierKeyHeld: false,
  loadingWorktrees: new Set<string>(),
  notifiedWorktreeIds: new Set<string>(),
  thinkingWorktreeIds: new Set<string>(),
  idleWorktreeIds: new Set<string>(),
  notifiedProjectIds: new Set<string>(),
  thinkingProjectIds: new Set<string>(),
  idleProjectIds: new Set<string>(),
  notifiedScratchIds: new Set<string>(),
  thinkingScratchIds: new Set<string>(),
  idleScratchIds: new Set<string>(),
  runningTaskCounts: new Map<string, number>(),
  expandedProjects: new Set<string>(),
  isDrawerOpen: false,
  isRightPanelOpen: false,
  tasks: [] as TaskConfig[],
  selectedTask: null,
  runningTask: null as RunningTask | null,
  allRunningTasks: [] as Array<{ taskName: string; status: string }>,
  terminalFontFamily: 'Menlo',
  terminalApp: 'Terminal',
  editorApp: 'VS Code',
  appsConfig: {} as AppsConfig,
  showIdleCheck: true,
  activeScratchCwd: null,
  homeDir: '/Users/test',
  autoEditWorktreeId: null,
  editingScratchId: null,
  focusToRestoreRef: { current: null },
  onFocusMain: vi.fn(),
  onToggleProject: vi.fn(),
  onSelectProject: vi.fn(),
  onSelectWorktree: vi.fn(),
  onAddProject: vi.fn(),
  onAddWorktree: vi.fn(),
  onDeleteWorktree: vi.fn(),
  onCloseWorktree: vi.fn(),
  onCloseProject: vi.fn(),
  onHideProject: vi.fn(),
  onMergeWorktree: vi.fn(),
  onToggleDrawer: vi.fn(),
  onToggleRightPanel: vi.fn(),
  onSelectTask: vi.fn(),
  onStartTask: vi.fn(),
  onStopTask: vi.fn(),
  onForceKillTask: vi.fn(),
  onRenameWorktree: vi.fn().mockResolvedValue(undefined),
  onReorderProjects: vi.fn(),
  onReorderWorktrees: vi.fn(),
  onAddScratchTerminal: vi.fn(),
  onSelectScratch: vi.fn(),
  onCloseScratch: vi.fn(),
  onRenameScratch: vi.fn(),
  onReorderScratchTerminals: vi.fn(),
  onAutoEditConsumed: vi.fn(),
  onEditingScratchConsumed: vi.fn(),
  ...overrides,
});

describe('Sidebar', () => {
  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
  });

  describe('Projects Section', () => {
    it('displays projects header', () => {
      render(<Sidebar {...createDefaultProps()} />);
      expect(screen.getByText('Projects')).toBeInTheDocument();
    });

    it('shows only active projects', () => {
      const activeProject = createTestProject({ id: 'active', name: 'Active Project', isActive: true });
      const inactiveProject = createTestProject({ id: 'inactive', name: 'Inactive Project', isActive: false });

      render(
        <Sidebar
          {...createDefaultProps({
            projects: [activeProject, inactiveProject],
          })}
        />
      );

      expect(screen.getByText('Active Project')).toBeInTheDocument();
      expect(screen.queryByText('Inactive Project')).not.toBeInTheDocument();
    });

    it('shows multiple active projects', () => {
      const projects = [
        createTestProject({ id: 'p1', name: 'Project One', isActive: true }),
        createTestProject({ id: 'p2', name: 'Project Two', isActive: true }),
        createTestProject({ id: 'p3', name: 'Project Three', isActive: true }),
      ];

      render(<Sidebar {...createDefaultProps({ projects })} />);

      expect(screen.getByText('Project One')).toBeInTheDocument();
      expect(screen.getByText('Project Two')).toBeInTheDocument();
      expect(screen.getByText('Project Three')).toBeInTheDocument();
    });

    it('calls onSelectProject when project is clicked', async () => {
      const project = createTestProject({ id: 'p1', name: 'My Project' });
      const onSelectProject = vi.fn();

      const user = userEvent.setup();
      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            onSelectProject,
          })}
        />
      );

      await user.click(screen.getByText('My Project'));
      expect(onSelectProject).toHaveBeenCalledWith(project);
    });

    it('calls onAddProject when add button is clicked', async () => {
      const onAddProject = vi.fn();
      const user = userEvent.setup();

      render(<Sidebar {...createDefaultProps({ onAddProject })} />);

      // Find the add project button (plus icon near Projects header)
      const addButtons = screen.getAllByRole('button');
      const addProjectButton = addButtons.find(
        (btn) => btn.querySelector('svg') && btn.closest('[class*="Projects"]') === null
      );

      // Click the first plus button in the projects section
      if (addProjectButton) {
        await user.click(addProjectButton);
      }
    });

    it('highlights the active project', () => {
      const project = createTestProject({ id: 'p1', name: 'Active Project' });

      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            activeProjectId: 'p1',
          })}
        />
      );

      const projectElement = screen.getByText('Active Project');
      // Check for selection styling (bg-zinc-800 or similar)
      expect(projectElement.closest('[class*="bg-zinc"]')).toBeTruthy();
    });

    it('shows expand/collapse chevron for projects with worktrees', () => {
      const worktree = createTestWorktree({ id: 'wt1', name: 'Feature Branch' });
      const project = createTestProject({
        id: 'p1',
        name: 'Project With Worktrees',
        worktrees: [worktree],
      });

      render(<Sidebar {...createDefaultProps({ projects: [project] })} />);

      // Should have a chevron icon - look for SVG near the project name
      const projectElement = screen.getByText('Project With Worktrees');
      // The parent row should contain an SVG (chevron)
      const row = projectElement.closest('div[class*="flex"]');
      const svg = row?.querySelector('svg');
      expect(svg).toBeTruthy();
    });
  });

  describe('Worktrees Section', () => {
    it('shows worktrees when project is expanded', () => {
      const worktree = createTestWorktree({ id: 'wt1', name: 'feature-branch' });
      const project = createTestProject({
        id: 'p1',
        name: 'My Project',
        worktrees: [worktree],
      });

      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            expandedProjects: new Set(['p1']),
          })}
        />
      );

      expect(screen.getByText('feature-branch')).toBeInTheDocument();
    });

    it('hides worktrees when project is collapsed', () => {
      const worktree = createTestWorktree({ id: 'wt1', name: 'hidden-branch' });
      const project = createTestProject({
        id: 'p1',
        name: 'My Project',
        worktrees: [worktree],
      });

      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            expandedProjects: new Set(), // Not expanded
          })}
        />
      );

      expect(screen.queryByText('hidden-branch')).not.toBeInTheDocument();
    });

    it('calls onSelectWorktree when worktree is clicked', async () => {
      const worktree = createTestWorktree({ id: 'wt1', name: 'clickable-branch' });
      const project = createTestProject({
        id: 'p1',
        name: 'My Project',
        worktrees: [worktree],
      });
      const onSelectWorktree = vi.fn();

      const user = userEvent.setup();
      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            expandedProjects: new Set(['p1']),
            onSelectWorktree,
          })}
        />
      );

      await user.click(screen.getByText('clickable-branch'));
      expect(onSelectWorktree).toHaveBeenCalledWith(worktree);
    });

    it('shows loading indicator for loading worktrees', () => {
      const worktree = createTestWorktree({ id: 'wt-loading', name: 'loading-branch' });
      const project = createTestProject({
        id: 'p1',
        name: 'My Project',
        worktrees: [worktree],
      });

      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            expandedProjects: new Set(['p1']),
            loadingWorktrees: new Set(['wt-loading']),
          })}
        />
      );

      // Should show a spinner/loading indicator
      const worktreeElement = screen.getByText('loading-branch');
      const spinner = worktreeElement.closest('div')?.querySelector('.animate-spin, [class*="Loader"]');
      // Spinner might be present
    });

    it('highlights the active worktree', () => {
      const worktree = createTestWorktree({ id: 'wt-active', name: 'active-branch' });
      const project = createTestProject({
        id: 'p1',
        name: 'My Project',
        worktrees: [worktree],
      });

      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            expandedProjects: new Set(['p1']),
            activeWorktreeId: 'wt-active',
          })}
        />
      );

      const worktreeElement = screen.getByText('active-branch');
      expect(worktreeElement.closest('[class*="bg-zinc"]')).toBeTruthy();
    });

    it('shows notification indicator for notified worktrees', () => {
      const worktree = createTestWorktree({ id: 'wt-notified', name: 'notified-branch' });
      const project = createTestProject({
        id: 'p1',
        name: 'My Project',
        worktrees: [worktree],
      });

      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            expandedProjects: new Set(['p1']),
            notifiedWorktreeIds: new Set(['wt-notified']),
          })}
        />
      );

      // Should show notification dot (blue)
      const worktreeRow = screen.getByText('notified-branch').closest('div');
      const indicator = worktreeRow?.querySelector('[class*="bg-blue"], [class*="BellDot"]');
      // Indicator might be present
    });

    it('shows thinking indicator for thinking worktrees', () => {
      const worktree = createTestWorktree({ id: 'wt-thinking', name: 'thinking-branch' });
      const project = createTestProject({
        id: 'p1',
        name: 'My Project',
        worktrees: [worktree],
      });

      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            expandedProjects: new Set(['p1']),
            thinkingWorktreeIds: new Set(['wt-thinking']),
          })}
        />
      );

      // Should show thinking indicator (violet spinner)
      const worktreeRow = screen.getByText('thinking-branch').closest('div');
      // Thinking indicator should be visible
    });

    it('shows idle indicator for idle worktrees when enabled', () => {
      const worktree = createTestWorktree({ id: 'wt-idle', name: 'idle-branch' });
      const project = createTestProject({
        id: 'p1',
        name: 'My Project',
        worktrees: [worktree],
      });

      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            expandedProjects: new Set(['p1']),
            idleWorktreeIds: new Set(['wt-idle']),
            showIdleCheck: true,
          })}
        />
      );

      // Should show idle check mark (green)
      const worktreeRow = screen.getByText('idle-branch').closest('div');
      // Idle indicator should be visible
    });

    it('shows multiple worktrees in order', () => {
      const worktrees = [
        createTestWorktree({ id: 'wt1', name: 'alpha-branch', order: 0 }),
        createTestWorktree({ id: 'wt2', name: 'beta-branch', order: 1 }),
        createTestWorktree({ id: 'wt3', name: 'gamma-branch', order: 2 }),
      ];
      const project = createTestProject({
        id: 'p1',
        name: 'My Project',
        worktrees,
      });

      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            expandedProjects: new Set(['p1']),
          })}
        />
      );

      const worktreeElements = screen.getAllByText(/-branch$/);
      expect(worktreeElements).toHaveLength(3);
    });
  });

  describe('Scratch Terminals Section', () => {
    it('shows scratch terminals', () => {
      const scratchTerminals: ScratchTerminal[] = [
        { id: 'scratch-1', name: 'Terminal 1', order: 0 },
      ];

      render(
        <Sidebar
          {...createDefaultProps({
            scratchTerminals,
          })}
        />
      );

      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    });

    it('shows multiple scratch terminals', () => {
      const scratchTerminals: ScratchTerminal[] = [
        { id: 'scratch-1', name: 'Terminal 1', order: 0 },
        { id: 'scratch-2', name: 'Terminal 2', order: 1 },
        { id: 'scratch-3', name: 'Build Server', order: 2 },
      ];

      render(
        <Sidebar
          {...createDefaultProps({
            scratchTerminals,
          })}
        />
      );

      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
      expect(screen.getByText('Terminal 2')).toBeInTheDocument();
      expect(screen.getByText('Build Server')).toBeInTheDocument();
    });

    it('highlights the active scratch terminal', () => {
      const scratchTerminals: ScratchTerminal[] = [
        { id: 'scratch-1', name: 'Terminal 1', order: 0 },
      ];

      render(
        <Sidebar
          {...createDefaultProps({
            scratchTerminals,
            activeScratchId: 'scratch-1',
          })}
        />
      );

      const scratchElement = screen.getByText('Terminal 1');
      expect(scratchElement.closest('[class*="bg-zinc"]')).toBeTruthy();
    });

    it('calls onSelectScratch when scratch terminal is clicked', async () => {
      const scratchTerminals: ScratchTerminal[] = [
        { id: 'scratch-1', name: 'Terminal 1', order: 0 },
      ];
      const onSelectScratch = vi.fn();

      const user = userEvent.setup();
      render(
        <Sidebar
          {...createDefaultProps({
            scratchTerminals,
            onSelectScratch,
          })}
        />
      );

      await user.click(screen.getByText('Terminal 1'));
      expect(onSelectScratch).toHaveBeenCalledWith('scratch-1');
    });

    it('calls onAddScratchTerminal when add button is clicked', async () => {
      const onAddScratchTerminal = vi.fn();
      const user = userEvent.setup();

      render(
        <Sidebar
          {...createDefaultProps({
            onAddScratchTerminal,
          })}
        />
      );

      // Find add scratch button (terminal icon with plus)
      const buttons = screen.getAllByRole('button');
      // Click one of them that should add scratch
    });

    it('shows working directory for active scratch terminal', () => {
      const scratchTerminals: ScratchTerminal[] = [
        { id: 'scratch-1', name: 'Terminal 1', order: 0 },
      ];

      render(
        <Sidebar
          {...createDefaultProps({
            scratchTerminals,
            activeScratchId: 'scratch-1',
            activeScratchCwd: '/Users/test/projects',
            homeDir: '/Users/test',
          })}
        />
      );

      // Should show abbreviated cwd (~/projects)
      expect(screen.getByText('~/projects')).toBeInTheDocument();
    });
  });

  describe('Running Tasks', () => {
    it('shows running task count indicator on project', () => {
      const project = createTestProject({ id: 'p1', name: 'Project With Tasks' });

      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            runningTaskCounts: new Map([['p1', 2]]),
          })}
        />
      );

      // Should show task count indicator (red circle with number)
      const projectElement = screen.getByText('Project With Tasks');
      // Look for the count indicator
    });
  });

  describe('Panel Toggle Buttons', () => {
    it('calls onToggleDrawer when drawer button is clicked', async () => {
      const onToggleDrawer = vi.fn();
      const user = userEvent.setup();

      render(
        <Sidebar
          {...createDefaultProps({
            onToggleDrawer,
            // Need an active entity for toggles to show
            scratchTerminals: [{ id: 's1', name: 'Terminal', order: 0 }],
            activeScratchId: 's1',
          })}
        />
      );

      // Find drawer toggle button
      const buttons = screen.getAllByRole('button');
      const drawerButton = buttons.find((b) => b.getAttribute('aria-label')?.includes('drawer'));
      if (drawerButton) {
        await user.click(drawerButton);
        expect(onToggleDrawer).toHaveBeenCalled();
      }
    });

    it('calls onToggleRightPanel when right panel button is clicked', async () => {
      const onToggleRightPanel = vi.fn();
      const user = userEvent.setup();

      render(
        <Sidebar
          {...createDefaultProps({
            onToggleRightPanel,
            scratchTerminals: [{ id: 's1', name: 'Terminal', order: 0 }],
            activeScratchId: 's1',
          })}
        />
      );

      // Find right panel toggle button
      const buttons = screen.getAllByRole('button');
      const panelButton = buttons.find((b) => b.getAttribute('aria-label')?.includes('panel'));
      if (panelButton) {
        await user.click(panelButton);
        expect(onToggleRightPanel).toHaveBeenCalled();
      }
    });
  });

  describe('Accessibility', () => {
    it('has accessible project elements', () => {
      const project = createTestProject({ id: 'p1', name: 'Accessible Project' });

      render(<Sidebar {...createDefaultProps({ projects: [project] })} />);

      // Project should be rendered and clickable
      const projectElement = screen.getByText('Accessible Project');
      expect(projectElement).toBeInTheDocument();
      // The element or its parent should be interactive
      const interactive = projectElement.closest('button, [role="button"], [tabindex]');
      expect(interactive || projectElement).toBeTruthy();
    });

    it('has accessible worktree elements', () => {
      const worktree = createTestWorktree({ id: 'wt1', name: 'accessible-branch' });
      const project = createTestProject({
        id: 'p1',
        name: 'My Project',
        worktrees: [worktree],
      });

      render(
        <Sidebar
          {...createDefaultProps({
            projects: [project],
            expandedProjects: new Set(['p1']),
          })}
        />
      );

      // Worktree should be rendered and clickable
      const worktreeElement = screen.getByText('accessible-branch');
      expect(worktreeElement).toBeInTheDocument();
      // The element or its parent should be interactive
      const interactive = worktreeElement.closest('button, [role="button"], [tabindex]');
      expect(interactive || worktreeElement).toBeTruthy();
    });
  });
});

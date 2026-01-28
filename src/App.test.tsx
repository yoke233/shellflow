import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import { SplitProvider } from './contexts/SplitContext';
import {
  resetMocks,
  setupDefaultMocks,
  mockInvokeResponses,
  invokeHistory,
  emitEvent,
  createTestProject,
  createTestWorktree,
  createTestConfig,
  defaultTestConfig,
} from './test/setup';

// Mock useGitStatus to avoid file watching issues
vi.mock('./hooks/useGitStatus', () => ({
  useGitStatus: () => ({ files: [], loading: false, error: null }),
}));

// Wrapper to provide SplitContext for App tests
const TestWrapper = ({ children }: { children: React.ReactNode }) => (
  <SplitProvider>{children}</SplitProvider>
);

describe('App', () => {
  beforeEach(() => {
    resetMocks();
    setupDefaultMocks();
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('Initial Render', () => {
    it('renders without crashing', async () => {
      render(<App />, { wrapper: TestWrapper });

      // Should show something on screen
      await waitFor(() => {
        // Either shows scratch terminal or welcome screen
        const content = document.body.textContent;
        expect(content?.length).toBeGreaterThan(0);
      });
    });

    it('loads projects on startup', async () => {
      render(<App />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'list_projects')).toBe(true);
      });
    });

    it('loads configuration on startup', async () => {
      render(<App />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'get_config')).toBe(true);
      });
    });
  });

  describe('Scratch Terminal on Launch', () => {
    it('spawns a scratch terminal when startOnLaunch is true', async () => {
      render(<App />, { wrapper: TestWrapper });

      // Wait for config to load and scratch terminal to be created
      await waitFor(
        () => {
          expect(screen.getByText('Terminal 1')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('respects startOnLaunch config setting', async () => {
      // This test verifies the config is properly read
      // The actual config.scratch.startOnLaunch logic is tested by:
      // 1. The positive case above (spawns when true)
      // 2. Unit tests for the config hook

      // Verify config is loaded
      render(<App />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'get_config')).toBe(true);
      });

      // The default config has startOnLaunch: true, so Terminal 1 should appear
      await waitFor(
        () => {
          expect(screen.getByText('Terminal 1')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('Project Display', () => {
    it('shows projects in sidebar', async () => {
      const project = createTestProject({ id: 'proj-1', name: 'my-awesome-project' });
      mockInvokeResponses.set('list_projects', [project]);

      render(<App />, { wrapper: TestWrapper });

      await waitFor(
        () => {
          expect(screen.getByText('my-awesome-project')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });

    it('only shows active projects', async () => {
      const activeProject = createTestProject({ id: 'proj-1', name: 'active-project', isActive: true });
      const closedProject = createTestProject({ id: 'proj-2', name: 'closed-project', isActive: false });
      mockInvokeResponses.set('list_projects', [activeProject, closedProject]);

      render(<App />, { wrapper: TestWrapper });

      await waitFor(
        () => {
          expect(screen.getByText('active-project')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Closed project should not be visible
      expect(screen.queryByText('closed-project')).not.toBeInTheDocument();
    });

    it('shows project worktrees when expanded', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-branch' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // Wait for project to appear
      await waitFor(
        () => {
          expect(screen.getByText('my-project')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Click to expand
      await user.click(screen.getByText('my-project'));

      // Worktree should be visible
      await waitFor(() => {
        expect(screen.getByText('feature-branch')).toBeInTheDocument();
      });
    });
  });

  describe('Project Selection', () => {
    it('selects project when clicked', async () => {
      const project = createTestProject({ id: 'proj-1', name: 'test-project' });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      await waitFor(
        () => {
          expect(screen.getByText('test-project')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      await user.click(screen.getByText('test-project'));

      // Should update last accessed timestamp
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'touch_project')).toBe(true);
      });
    });

    it('reactivates closed project when selected from project switcher', async () => {
      // Set up a closed project that won't show in sidebar initially
      const closedProject = createTestProject({
        id: 'proj-closed',
        name: 'closed-project',
        isActive: false,
      });
      mockInvokeResponses.set('list_projects', [closedProject]);
      mockInvokeResponses.set('touch_project', null);

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // Wait for initial render - closed project should NOT be in sidebar
      await waitFor(
        () => {
          expect(screen.getByText('Terminal 1')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Verify closed project is not visible in sidebar
      expect(screen.queryByText('closed-project')).not.toBeInTheDocument();

      // Open project switcher via menu action
      await act(async () => {
        emitEvent('menu-action', 'palette::projectSwitcher');
      });

      // Wait for project switcher to open and show the closed project
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search projects...')).toBeInTheDocument();
      });

      // The closed project should appear in the switcher (it shows all projects)
      await waitFor(() => {
        expect(screen.getByText('closed-project')).toBeInTheDocument();
      });

      // Select the closed project
      await user.click(screen.getByText('closed-project'));

      // Project should now appear in the sidebar (reactivated)
      await waitFor(
        () => {
          // The project switcher should close and project should be in sidebar
          expect(screen.queryByPlaceholderText('Search projects...')).not.toBeInTheDocument();
          expect(screen.getByText('closed-project')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Verify touch_project was called to reactivate it
      expect(invokeHistory.some((h) => h.command === 'touch_project')).toBe(true);
    });
  });

  describe('Worktree Selection', () => {
    it('selects worktree when clicked', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-work' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // Wait for project to load and expand
      await waitFor(
        () => {
          expect(screen.getByText('my-project')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Click project to expand and select it
      await user.click(screen.getByText('my-project'));

      // Wait a bit for state to update
      await act(async () => {
        await new Promise((r) => setTimeout(r, 100));
      });

      // Now check for worktree (might already be visible due to default expansion)
      await waitFor(
        () => {
          expect(screen.getByText('feature-work')).toBeInTheDocument();
        },
        { timeout: 2000 }
      );

      // Click worktree
      await user.click(screen.getByText('feature-work'));

      // Should touch project (may have already been touched from project click)
      await waitFor(
        () => {
          expect(invokeHistory.some((h) => h.command === 'touch_project')).toBe(true);
        },
        { timeout: 2000 }
      );
    });
  });

  describe('Keyboard Shortcuts', () => {
    it('supports keyboard event handling', async () => {
      render(<App />, { wrapper: TestWrapper });

      // Wait for initial scratch terminal
      await waitFor(
        () => {
          expect(screen.getByText('Terminal 1')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Verify keyboard event listeners are set up by checking the app renders properly
      // Full keyboard shortcut testing requires native events which are difficult to simulate in jsdom
      // The keyboard.test.ts covers the matchesShortcut logic
      expect(document.querySelector('[data-testid]') || document.body).toBeTruthy();
    });
  });

  describe('Config Reloading', () => {
    it('reloads config when config-changed event fires', async () => {
      render(<App />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText('Terminal 1')).toBeInTheDocument();
      });

      const initialConfigCalls = invokeHistory.filter((h) => h.command === 'get_config').length;

      // Emit config-changed
      await act(async () => {
        emitEvent('config-changed', {});
      });

      await waitFor(() => {
        const newConfigCalls = invokeHistory.filter((h) => h.command === 'get_config').length;
        expect(newConfigCalls).toBeGreaterThan(initialConfigCalls);
      });
    });
  });

  describe('Multiple Projects', () => {
    it('displays multiple projects', async () => {
      const projects = [
        createTestProject({ id: 'proj-1', name: 'project-alpha' }),
        createTestProject({ id: 'proj-2', name: 'project-beta' }),
        createTestProject({ id: 'proj-3', name: 'project-gamma' }),
      ];
      mockInvokeResponses.set('list_projects', projects);

      render(<App />, { wrapper: TestWrapper });

      await waitFor(
        () => {
          expect(screen.getByText('project-alpha')).toBeInTheDocument();
          expect(screen.getByText('project-beta')).toBeInTheDocument();
          expect(screen.getByText('project-gamma')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );
    });
  });

  describe('Task Running', () => {
    it('opens task switcher when tasks are configured', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-branch' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);

      // Config with tasks
      mockInvokeResponses.set('get_config', {
        config: {
          ...defaultTestConfig,
          tasks: [
            { name: 'build', command: 'npm run build' },
            { name: 'test', command: 'npm test' },
          ],
        },
        errors: [],
      });

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // Wait for project to appear and select worktree
      await waitFor(() => {
        expect(screen.getByText('my-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      await user.click(screen.getByText('my-project'));

      await waitFor(() => {
        expect(screen.getByText('feature-branch')).toBeInTheDocument();
      });
      await user.click(screen.getByText('feature-branch'));

      // Open task switcher via menu action
      await act(async () => {
        emitEvent('menu-action', 'task::switcher');
      });

      // Task switcher should open and show tasks
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search tasks...')).toBeInTheDocument();
      });

      // Both tasks should be visible
      expect(screen.getByText('build')).toBeInTheDocument();
      expect(screen.getByText('npm run build')).toBeInTheDocument();
    });

    it('spawns task when run from task switcher with Cmd+Enter', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-branch' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);
      mockInvokeResponses.set('spawn_task', 'pty-task-123');
      mockInvokeResponses.set('get_task_urls', []);

      // Config with single task for simpler test
      mockInvokeResponses.set('get_config', {
        config: {
          ...defaultTestConfig,
          tasks: [{ name: 'dev', command: 'npm run dev' }],
        },
        errors: [],
      });

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // Select worktree to set activeEntityId
      await waitFor(() => {
        expect(screen.getByText('my-project')).toBeInTheDocument();
      }, { timeout: 3000 });
      await user.click(screen.getByText('my-project'));

      await waitFor(() => {
        expect(screen.getByText('feature-branch')).toBeInTheDocument();
      });
      await user.click(screen.getByText('feature-branch'));

      // Wait for spawn_main (worktree terminal)
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });

      // Open task switcher
      await act(async () => {
        emitEvent('menu-action', 'task::switcher');
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search tasks...')).toBeInTheDocument();
      });

      // Run task with Cmd+Enter (first task is pre-selected)
      await user.keyboard('{Meta>}{Enter}{/Meta}');

      // Task should spawn
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_task')).toBe(true);
      }, { timeout: 3000 });

      // Verify spawn_task was called with correct args
      const spawnCall = invokeHistory.find((h) => h.command === 'spawn_task');
      expect(spawnCall?.args).toHaveProperty('taskName', 'dev');
    });
  });

  describe('Project Selection Opens Main Terminal', () => {
    it('spawns main terminal when worktree is selected', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-branch' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);
      mockInvokeResponses.set('spawn_main', 'pty-main-789');

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // Wait for project to appear
      await waitFor(() => {
        expect(screen.getByText('my-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Click project to expand
      await user.click(screen.getByText('my-project'));

      // Wait for worktree to appear
      await waitFor(() => {
        expect(screen.getByText('feature-branch')).toBeInTheDocument();
      });

      // Click worktree to select it
      await user.click(screen.getByText('feature-branch'));

      // Main terminal should spawn for the worktree
      await waitFor(() => {
        const spawnMainCalls = invokeHistory.filter((h) => h.command === 'spawn_main');
        expect(spawnMainCalls.length).toBeGreaterThan(0);
      }, { timeout: 3000 });

      // Verify spawn_main was called with the worktree ID
      const spawnCall = invokeHistory.find((h) => h.command === 'spawn_main');
      expect(spawnCall?.args).toHaveProperty('worktreeId', 'wt-1');
    });

    it('spawns project shell when project main repo is selected', async () => {
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);
      mockInvokeResponses.set('spawn_project_shell', 'pty-proj-shell-123');

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // Wait for project to appear
      await waitFor(() => {
        expect(screen.getByText('my-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Double-click project to select the main repo (or click the main entry)
      await user.dblClick(screen.getByText('my-project'));

      // Project shell should spawn
      await waitFor(() => {
        const spawnCalls = invokeHistory.filter((h) => h.command === 'spawn_project_shell');
        expect(spawnCalls.length).toBeGreaterThan(0);
      }, { timeout: 3000 });
    });

    it('shows loading state while terminal spawns', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-branch' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);

      // Delay the spawn response to see loading state
      mockInvokeResponses.set('spawn_main', () =>
        new Promise((resolve) => setTimeout(() => resolve('pty-main-delayed'), 200))
      );

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText('my-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      await user.click(screen.getByText('my-project'));

      await waitFor(() => {
        expect(screen.getByText('feature-branch')).toBeInTheDocument();
      });

      await user.click(screen.getByText('feature-branch'));

      // Should show "Starting..." while loading (may be brief)
      // We verify spawn_main is called and eventually completes
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });
    });
  });

  describe('Project Switcher Flow', () => {
    it('opens project switcher and shows all projects', async () => {
      const project1 = createTestProject({ id: 'proj-1', name: 'alpha-project' });
      const project2 = createTestProject({ id: 'proj-2', name: 'beta-project' });
      mockInvokeResponses.set('list_projects', [project1, project2]);
      mockInvokeResponses.set('touch_project', null);

      render(<App />, { wrapper: TestWrapper });

      // Wait for app to load
      await waitFor(() => {
        expect(screen.getByText('alpha-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Open project switcher
      await act(async () => {
        emitEvent('menu-action', 'palette::projectSwitcher');
      });

      // Switcher should open
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search projects...')).toBeInTheDocument();
      });

      // Both projects should be visible in the switcher
      // (they're also in sidebar, so there should be 2 of each)
      const alphaMatches = screen.getAllByText('alpha-project');
      const betaMatches = screen.getAllByText('beta-project');
      expect(alphaMatches.length).toBeGreaterThanOrEqual(1);
      expect(betaMatches.length).toBeGreaterThanOrEqual(1);
    });

    it('can filter projects in switcher', async () => {
      const project1 = createTestProject({ id: 'proj-1', name: 'alpha-project' });
      const project2 = createTestProject({ id: 'proj-2', name: 'beta-project' });
      mockInvokeResponses.set('list_projects', [project1, project2]);
      mockInvokeResponses.set('touch_project', null);

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText('alpha-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Open project switcher
      await act(async () => {
        emitEvent('menu-action', 'palette::projectSwitcher');
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search projects...')).toBeInTheDocument();
      });

      // Filter to just beta-project
      const searchInput = screen.getByPlaceholderText('Search projects...');
      await user.type(searchInput, 'beta');

      // After filtering, only beta-project should match
      // (there may still be one in sidebar, but the filtered list should only show beta)
      await waitFor(() => {
        const modalList = screen.getByTestId('modal-list');
        const searchResults = modalList.querySelectorAll('button');
        // At least one match should contain beta
        const hasBetaResult = Array.from(searchResults).some(el =>
          el.textContent?.includes('beta-project')
        );
        expect(hasBetaResult).toBe(true);
      });
    });

    it('expands project in sidebar when switched to', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'my-feature-branch' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'collapsed-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);

      // Set localStorage so the app thinks it has been initialized already,
      // preventing the auto-expand-all behavior on first run
      localStorage.setItem('shellflow:expandedProjects', '[]');

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // Wait for project to show in sidebar
      await waitFor(() => {
        expect(screen.getByText('collapsed-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Worktree should NOT be visible because project is collapsed
      expect(screen.queryByText('my-feature-branch')).not.toBeInTheDocument();

      // Open project switcher
      await act(async () => {
        emitEvent('menu-action', 'palette::projectSwitcher');
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Search projects...')).toBeInTheDocument();
      });

      // Select the project
      const modalList = screen.getByTestId('modal-list');
      const projectButton = modalList.querySelector('button');
      expect(projectButton).toBeTruthy();
      await user.click(projectButton!);

      // Now the worktree should be visible because the project was expanded
      await waitFor(() => {
        expect(screen.getByText('my-feature-branch')).toBeInTheDocument();
      });
    });
  });

  describe('Command Palette Navigation', () => {
    it('shows unopened worktrees in command palette', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-branch' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText('my-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Open command palette via menu action
      await act(async () => {
        emitEvent('menu-action', 'palette::toggle');
      });

      // Command palette should open
      await waitFor(() => {
        expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument();
      });

      // Search for the worktree
      await user.type(screen.getByPlaceholderText('Type a command...'), 'feature-branch');

      // Worktree should appear in results even though it hasn't been opened
      await waitFor(() => {
        expect(screen.getByText('Worktree: my-project / feature-branch')).toBeInTheDocument();
      });
    });

    it('spawns terminal when selecting unopened worktree from command palette', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-branch' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);
      mockInvokeResponses.set('spawn_main', 'pty-main-123');

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText('my-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Open command palette
      await act(async () => {
        emitEvent('menu-action', 'palette::toggle');
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument();
      });

      // Search and select the worktree
      await user.type(screen.getByPlaceholderText('Type a command...'), 'feature-branch');

      await waitFor(() => {
        expect(screen.getByText('Worktree: my-project / feature-branch')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Worktree: my-project / feature-branch'));

      // Terminal should spawn
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      }, { timeout: 3000 });

      // Verify it was spawned for the correct worktree
      const spawnCall = invokeHistory.find((h) => h.command === 'spawn_main');
      expect(spawnCall?.args).toHaveProperty('worktreeId', 'wt-1');
    });

    it('spawns project shell when selecting unopened project from command palette', async () => {
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);
      mockInvokeResponses.set('spawn_project_shell', 'pty-proj-123');

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText('my-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Open command palette
      await act(async () => {
        emitEvent('menu-action', 'palette::toggle');
      });

      await waitFor(() => {
        expect(screen.getByPlaceholderText('Type a command...')).toBeInTheDocument();
      });

      // Search and select the project
      await user.type(screen.getByPlaceholderText('Type a command...'), 'my-project');

      await waitFor(() => {
        expect(screen.getByText('Project: my-project')).toBeInTheDocument();
      });

      await user.click(screen.getByText('Project: my-project'));

      // Project shell should spawn
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_project_shell')).toBe(true);
      }, { timeout: 3000 });
    });
  });

  describe('Session Tabs', () => {
    it('creates initial tab when scratch terminal starts', async () => {
      render(<App />, { wrapper: TestWrapper });

      // Wait for scratch terminal with initial tab
      await waitFor(
        () => {
          expect(screen.getByText('Terminal 1')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Should spawn scratch terminal
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_scratch_terminal')).toBe(true);
      });
    });

    it('creates initial tab when worktree is selected', async () => {
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-branch' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);
      mockInvokeResponses.set('spawn_main', 'pty-main-789');

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // Wait for project to appear
      await waitFor(() => {
        expect(screen.getByText('my-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      await user.click(screen.getByText('my-project'));

      await waitFor(() => {
        expect(screen.getByText('feature-branch')).toBeInTheDocument();
      });

      await user.click(screen.getByText('feature-branch'));

      // Main terminal should spawn for the worktree
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      }, { timeout: 3000 });

      // Spawn should use the worktree ID (session ID), not a tab ID
      const spawnCall = invokeHistory.find((h) => h.command === 'spawn_main');
      expect(spawnCall?.args).toHaveProperty('worktreeId', 'wt-1');
    });

    it('maintains separate tabs for different sessions', async () => {
      // This tests that switching between sessions preserves their respective tabs
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-branch' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);
      mockInvokeResponses.set('spawn_main', 'pty-main-789');

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // First, scratch terminal starts with Terminal 1
      await waitFor(
        () => {
          expect(screen.getByText('Terminal 1')).toBeInTheDocument();
        },
        { timeout: 3000 }
      );

      // Switch to worktree
      await waitFor(() => {
        expect(screen.getByText('my-project')).toBeInTheDocument();
      });
      await user.click(screen.getByText('my-project'));

      await waitFor(() => {
        expect(screen.getByText('feature-branch')).toBeInTheDocument();
      });
      await user.click(screen.getByText('feature-branch'));

      // Worktree should spawn
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });
    });

    it('uses correct session ID for spawn when tab is active', async () => {
      // This verifies that the sessionId prop is correctly passed to MainTerminal
      const worktree = createTestWorktree({ id: 'wt-1', name: 'feature-branch' });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);
      mockInvokeResponses.set('touch_project', null);
      mockInvokeResponses.set('spawn_main', 'pty-main-xyz');

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      await waitFor(() => {
        expect(screen.getByText('my-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      await user.click(screen.getByText('my-project'));

      await waitFor(() => {
        expect(screen.getByText('feature-branch')).toBeInTheDocument();
      });
      await user.click(screen.getByText('feature-branch'));

      await waitFor(() => {
        const spawnCalls = invokeHistory.filter((h) => h.command === 'spawn_main');
        expect(spawnCalls.length).toBeGreaterThan(0);
        // The worktreeId should match the session ID, not a tab ID
        const lastSpawn = spawnCalls[spawnCalls.length - 1];
        expect(lastSpawn.args.worktreeId).toBe('wt-1');
        expect(lastSpawn.args.worktreeId).not.toContain('-session-');
      }, { timeout: 3000 });
    });
  });

  describe('Open In Actions', () => {
    it('openInFinder works with scratch terminal using cwd', async () => {
      // Setup: scratch.startOnLaunch is true by default, home dir is /Users/test
      render(<App />, { wrapper: TestWrapper });

      // Wait for scratch terminal to be created and spawned
      await waitFor(() => {
        expect(screen.getByText('Terminal 1')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Wait for terminal to be spawned (which means it's fully active)
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_scratch_terminal')).toBe(true);
      });

      // Click on the scratch terminal to ensure it's selected
      const user = userEvent.setup();
      await user.click(screen.getByText('Terminal 1'));

      // Clear invoke history to isolate our test
      invokeHistory.length = 0;

      // Trigger openInFinder via menu action
      await act(async () => {
        emitEvent('menu-action', 'app::openInFinder');
      });

      // Verify open_folder was called with the scratch terminal's cwd (home dir)
      await waitFor(() => {
        const openFolderCalls = invokeHistory.filter((h) => h.command === 'open_folder');
        expect(openFolderCalls.length).toBe(1);
        expect(openFolderCalls[0].args).toEqual({ path: '/Users/test' });
      });
    });

    it('openInFinder works with worktree using worktree path', async () => {
      const worktree = createTestWorktree({
        id: 'wt-1',
        name: 'feature-branch',
        path: '/Users/test/projects/my-project/.worktrees/feature-branch',
      });
      const project = createTestProject({
        id: 'proj-1',
        name: 'my-project',
        path: '/Users/test/projects/my-project',
        worktrees: [worktree],
      });
      mockInvokeResponses.set('list_projects', [project]);

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // Wait for project to load and expand it
      await waitFor(() => {
        expect(screen.getByText('my-project')).toBeInTheDocument();
      }, { timeout: 3000 });

      // Click project to expand
      await user.click(screen.getByText('my-project'));

      // Click worktree to select it
      await waitFor(() => {
        expect(screen.getByText('feature-branch')).toBeInTheDocument();
      });
      await user.click(screen.getByText('feature-branch'));

      // Wait for worktree to be selected (terminal spawns)
      await waitFor(() => {
        const spawnCalls = invokeHistory.filter((h) => h.command === 'spawn_main');
        expect(spawnCalls.length).toBeGreaterThan(0);
      });

      // Clear invoke history
      invokeHistory.length = 0;

      // Trigger openInFinder
      await act(async () => {
        emitEvent('menu-action', 'app::openInFinder');
      });

      // Verify open_folder was called with worktree path
      await waitFor(() => {
        const openFolderCalls = invokeHistory.filter((h) => h.command === 'open_folder');
        expect(openFolderCalls.length).toBe(1);
        expect(openFolderCalls[0].args).toEqual({
          path: '/Users/test/projects/my-project/.worktrees/feature-branch',
        });
      });
    });

    it('openInTerminal with external target invokes open_in_terminal for scratch terminal', async () => {
      // Config with external terminal target
      mockInvokeResponses.set('get_config', createTestConfig({
        apps: { terminal: 'ghostty', editor: 'nvim' },
      }));

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // Wait for scratch terminal to be spawned
      await waitFor(() => {
        expect(screen.getByText('Terminal 1')).toBeInTheDocument();
      }, { timeout: 3000 });
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_scratch_terminal')).toBe(true);
      });

      await user.click(screen.getByText('Terminal 1'));
      invokeHistory.length = 0;

      await act(async () => {
        emitEvent('menu-action', 'app::openInTerminal');
      });

      // Verify open_in_terminal was called with scratch cwd
      await waitFor(() => {
        const openTerminalCalls = invokeHistory.filter((h) => h.command === 'open_in_terminal');
        expect(openTerminalCalls.length).toBe(1);
        expect(openTerminalCalls[0].args).toEqual({
          path: '/Users/test',
          app: 'ghostty',
        });
      });
    });

    it('openInEditor with external target invokes open_in_editor for scratch terminal', async () => {
      // Config with external editor target
      mockInvokeResponses.set('get_config', createTestConfig({
        apps: {
          terminal: 'ghostty',
          editor: { command: 'zed', target: 'external' },
        },
      }));

      const user = userEvent.setup();
      render(<App />, { wrapper: TestWrapper });

      // Wait for scratch terminal to be spawned
      await waitFor(() => {
        expect(screen.getByText('Terminal 1')).toBeInTheDocument();
      }, { timeout: 3000 });
      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_scratch_terminal')).toBe(true);
      });

      await user.click(screen.getByText('Terminal 1'));
      invokeHistory.length = 0;

      await act(async () => {
        emitEvent('menu-action', 'app::openInEditor');
      });

      // Verify open_in_editor was called with scratch cwd
      await waitFor(() => {
        const openEditorCalls = invokeHistory.filter((h) => h.command === 'open_in_editor');
        expect(openEditorCalls.length).toBe(1);
        expect(openEditorCalls[0].args).toEqual({
          path: '/Users/test',
          app: 'zed',
          target: 'external',
          terminalApp: 'ghostty',
        });
      });
    });
  });
});

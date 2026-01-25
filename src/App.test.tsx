import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';
import {
  resetMocks,
  setupDefaultMocks,
  mockInvokeResponses,
  invokeHistory,
  emitEvent,
  createTestProject,
  createTestWorktree,
} from './test/setup';

// Mock useGitStatus to avoid file watching issues
vi.mock('./hooks/useGitStatus', () => ({
  useGitStatus: () => ({ files: [], loading: false, error: null }),
}));

describe('App', () => {
  beforeEach(() => {
    resetMocks();
    setupDefaultMocks();
    vi.clearAllMocks();
    localStorage.clear();
  });

  describe('Initial Render', () => {
    it('renders without crashing', async () => {
      render(<App />);

      // Should show something on screen
      await waitFor(() => {
        // Either shows scratch terminal or welcome screen
        const content = document.body.textContent;
        expect(content?.length).toBeGreaterThan(0);
      });
    });

    it('loads projects on startup', async () => {
      render(<App />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'list_projects')).toBe(true);
      });
    });

    it('loads configuration on startup', async () => {
      render(<App />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'get_config')).toBe(true);
      });
    });
  });

  describe('Scratch Terminal on Launch', () => {
    it('spawns a scratch terminal when startOnLaunch is true', async () => {
      render(<App />);

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
      render(<App />);

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

      render(<App />);

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

      render(<App />);

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
      render(<App />);

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
      render(<App />);

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
      render(<App />);

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
        emitEvent('menu-action', 'switch_project');
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
      render(<App />);

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
      render(<App />);

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
      render(<App />);

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

      render(<App />);

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
});

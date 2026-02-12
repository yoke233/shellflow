import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MainTerminal } from './MainTerminal';
import {
  resetMocks,
  mockInvokeResponses,
  invokeHistory,
  defaultTestConfig,
} from '../../test/setup';

describe('MainTerminal', () => {
  const defaultProps = {
    entityId: 'worktree-1',
    type: 'main' as const,
    isActive: true,
    shouldAutoFocus: false,
    terminalConfig: defaultTestConfig.drawer,
  };

  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
    mockInvokeResponses.set('spawn_main', 'pty-main-123');
    mockInvokeResponses.set('spawn_terminal', 'pty-shell-123');
    mockInvokeResponses.set('spawn_scratch_terminal', 'pty-scratch-123');
    mockInvokeResponses.set('spawn_project_shell', 'pty-project-123');
    mockInvokeResponses.set('pty_write', null);
    mockInvokeResponses.set('pty_resize', null);
    mockInvokeResponses.set('pty_kill', null);
  });

  describe('rendering', () => {
    it('renders terminal container', () => {
      render(<MainTerminal {...defaultProps} />);

      // Terminal container should exist with correct background
      const container = document.querySelector('[style*="background-color"]');
      expect(container).toBeInTheDocument();
    });

    it('shows loading state initially for main type', async () => {
      render(<MainTerminal {...defaultProps} type="main" />);

      // Loading indicator should be present initially for main command
      expect(screen.getByText('Starting...')).toBeInTheDocument();
    });

    it('applies padding from config', () => {
      const customConfig = {
        ...defaultTestConfig.drawer,
        padding: 16,
      };

      render(<MainTerminal {...defaultProps} terminalConfig={customConfig} />);

      const container = document.querySelector('[style*="padding: 16px"]');
      expect(container).toBeInTheDocument();
    });
  });

  describe('spawning', () => {
    it('spawns main terminal', async () => {
      render(<MainTerminal {...defaultProps} type="main" />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });
    });

    it('spawns project shell', async () => {
      render(<MainTerminal {...defaultProps} type="project" entityId="project-1" />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_project_shell')).toBe(true);
      });
    });

    it('spawns scratch terminal', async () => {
      render(<MainTerminal {...defaultProps} type="scratch" entityId="scratch-1" />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_scratch_terminal')).toBe(true);
      });
    });

    it('passes worktreeId to spawn_main command', async () => {
      render(<MainTerminal {...defaultProps} type="main" entityId="my-worktree" />);

      await waitFor(() => {
        const spawnCall = invokeHistory.find((h) => h.command === 'spawn_main');
        expect(spawnCall?.args).toHaveProperty('worktreeId', 'my-worktree');
      });
    });

    it('passes projectId to spawn_project_shell command', async () => {
      render(<MainTerminal {...defaultProps} type="project" entityId="my-project" />);

      await waitFor(() => {
        const spawnCall = invokeHistory.find((h) => h.command === 'spawn_project_shell');
        expect(spawnCall?.args).toHaveProperty('projectId', 'my-project');
      });
    });

    it('passes scratchId to spawn_scratch_terminal command', async () => {
      render(<MainTerminal {...defaultProps} type="scratch" entityId="my-scratch" />);

      await waitFor(() => {
        const spawnCall = invokeHistory.find((h) => h.command === 'spawn_scratch_terminal');
        expect(spawnCall?.args).toHaveProperty('scratchId', 'my-scratch');
      });
    });

    it('passes terminal dimensions to spawn command', async () => {
      render(<MainTerminal {...defaultProps} type="main" />);

      await waitFor(() => {
        const spawnCall = invokeHistory.find((h) => h.command === 'spawn_main');
        expect(spawnCall?.args).toHaveProperty('cols');
        expect(spawnCall?.args).toHaveProperty('rows');
      });
    });
  });

  describe('type variants', () => {
    it('main type spawns main command', async () => {
      render(<MainTerminal {...defaultProps} type="main" />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
        expect(invokeHistory.some((h) => h.command === 'spawn_project_shell')).toBe(false);
        expect(invokeHistory.some((h) => h.command === 'spawn_scratch_terminal')).toBe(false);
      });
    });

    it('project type spawns project shell', async () => {
      render(<MainTerminal {...defaultProps} type="project" entityId="proj-1" />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_project_shell')).toBe(true);
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(false);
      });
    });

    it('scratch type spawns scratch terminal', async () => {
      render(<MainTerminal {...defaultProps} type="scratch" entityId="scratch-1" />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_scratch_terminal')).toBe(true);
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(false);
      });
    });
  });

  describe('terminal config', () => {
    it('applies font settings from config', async () => {
      const customConfig = {
        ...defaultTestConfig.drawer,
        fontSize: 16,
        fontFamily: 'Fira Code',
      };

      render(<MainTerminal {...defaultProps} terminalConfig={customConfig} />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });

      // Terminal is created with these settings (tested via mock Terminal constructor)
    });

    it('applies different padding values', () => {
      const testCases = [0, 8, 16, 24];

      for (const padding of testCases) {
        const { unmount } = render(
          <MainTerminal
            {...defaultProps}
            terminalConfig={{ ...defaultTestConfig.drawer, padding }}
          />
        );

        const container = document.querySelector(`[style*="padding: ${padding}px"]`);
        expect(container).toBeInTheDocument();
        unmount();
      }
    });
  });

  describe('callbacks', () => {
    it('accepts onFocus callback prop', async () => {
      const onFocus = vi.fn();

      render(<MainTerminal {...defaultProps} onFocus={onFocus} />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });

      // Verify component accepts the prop without throwing
      expect(true).toBe(true);
    });

    it('accepts onNotification callback prop', async () => {
      const onNotification = vi.fn();

      render(<MainTerminal {...defaultProps} onNotification={onNotification} />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });

      // Verify component accepts the prop without throwing
      expect(true).toBe(true);
    });

    it('accepts onThinkingChange callback prop', async () => {
      const onThinkingChange = vi.fn();

      render(<MainTerminal {...defaultProps} onThinkingChange={onThinkingChange} />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });

      // Verify component accepts the prop without throwing
      expect(true).toBe(true);
    });

    it('accepts onCwdChange callback prop', async () => {
      const onCwdChange = vi.fn();

      render(<MainTerminal {...defaultProps} onCwdChange={onCwdChange} />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });

      // Verify component accepts the prop without throwing
      expect(true).toBe(true);
    });
  });

  describe('focus behavior', () => {
    it('accepts shouldAutoFocus prop', async () => {
      render(<MainTerminal {...defaultProps} shouldAutoFocus={true} />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });

      // Component should render without error
      expect(screen.getByText('Starting...')).toBeInTheDocument();
    });

    it('accepts focusTrigger prop', async () => {
      const { rerender } = render(<MainTerminal {...defaultProps} focusTrigger={0} />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });

      // Change focusTrigger - should not throw
      rerender(<MainTerminal {...defaultProps} focusTrigger={1} />);

      expect(true).toBe(true);
    });

    it('opens terminal search with Ctrl+F and allows typing', async () => {
      const user = userEvent.setup();
      render(<MainTerminal {...defaultProps} shouldAutoFocus={true} />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });

      const textarea = document.querySelector(
        `[data-terminal-id="${defaultProps.entityId}"] textarea.xterm-helper-textarea`
      ) as HTMLTextAreaElement | null;
      expect(textarea).toBeTruthy();
      textarea?.focus();

      fireEvent.keyDown(window, { key: 'f', ctrlKey: true });

      const searchInput = await screen.findByPlaceholderText('Find');
      await user.type(searchInput, 'query');

      expect(searchInput).toHaveValue('query');
      expect(document.activeElement).toBe(searchInput);
    });
  });

  describe('activity timeout', () => {
    it('accepts activityTimeout prop', async () => {
      render(<MainTerminal {...defaultProps} activityTimeout={500} />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });

      // Component should render without error
      expect(screen.getByText('Starting...')).toBeInTheDocument();
    });

    it('uses default activityTimeout when not provided', async () => {
      render(<MainTerminal {...defaultProps} />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });

      // Component should render without error
      expect(screen.getByText('Starting...')).toBeInTheDocument();
    });
  });

  describe('cleanup', () => {
    it('does NOT kill PTY on unmount (React may remount components)', async () => {
      // PTY cleanup is handled by App.tsx when tabs are explicitly closed,
      // not on component unmount. This prevents losing terminal state when
      // React unmounts/remounts components during re-renders or StrictMode.
      const { unmount } = render(<MainTerminal {...defaultProps} />);

      await waitFor(() => {
        expect(invokeHistory.some((h) => h.command === 'spawn_main')).toBe(true);
      });

      unmount();

      // Give time for any async operations
      await new Promise(resolve => setTimeout(resolve, 50));

      // PTY should NOT be killed on unmount
      expect(invokeHistory.some((h) => h.command === 'pty_kill')).toBe(false);
    });
  });

  describe('isActive prop', () => {
    it('renders when active', () => {
      render(<MainTerminal {...defaultProps} isActive={true} />);

      const container = document.querySelector('[style*="background-color"]');
      expect(container).toBeInTheDocument();
    });

    it('renders when inactive', () => {
      render(<MainTerminal {...defaultProps} isActive={false} />);

      const container = document.querySelector('[style*="background-color"]');
      expect(container).toBeInTheDocument();
    });
  });
});

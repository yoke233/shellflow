import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MainPane } from './MainPane';
import { Session } from '../../types';
import { resetMocks, mockInvokeResponses, defaultTestConfig } from '../../test/setup';

// Mock the MainTerminal component to avoid xterm complexity
vi.mock('./MainTerminal', () => ({
  MainTerminal: vi.fn(({ entityId, type, isActive }) => (
    <div data-testid={`terminal-${entityId}`} data-type={type} data-active={isActive}>
      Terminal: {entityId}
    </div>
  )),
}));

describe('MainPane', () => {
  const defaultProps = {
    sessions: [] as Session[],
    openSessionIds: new Set<string>(),
    activeSessionId: null as string | null,
    terminalConfig: defaultTestConfig.main,
    activityTimeout: 250,
    shouldAutoFocus: false,
    configErrors: [],
    onFocus: vi.fn(),
  };

  const createSession = (
    id: string,
    kind: 'scratch' | 'project' | 'worktree',
    name: string,
    path: string
  ): Session => ({
    id,
    kind,
    name,
    path,
    order: 0,
  });

  beforeEach(() => {
    resetMocks();
    vi.clearAllMocks();
    mockInvokeResponses.set('spawn_main', 'pty-main-123');
    mockInvokeResponses.set('spawn_project_shell', 'pty-project-123');
    mockInvokeResponses.set('spawn_scratch_terminal', 'pty-scratch-123');
  });

  describe('empty state', () => {
    it('shows welcome screen when no sessions are open', () => {
      render(<MainPane {...defaultProps} />);

      expect(screen.getByText('Shellflow')).toBeInTheDocument();
      expect(screen.getByText(/terminal wrapper with worktree/i)).toBeInTheDocument();
    });

    it('shows welcome screen when sessions exist but none are open', () => {
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set()}
          activeSessionId={null}
        />
      );

      expect(screen.getByText('Shellflow')).toBeInTheDocument();
    });

    it('shows welcome screen when sessions are open but no active session', () => {
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId={null}
        />
      );

      expect(screen.getByText('Shellflow')).toBeInTheDocument();
    });
  });

  describe('session rendering', () => {
    it('renders terminal for open scratch session', () => {
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
        />
      );

      const terminal = screen.getByTestId('terminal-scratch-1');
      expect(terminal).toBeInTheDocument();
      expect(terminal).toHaveAttribute('data-type', 'scratch');
      expect(terminal).toHaveAttribute('data-active', 'true');
    });

    it('renders terminal for open project session', () => {
      const sessions = [createSession('proj-1', 'project', 'My Project', '/projects/myproj')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['proj-1'])}
          activeSessionId="proj-1"
        />
      );

      const terminal = screen.getByTestId('terminal-proj-1');
      expect(terminal).toBeInTheDocument();
      expect(terminal).toHaveAttribute('data-type', 'project');
    });

    it('renders terminal for open worktree session', () => {
      const sessions: Session[] = [
        {
          id: 'wt-1',
          kind: 'worktree',
          name: 'feature-branch',
          path: '/worktrees/wt1',
          order: 0,
          projectId: 'proj-1',
          branch: 'feature-branch',
        },
      ];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['wt-1'])}
          activeSessionId="wt-1"
        />
      );

      const terminal = screen.getByTestId('terminal-wt-1');
      expect(terminal).toBeInTheDocument();
      expect(terminal).toHaveAttribute('data-type', 'main');
    });

    it('renders multiple open sessions', () => {
      const sessions = [
        createSession('scratch-1', 'scratch', 'Terminal 1', '/home'),
        createSession('proj-1', 'project', 'Project', '/projects/proj'),
        { ...createSession('wt-1', 'worktree', 'Feature', '/wt/1'), projectId: 'proj-1', branch: 'feature' },
      ];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1', 'proj-1', 'wt-1'])}
          activeSessionId="scratch-1"
        />
      );

      expect(screen.getByTestId('terminal-scratch-1')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-proj-1')).toBeInTheDocument();
      expect(screen.getByTestId('terminal-wt-1')).toBeInTheDocument();
    });

    it('only renders open sessions', () => {
      const sessions = [
        createSession('scratch-1', 'scratch', 'Terminal 1', '/home'),
        createSession('scratch-2', 'scratch', 'Terminal 2', '/home'),
      ];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
        />
      );

      expect(screen.getByTestId('terminal-scratch-1')).toBeInTheDocument();
      expect(screen.queryByTestId('terminal-scratch-2')).not.toBeInTheDocument();
    });
  });

  describe('active session visibility', () => {
    it('marks active session as active', () => {
      const sessions = [
        createSession('scratch-1', 'scratch', 'Terminal 1', '/home'),
        createSession('scratch-2', 'scratch', 'Terminal 2', '/home'),
      ];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1', 'scratch-2'])}
          activeSessionId="scratch-1"
        />
      );

      expect(screen.getByTestId('terminal-scratch-1')).toHaveAttribute('data-active', 'true');
      expect(screen.getByTestId('terminal-scratch-2')).toHaveAttribute('data-active', 'false');
    });

    it('updates active state when activeSessionId changes', () => {
      const sessions = [
        createSession('scratch-1', 'scratch', 'Terminal 1', '/home'),
        createSession('scratch-2', 'scratch', 'Terminal 2', '/home'),
      ];

      const { rerender } = render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1', 'scratch-2'])}
          activeSessionId="scratch-1"
        />
      );

      expect(screen.getByTestId('terminal-scratch-1')).toHaveAttribute('data-active', 'true');

      rerender(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1', 'scratch-2'])}
          activeSessionId="scratch-2"
        />
      );

      expect(screen.getByTestId('terminal-scratch-1')).toHaveAttribute('data-active', 'false');
      expect(screen.getByTestId('terminal-scratch-2')).toHaveAttribute('data-active', 'true');
    });
  });

  describe('session kind to terminal type mapping', () => {
    it('maps scratch to scratch type', () => {
      const sessions = [createSession('s-1', 'scratch', 'Term', '/home')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['s-1'])}
          activeSessionId="s-1"
        />
      );

      expect(screen.getByTestId('terminal-s-1')).toHaveAttribute('data-type', 'scratch');
    });

    it('maps project to project type', () => {
      const sessions = [createSession('p-1', 'project', 'Proj', '/proj')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['p-1'])}
          activeSessionId="p-1"
        />
      );

      expect(screen.getByTestId('terminal-p-1')).toHaveAttribute('data-type', 'project');
    });

    it('maps worktree to main type', () => {
      const sessions: Session[] = [
        { id: 'w-1', kind: 'worktree', name: 'WT', path: '/wt', order: 0, projectId: 'p-1', branch: 'main' },
      ];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['w-1'])}
          activeSessionId="w-1"
        />
      );

      expect(screen.getByTestId('terminal-w-1')).toHaveAttribute('data-type', 'main');
    });
  });

  describe('callbacks', () => {
    it('renders terminals with expected props', () => {
      const onFocus = vi.fn();
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          onFocus={onFocus}
        />
      );

      // Verify the terminal is rendered with expected attributes
      const terminal = screen.getByTestId('terminal-scratch-1');
      expect(terminal).toBeInTheDocument();
      expect(terminal).toHaveAttribute('data-type', 'scratch');
      expect(terminal).toHaveAttribute('data-active', 'true');
    });
  });

  describe('config errors', () => {
    it('renders terminal alongside config error banner', () => {
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];
      const configErrors = [{ file: '/test/config.json', message: 'Test error' }];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          configErrors={configErrors}
        />
      );

      // Terminal should still be rendered when there are config errors
      expect(screen.getByTestId('terminal-scratch-1')).toBeInTheDocument();
    });
  });
});

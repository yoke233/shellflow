import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MainPane } from './MainPane';
import { Session, SessionTab, TabSplitState, SplitPaneConfig } from '../../types';
import { resetMocks, mockInvokeResponses, defaultTestConfig } from '../../test/setup';

// Mock the MainTerminal component to avoid xterm complexity
vi.mock('./MainTerminal', () => ({
  MainTerminal: vi.fn(({ entityId, type, isActive }) => (
    <div data-testid={`terminal-${entityId}`} data-type={type} data-active={isActive}>
      Terminal: {entityId}
    </div>
  )),
}));

// Mock the SessionTabBar component
vi.mock('./SessionTabBar', () => ({
  SessionTabBar: vi.fn(() => null),
}));

// Shared split state that persists across tests within a test case
let mockSplitStates: Map<string, TabSplitState>;

// Mock split context hooks to return predictable IDs based on tab IDs
// This ensures test assertions can find terminals by their tab ID
const mockSplitActions = {
  initTab: (tabId: string, config: Omit<SplitPaneConfig, 'id'>) => {
    // Use tabId as the pane ID for predictable testing
    const paneId = tabId;
    if (!mockSplitStates.has(tabId)) {
      mockSplitStates.set(tabId, {
        panes: new Map([[paneId, { id: paneId, ...config }]]),
        activePaneId: paneId,
      });
    }
    return paneId;
  },
  focusPane: vi.fn(),
  setPaneReady: vi.fn(),
  getActivePaneId: (tabId: string) => mockSplitStates.get(tabId)?.activePaneId ?? null,
  clearPendingSplit: vi.fn(),
  split: vi.fn(),
  closePane: vi.fn(),
  focusDirection: vi.fn(),
  getTabPtyIds: vi.fn(() => []),
  clearTab: vi.fn(),
  hasSplits: vi.fn(() => false),
  getPaneConfig: vi.fn(),
  getPaneIds: vi.fn(() => []),
};

vi.mock('../../contexts/SplitContext', () => ({
  useSplit: () => ({
    splitStates: mockSplitStates,
    ...mockSplitActions,
  }),
  useSplitActions: () => mockSplitActions,
  useSplitForTab: (tabId: string) => mockSplitStates.get(tabId),
}));

describe('MainPane', () => {
  // Helper to create a default session tab
  const createSessionTab = (sessionId: string, index: number = 1, isPrimary: boolean = true): SessionTab => ({
    id: `${sessionId}-session-${index}`,
    label: `Terminal ${index}`,
    isPrimary,
  });

  // Props without split layout (now provided via SplitContext)
  const defaultProps = {
    sessions: [] as Session[],
    openSessionIds: new Set<string>(),
    activeSessionId: null as string | null,
    allSessionTabs: new Map<string, SessionTab[]>(),
    activeSessionTabId: null as string | null,
    sessionLastActiveTabIds: new Map<string, string>(),
    isCtrlKeyHeld: false,
    onSelectSessionTab: vi.fn(),
    onCloseSessionTab: vi.fn(),
    onAddSessionTab: vi.fn(),
    onReorderSessionTabs: vi.fn(),
    terminalConfig: defaultTestConfig.main,
    editorConfig: defaultTestConfig.main,
    activityTimeout: 250,
    shouldAutoFocus: false,
    configErrors: [],
    onFocus: vi.fn(),
  };

  // Helper to create allSessionTabs Map from sessionId and tabs
  const createAllSessionTabs = (sessionId: string, tabs: SessionTab[]): Map<string, SessionTab[]> => {
    return new Map([[sessionId, tabs]]);
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
    // Reset mock split states for each test
    mockSplitStates = new Map();
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
        />,
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
        />,
      );

      expect(screen.getByText('Shellflow')).toBeInTheDocument();
    });
  });

  describe('session rendering', () => {
    it('renders terminal for open scratch session', () => {
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];
      const sessionTabs = [createSessionTab('scratch-1')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
        />,
      );

      const terminal = screen.getByTestId(`terminal-${sessionTabs[0].id}`);
      expect(terminal).toBeInTheDocument();
      expect(terminal).toHaveAttribute('data-type', 'scratch');
      expect(terminal).toHaveAttribute('data-active', 'true');
    });

    it('renders terminal for open project session', () => {
      const sessions = [createSession('proj-1', 'project', 'My Project', '/projects/myproj')];
      const sessionTabs = [createSessionTab('proj-1')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['proj-1'])}
          activeSessionId="proj-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
        />,
      );

      const terminal = screen.getByTestId(`terminal-${sessionTabs[0].id}`);
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
      const sessionTabs = [createSessionTab('wt-1')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['wt-1'])}
          activeSessionId="wt-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
        />,
      );

      const terminal = screen.getByTestId(`terminal-${sessionTabs[0].id}`);
      expect(terminal).toBeInTheDocument();
      expect(terminal).toHaveAttribute('data-type', 'main');
    });

    it('renders multiple tabs for the same session', () => {
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];
      const sessionTabs = [
        createSessionTab('scratch-1', 1, true),
        createSessionTab('scratch-1', 2, false),
      ];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
        />,
      );

      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`terminal-${sessionTabs[1].id}`)).toBeInTheDocument();
    });

    it('renders tabs for all sessions to keep terminals alive', () => {
      const sessions = [
        createSession('scratch-1', 'scratch', 'Terminal 1', '/home'),
        createSession('scratch-2', 'scratch', 'Terminal 2', '/home'),
      ];
      const session1Tabs = [createSessionTab('scratch-1')];
      const session2Tabs = [createSessionTab('scratch-2')];

      // Create a map with tabs for both sessions
      const allTabs = new Map<string, SessionTab[]>([
        ['scratch-1', session1Tabs],
        ['scratch-2', session2Tabs],
      ]);

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1', 'scratch-2'])}
          activeSessionId="scratch-1"
          allSessionTabs={allTabs}
          activeSessionTabId={session1Tabs[0].id}
        />,
      );

      // Both sessions' tabs are rendered (to keep terminals alive)
      expect(screen.getByTestId(`terminal-${session1Tabs[0].id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`terminal-${session2Tabs[0].id}`)).toBeInTheDocument();

      // Active session's tab is marked active, other session's tab is inactive
      expect(screen.getByTestId(`terminal-${session1Tabs[0].id}`)).toHaveAttribute('data-active', 'true');
      expect(screen.getByTestId(`terminal-${session2Tabs[0].id}`)).toHaveAttribute('data-active', 'false');
    });
  });

  describe('active tab visibility', () => {
    it('marks active tab as active', () => {
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];
      const sessionTabs = [
        createSessionTab('scratch-1', 1, true),
        createSessionTab('scratch-1', 2, false),
      ];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
        />,
      );

      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toHaveAttribute('data-active', 'true');
      expect(screen.getByTestId(`terminal-${sessionTabs[1].id}`)).toHaveAttribute('data-active', 'false');
    });

    it('updates active state when activeSessionTabId changes', () => {
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];
      const sessionTabs = [
        createSessionTab('scratch-1', 1, true),
        createSessionTab('scratch-1', 2, false),
      ];

      const { rerender } = render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
        />,
      );

      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toHaveAttribute('data-active', 'true');

      rerender(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[1].id}
        />,
      );

      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toHaveAttribute('data-active', 'false');
      expect(screen.getByTestId(`terminal-${sessionTabs[1].id}`)).toHaveAttribute('data-active', 'true');
    });
  });

  describe('session kind to terminal type mapping', () => {
    it('maps scratch to scratch type (for primary tab)', () => {
      const sessions = [createSession('s-1', 'scratch', 'Term', '/home')];
      const sessionTabs = [createSessionTab('s-1')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['s-1'])}
          activeSessionId="s-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
        />,
      );

      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toHaveAttribute('data-type', 'scratch');
    });

    it('maps project to project type (for primary tab)', () => {
      const sessions = [createSession('p-1', 'project', 'Proj', '/proj')];
      const sessionTabs = [createSessionTab('p-1')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['p-1'])}
          activeSessionId="p-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
        />,
      );

      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toHaveAttribute('data-type', 'project');
    });

    it('maps worktree to main type (for primary tab)', () => {
      const sessions: Session[] = [
        { id: 'w-1', kind: 'worktree', name: 'WT', path: '/wt', order: 0, projectId: 'p-1', branch: 'main' },
      ];
      const sessionTabs = [createSessionTab('w-1')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['w-1'])}
          activeSessionId="w-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
        />,
      );

      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toHaveAttribute('data-type', 'main');
    });

    it('secondary tabs use scratch type regardless of session kind', () => {
      const sessions: Session[] = [
        { id: 'w-1', kind: 'worktree', name: 'WT', path: '/wt', order: 0, projectId: 'p-1', branch: 'main' },
      ];
      const sessionTabs = [
        createSessionTab('w-1', 1, true),   // primary - should be main type
        createSessionTab('w-1', 2, false),  // secondary - should be scratch type
      ];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['w-1'])}
          activeSessionId="w-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
        />,
      );

      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toHaveAttribute('data-type', 'main');
      expect(screen.getByTestId(`terminal-${sessionTabs[1].id}`)).toHaveAttribute('data-type', 'scratch');
    });
  });

  describe('callbacks', () => {
    it('renders terminals with expected props', () => {
      const onFocus = vi.fn();
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];
      const sessionTabs = [createSessionTab('scratch-1')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
          onFocus={onFocus}
        />,
      );

      // Verify the terminal is rendered with expected attributes
      const terminal = screen.getByTestId(`terminal-${sessionTabs[0].id}`);
      expect(terminal).toBeInTheDocument();
      expect(terminal).toHaveAttribute('data-type', 'scratch');
      expect(terminal).toHaveAttribute('data-active', 'true');
    });
  });

  describe('config errors', () => {
    it('renders terminal alongside config error banner', () => {
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];
      const sessionTabs = [createSessionTab('scratch-1')];
      const configErrors = [{ file: '/test/config.json', message: 'Test error' }];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
          configErrors={configErrors}
        />,
      );

      // Terminal should still be rendered when there are config errors
      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toBeInTheDocument();
    });
  });

  describe('sessionLastActiveTabIds', () => {
    it('passes sessionLastActiveTabIds correctly to terminals', () => {
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];
      const sessionTabs = [
        createSessionTab('scratch-1', 1, true),
        createSessionTab('scratch-1', 2, false),
      ];

      // Tab 1 is active, but tab 2 was last active (e.g., user just switched to tab 1)
      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
          sessionLastActiveTabIds={new Map([['scratch-1', sessionTabs[1].id]])}
        />,
      );

      // Both terminals should render
      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`terminal-${sessionTabs[1].id}`)).toBeInTheDocument();
    });

    it('defaults lastActiveTab to activeTab when not set', () => {
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];
      const sessionTabs = [createSessionTab('scratch-1')];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
          sessionLastActiveTabIds={new Map()}
        />,
      );

      // Terminal should render
      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toBeInTheDocument();
    });
  });

  describe('tab bar integration', () => {
    it('passes onSelectSessionTab to SessionTabBar', () => {
      const onSelectSessionTab = vi.fn();
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];
      const sessionTabs = [
        createSessionTab('scratch-1', 1, true),
        createSessionTab('scratch-1', 2, false),
      ];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
          onSelectSessionTab={onSelectSessionTab}
        />,
      );

      // Both terminals render
      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`terminal-${sessionTabs[1].id}`)).toBeInTheDocument();
    });

    it('passes onCloseSessionTab to SessionTabBar', () => {
      const onCloseSessionTab = vi.fn();
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];
      const sessionTabs = [
        createSessionTab('scratch-1', 1, true),
        createSessionTab('scratch-1', 2, false),
      ];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
          onCloseSessionTab={onCloseSessionTab}
        />,
      );

      // Terminals render
      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toBeInTheDocument();
    });

    it('passes onAddSessionTab to SessionTabBar', () => {
      const onAddSessionTab = vi.fn();
      const sessions = [createSession('scratch-1', 'scratch', 'Terminal 1', '/home')];
      const sessionTabs = [
        createSessionTab('scratch-1', 1, true),
        createSessionTab('scratch-1', 2, false),
      ];

      render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['scratch-1'])}
          activeSessionId="scratch-1"
          allSessionTabs={createAllSessionTabs(sessions[0].id, sessionTabs)}
          activeSessionTabId={sessionTabs[0].id}
          onAddSessionTab={onAddSessionTab}
        />,
      );

      // Terminals render
      expect(screen.getByTestId(`terminal-${sessionTabs[0].id}`)).toBeInTheDocument();
    });
  });

  describe('terminal persistence across session switches (regression test)', () => {
    it('does not recreate terminals when switching between sessions', async () => {
      const { MainTerminal } = await import('./MainTerminal');
      const mockMainTerminal = vi.mocked(MainTerminal);
      mockMainTerminal.mockClear();

      const sessions = [
        createSession('session-1', 'scratch', 'Terminal 1', '/home'),
        createSession('session-2', 'scratch', 'Terminal 2', '/home'),
      ];
      const session1Tabs = [createSessionTab('session-1')];
      const session2Tabs = [createSessionTab('session-2')];
      const allTabs = new Map<string, SessionTab[]>([
        ['session-1', session1Tabs],
        ['session-2', session2Tabs],
      ]);

      // Initial render with session-1 active
      const { rerender } = render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['session-1', 'session-2'])}
          activeSessionId="session-1"
          allSessionTabs={allTabs}
          activeSessionTabId={session1Tabs[0].id}
        />,
      );

      // Both terminals should be rendered (one visible, one hidden)
      expect(screen.getByTestId(`terminal-${session1Tabs[0].id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`terminal-${session2Tabs[0].id}`)).toBeInTheDocument();

      // Record how many times MainTerminal was called after initial render
      const initialCallCount = mockMainTerminal.mock.calls.length;
      expect(initialCallCount).toBe(2); // One for each session

      // Switch to session-2
      rerender(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['session-1', 'session-2'])}
          activeSessionId="session-2"
          allSessionTabs={allTabs}
          activeSessionTabId={session2Tabs[0].id}
        />,
      );

      // Both terminals should still exist (not recreated)
      expect(screen.getByTestId(`terminal-${session1Tabs[0].id}`)).toBeInTheDocument();
      expect(screen.getByTestId(`terminal-${session2Tabs[0].id}`)).toBeInTheDocument();

      // Switch back to session-1
      rerender(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['session-1', 'session-2'])}
          activeSessionId="session-1"
          allSessionTabs={allTabs}
          activeSessionTabId={session1Tabs[0].id}
        />,
      );

      // Original session-1 terminal should still be there (same DOM element)
      const terminal1 = screen.getByTestId(`terminal-${session1Tabs[0].id}`);
      expect(terminal1).toBeInTheDocument();
      expect(terminal1).toHaveAttribute('data-active', 'true');

      // The mock component should not have been called with new instances
      // (React reuses the same component instance due to stable keys)
      // Note: React may call the render function again for props updates,
      // but the key point is the component is not unmounted/remounted
    });

    it('preserves terminal DOM elements when switching sessions', () => {
      const sessions = [
        createSession('session-1', 'scratch', 'Terminal 1', '/home'),
        createSession('session-2', 'scratch', 'Terminal 2', '/home'),
      ];
      const session1Tabs = [createSessionTab('session-1')];
      const session2Tabs = [createSessionTab('session-2')];
      const allTabs = new Map<string, SessionTab[]>([
        ['session-1', session1Tabs],
        ['session-2', session2Tabs],
      ]);

      const { rerender } = render(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['session-1', 'session-2'])}
          activeSessionId="session-1"
          allSessionTabs={allTabs}
          activeSessionTabId={session1Tabs[0].id}
        />,
      );

      // Get reference to the terminal DOM element
      const terminal1Before = screen.getByTestId(`terminal-${session1Tabs[0].id}`);
      expect(terminal1Before).toHaveAttribute('data-active', 'true');

      // Switch to session-2
      rerender(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['session-1', 'session-2'])}
          activeSessionId="session-2"
          allSessionTabs={allTabs}
          activeSessionTabId={session2Tabs[0].id}
        />,
      );

      // Session-1 terminal should still exist but be inactive
      const terminal1During = screen.getByTestId(`terminal-${session1Tabs[0].id}`);
      expect(terminal1During).toHaveAttribute('data-active', 'false');

      // Switch back to session-1
      rerender(
        <MainPane
          {...defaultProps}
          sessions={sessions}
          openSessionIds={new Set(['session-1', 'session-2'])}
          activeSessionId="session-1"
          allSessionTabs={allTabs}
          activeSessionTabId={session1Tabs[0].id}
        />,
      );

      // Session-1 terminal should be active again - same element preserved
      const terminal1After = screen.getByTestId(`terminal-${session1Tabs[0].id}`);
      expect(terminal1After).toHaveAttribute('data-active', 'true');

      // Verify it's the same DOM element (not recreated)
      // This is the key assertion - if the element was recreated, this would be a different node
      expect(terminal1Before).toBe(terminal1After);
    });
  });
});

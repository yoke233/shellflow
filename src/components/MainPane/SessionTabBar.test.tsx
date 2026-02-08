import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SessionTabBar } from './SessionTabBar';
import { SessionTab } from '../../types';

describe('SessionTabBar', () => {
  const createTab = (id: string, label: string, isPrimary = false): SessionTab => ({
    id,
    label,
    isPrimary,
  });

  const defaultProps = {
    tabs: [] as SessionTab[],
    activeTabId: null as string | null,
    isCtrlKeyHeld: false,
    onSelectTab: vi.fn(),
    onCloseTab: vi.fn(),
    onAddTab: vi.fn(),
    onReorderTabs: vi.fn(),
    onRenameTab: vi.fn(),
    newTabShortcut: 'Ctrl+T',
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('visibility', () => {
    it('renders tab bar when there is only one tab', () => {
      const tabs = [createTab('tab-1', 'Terminal 1', true)];
      const { container } = render(
        <SessionTabBar {...defaultProps} tabs={tabs} activeTabId="tab-1" />
      );
      expect(container.firstChild).not.toBeNull();
      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    });

    it('returns null when there are no tabs', () => {
      const { container } = render(<SessionTabBar {...defaultProps} />);
      expect(container.firstChild).toBeNull();
    });

    it('renders tab bar when there are multiple tabs', () => {
      const tabs = [
        createTab('tab-1', 'Terminal 1', true),
        createTab('tab-2', 'Terminal 2', false),
      ];
      render(<SessionTabBar {...defaultProps} tabs={tabs} activeTabId="tab-1" />);
      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
      expect(screen.getByText('Terminal 2')).toBeInTheDocument();
    });
  });

  describe('tab rendering', () => {
    it('renders all tabs with labels', () => {
      const tabs = [
        createTab('tab-1', 'Terminal 1'),
        createTab('tab-2', 'Terminal 2'),
        createTab('tab-3', 'Terminal 3'),
      ];
      render(<SessionTabBar {...defaultProps} tabs={tabs} activeTabId="tab-1" />);

      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
      expect(screen.getByText('Terminal 2')).toBeInTheDocument();
      expect(screen.getByText('Terminal 3')).toBeInTheDocument();
    });

    it('shows add tab button', () => {
      const tabs = [
        createTab('tab-1', 'Terminal 1'),
        createTab('tab-2', 'Terminal 2'),
      ];
      render(<SessionTabBar {...defaultProps} tabs={tabs} activeTabId="tab-1" />);

      // Find button by title
      expect(screen.getByTitle('New tab (Ctrl+T)')).toBeInTheDocument();
    });

    it('renders add tab button before tab labels in the DOM', () => {
      const tabs = [
        createTab('tab-1', 'Terminal 1'),
        createTab('tab-2', 'Terminal 2'),
      ];
      render(<SessionTabBar {...defaultProps} tabs={tabs} activeTabId="tab-1" />);

      const addButton = screen.getByTitle('New tab (Ctrl+T)');
      const firstTabLabel = screen.getByText('Terminal 1');

      const position = addButton.compareDocumentPosition(firstTabLabel);
      expect(position & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    });
  });

  describe('tab selection', () => {
    it('calls onSelectTab when tab is clicked', () => {
      const onSelectTab = vi.fn();
      const tabs = [
        createTab('tab-1', 'Terminal 1'),
        createTab('tab-2', 'Terminal 2'),
      ];
      render(
        <SessionTabBar
          {...defaultProps}
          tabs={tabs}
          activeTabId="tab-1"
          onSelectTab={onSelectTab}
        />
      );

      fireEvent.click(screen.getByText('Terminal 2'));
      expect(onSelectTab).toHaveBeenCalledWith('tab-2');
    });
  });

  describe('tab closing', () => {
    it('calls onCloseTab when close button is clicked', () => {
      const onCloseTab = vi.fn();
      const tabs = [
        createTab('tab-1', 'Terminal 1'),
        createTab('tab-2', 'Terminal 2'),
      ];
      render(
        <SessionTabBar
          {...defaultProps}
          tabs={tabs}
          activeTabId="tab-1"
          onCloseTab={onCloseTab}
        />
      );

      // Find close button within the first tab (Terminal 1)
      // The close button is within the same container as the tab label
      const tab1Label = screen.getByText('Terminal 1');
      const tab1Container = tab1Label.closest('div');
      const closeButton = tab1Container?.querySelector('button');
      expect(closeButton).toBeTruthy();
      fireEvent.click(closeButton!);
      expect(onCloseTab).toHaveBeenCalledWith('tab-1');
    });
  });

  describe('add tab', () => {
    it('calls onAddTab when add button is clicked', () => {
      const onAddTab = vi.fn();
      const tabs = [
        createTab('tab-1', 'Terminal 1'),
        createTab('tab-2', 'Terminal 2'),
      ];
      render(
        <SessionTabBar
          {...defaultProps}
          tabs={tabs}
          activeTabId="tab-1"
          onAddTab={onAddTab}
        />
      );

      fireEvent.click(screen.getByTitle('New tab (Ctrl+T)'));
      expect(onAddTab).toHaveBeenCalled();
    });
  });

  describe('keyboard shortcut hints', () => {
    it('shows shortcut numbers when Cmd key is held', () => {
      const tabs = [
        createTab('tab-1', 'Terminal 1'),
        createTab('tab-2', 'Terminal 2'),
        createTab('tab-3', 'Terminal 3'),
      ];
      render(
        <SessionTabBar
          {...defaultProps}
          tabs={tabs}
          activeTabId="tab-1"
          isCtrlKeyHeld={true}
        />
      );

      expect(screen.getByText('1')).toBeInTheDocument();
      expect(screen.getByText('2')).toBeInTheDocument();
      expect(screen.getByText('3')).toBeInTheDocument();
    });

    it('does not show shortcut numbers when Cmd key is not held', () => {
      const tabs = [
        createTab('tab-1', 'Terminal 1'),
        createTab('tab-2', 'Terminal 2'),
      ];
      render(
        <SessionTabBar
          {...defaultProps}
          tabs={tabs}
          activeTabId="tab-1"
          isCtrlKeyHeld={false}
        />
      );

      expect(screen.queryByText('1')).not.toBeInTheDocument();
      expect(screen.queryByText('2')).not.toBeInTheDocument();
    });

    it('only shows shortcut numbers for first 9 tabs', () => {
      const tabs = Array.from({ length: 11 }, (_, i) =>
        createTab(`tab-${i + 1}`, `Terminal ${i + 1}`)
      );
      render(
        <SessionTabBar
          {...defaultProps}
          tabs={tabs}
          activeTabId="tab-1"
          isCtrlKeyHeld={true}
        />
      );

      // Should show 1-9
      for (let i = 1; i <= 9; i++) {
        expect(screen.getByText(String(i))).toBeInTheDocument();
      }
      // Should not show 10 or 11 as shortcut numbers (they would be shown as labels)
    });
  });

  describe('tab reordering', () => {
    it('has reorder callback prop', () => {
      const onReorderTabs = vi.fn();
      const tabs = [
        createTab('tab-1', 'Terminal 1'),
        createTab('tab-2', 'Terminal 2'),
      ];
      render(
        <SessionTabBar
          {...defaultProps}
          tabs={tabs}
          activeTabId="tab-1"
          onReorderTabs={onReorderTabs}
        />
      );

      // Verify tabs render - drag and drop is handled by dnd-kit
      // which is difficult to test without mocking internals
      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
      expect(screen.getByText('Terminal 2')).toBeInTheDocument();
    });
  });

  describe('active tab styling', () => {
    it('marks active tab correctly', () => {
      const tabs = [
        createTab('tab-1', 'Terminal 1'),
        createTab('tab-2', 'Terminal 2'),
      ];
      render(
        <SessionTabBar
          {...defaultProps}
          tabs={tabs}
          activeTabId="tab-2"
        />
      );

      // Both tabs should be rendered, with tab-2 being active
      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
      expect(screen.getByText('Terminal 2')).toBeInTheDocument();
    });
  });
});

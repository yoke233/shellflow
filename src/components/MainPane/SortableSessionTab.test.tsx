import { describe, it, expect, beforeEach, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { SortableSessionTab } from './SortableSessionTab';
import { SessionTab } from '../../types';

// Mock dnd-kit
vi.mock('@dnd-kit/sortable', () => ({
  useSortable: vi.fn(() => ({
    attributes: { 'aria-describedby': 'sortable-description' },
    listeners: { onPointerDown: vi.fn() },
    setNodeRef: vi.fn(),
    transform: null,
    transition: undefined,
    isDragging: false,
  })),
}));

describe('SortableSessionTab', () => {
  const createTab = (id: string, label: string, isPrimary = false): SessionTab => ({
    id,
    label,
    isPrimary,
  });

  const defaultProps = {
    tab: createTab('tab-1', 'Terminal 1', true),
    isActive: false,
    isAnyDragging: false,
    shortcutNumber: null as number | null,
    isCtrlKeyHeld: false,
    onSelect: vi.fn(),
    onClose: vi.fn(),
    onRename: vi.fn(),
  };

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('rendering', () => {
    it('renders tab label', () => {
      render(<SortableSessionTab {...defaultProps} />);
      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    });

    it('renders terminal icon when ctrl is not held', () => {
      render(<SortableSessionTab {...defaultProps} />);
      // Terminal icon from lucide-react is rendered as SVG
      const tabElement = screen.getByText('Terminal 1').closest('div');
      expect(tabElement?.querySelector('svg')).toBeInTheDocument();
    });

    it('renders shortcut number instead of icon when Cmd is held', () => {
      render(
        <SortableSessionTab
          {...defaultProps}
          isCtrlKeyHeld={true}
          shortcutNumber={1}
        />
      );
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('does not show shortcut number when Cmd is held but shortcutNumber is null', () => {
      render(
        <SortableSessionTab
          {...defaultProps}
          isCtrlKeyHeld={true}
          shortcutNumber={null}
        />
      );
      // Should show terminal icon, not a number
      expect(screen.queryByText(/^\d$/)).not.toBeInTheDocument();
    });
  });

  describe('active state styling', () => {
    it('has active styling when isActive is true', () => {
      render(<SortableSessionTab {...defaultProps} isActive={true} />);
      const tabElement = screen.getByText('Terminal 1').closest('div');
      expect(tabElement).toHaveClass('bg-theme-2', 'text-theme-0');
    });

    it('has inactive styling when isActive is false', () => {
      render(<SortableSessionTab {...defaultProps} isActive={false} />);
      const tabElement = screen.getByText('Terminal 1').closest('div');
      expect(tabElement).toHaveClass('bg-theme-1', 'text-theme-2');
    });
  });

  describe('interactions', () => {
    it('calls onSelect when clicked', () => {
      const onSelect = vi.fn();
      render(<SortableSessionTab {...defaultProps} onSelect={onSelect} />);

      const tabElement = screen.getByText('Terminal 1').closest('div');
      fireEvent.click(tabElement!);

      expect(onSelect).toHaveBeenCalled();
    });

    it('calls onClose when close button is clicked', () => {
      const onClose = vi.fn();
      render(<SortableSessionTab {...defaultProps} onClose={onClose} />);

      // Find the close button (button with X icon)
      const closeButton = screen.getByRole('button');
      fireEvent.click(closeButton);

      expect(onClose).toHaveBeenCalled();
    });

    it('prevents onSelect when close button is clicked', () => {
      const onSelect = vi.fn();
      const onClose = vi.fn();
      render(
        <SortableSessionTab
          {...defaultProps}
          onSelect={onSelect}
          onClose={onClose}
        />
      );

      const closeButton = screen.getByRole('button');
      fireEvent.click(closeButton);

      // onClose should be called, but onSelect should not
      expect(onClose).toHaveBeenCalled();
      expect(onSelect).not.toHaveBeenCalled();
    });

    it('does not call onClose when dragging', () => {
      const onClose = vi.fn();
      render(
        <SortableSessionTab
          {...defaultProps}
          onClose={onClose}
          isAnyDragging={true}
        />
      );

      const closeButton = screen.getByRole('button');
      fireEvent.click(closeButton);

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('rename', () => {
    it('enters edit mode on double click and calls onRename on enter', () => {
      const onRename = vi.fn();
      render(<SortableSessionTab {...defaultProps} onRename={onRename} />);

      fireEvent.doubleClick(screen.getByText('Terminal 1'));
      const input = screen.getByLabelText('Rename tab') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'My Tab' } });
      fireEvent.keyDown(input, { key: 'Enter' });

      expect(onRename).toHaveBeenCalledWith('My Tab');
    });

    it('calls onRename with empty string when input is cleared and blurred', () => {
      const onRename = vi.fn();
      render(<SortableSessionTab {...defaultProps} onRename={onRename} />);

      fireEvent.doubleClick(screen.getByText('Terminal 1'));
      const input = screen.getByLabelText('Rename tab') as HTMLInputElement;
      fireEvent.change(input, { target: { value: '' } });
      fireEvent.blur(input);

      expect(onRename).toHaveBeenCalledWith('');
    });

    it('cancels rename on Escape', () => {
      const onRename = vi.fn();
      render(<SortableSessionTab {...defaultProps} onRename={onRename} />);

      fireEvent.doubleClick(screen.getByText('Terminal 1'));
      const input = screen.getByLabelText('Rename tab') as HTMLInputElement;
      fireEvent.change(input, { target: { value: 'Scratch' } });
      fireEvent.keyDown(input, { key: 'Escape' });

      expect(onRename).not.toHaveBeenCalled();
      expect(screen.getByText('Terminal 1')).toBeInTheDocument();
    });
  });

  describe('shortcut numbers', () => {
    it('shows shortcut number 1 when Cmd is held', () => {
      render(
        <SortableSessionTab
          {...defaultProps}
          isCtrlKeyHeld={true}
          shortcutNumber={1}
        />
      );
      expect(screen.getByText('1')).toBeInTheDocument();
    });

    it('shows shortcut number 9 when Cmd is held', () => {
      render(
        <SortableSessionTab
          {...defaultProps}
          isCtrlKeyHeld={true}
          shortcutNumber={9}
        />
      );
      expect(screen.getByText('9')).toBeInTheDocument();
    });

    it('does not show shortcut when Cmd is not held even if shortcutNumber is set', () => {
      render(
        <SortableSessionTab
          {...defaultProps}
          isCtrlKeyHeld={false}
          shortcutNumber={1}
        />
      );
      // Should not have the number displayed
      expect(screen.queryByText('1')).not.toBeInTheDocument();
    });
  });

  describe('truncation', () => {
    it('truncates long labels', () => {
      const longLabel = 'This is a very long terminal label that should be truncated';
      render(
        <SortableSessionTab
          {...defaultProps}
          tab={createTab('tab-1', longLabel)}
        />
      );

      const labelElement = screen.getByText(longLabel);
      expect(labelElement).toHaveClass('truncate');
    });
  });

  describe('indicator icons', () => {
    it('shows thinking spinner when isThinking is true', () => {
      render(<SortableSessionTab {...defaultProps} isThinking={true} />);
      const tabElement = screen.getByText('Terminal 1').closest('div');
      const svg = tabElement?.querySelector('svg');
      expect(svg).toHaveClass('animate-spin', 'text-violet-400');
    });

    it('shows notification bell when isNotified is true and not active', () => {
      render(<SortableSessionTab {...defaultProps} isNotified={true} isActive={false} />);
      const tabElement = screen.getByText('Terminal 1').closest('div');
      const svg = tabElement?.querySelector('svg');
      expect(svg).toHaveClass('text-blue-400');
    });

    it('does not show notification bell when isNotified is true but active', () => {
      render(<SortableSessionTab {...defaultProps} isNotified={true} isActive={true} />);
      const tabElement = screen.getByText('Terminal 1').closest('div');
      const svg = tabElement?.querySelector('svg');
      // When active and notified, shows terminal icon (no special color)
      expect(svg).not.toHaveClass('text-blue-400');
    });

    it('shows checkmark when isIdle is true and not active', () => {
      render(<SortableSessionTab {...defaultProps} isIdle={true} isActive={false} />);
      const tabElement = screen.getByText('Terminal 1').closest('div');
      const svg = tabElement?.querySelector('svg');
      expect(svg).toHaveClass('text-emerald-400');
    });

    it('does not show checkmark when isIdle is true but active', () => {
      render(<SortableSessionTab {...defaultProps} isIdle={true} isActive={true} />);
      const tabElement = screen.getByText('Terminal 1').closest('div');
      const svg = tabElement?.querySelector('svg');
      // When active and idle, shows terminal icon (no special color)
      expect(svg).not.toHaveClass('text-emerald-400');
    });

    it('notification takes priority over thinking', () => {
      render(
        <SortableSessionTab
          {...defaultProps}
          isNotified={true}
          isThinking={true}
          isActive={false}
        />
      );
      const tabElement = screen.getByText('Terminal 1').closest('div');
      const svg = tabElement?.querySelector('svg');
      // Should show notification (blue), not thinking (violet)
      expect(svg).toHaveClass('text-blue-400');
    });

    it('thinking takes priority over idle', () => {
      render(
        <SortableSessionTab
          {...defaultProps}
          isThinking={true}
          isIdle={true}
          isActive={false}
        />
      );
      const tabElement = screen.getByText('Terminal 1').closest('div');
      const svg = tabElement?.querySelector('svg');
      // Should show thinking (violet), not idle (emerald)
      expect(svg).toHaveClass('text-violet-400');
    });

    it('notification takes priority over idle', () => {
      render(
        <SortableSessionTab
          {...defaultProps}
          isNotified={true}
          isIdle={true}
          isActive={false}
        />
      );
      const tabElement = screen.getByText('Terminal 1').closest('div');
      const svg = tabElement?.querySelector('svg');
      // Should show notification (blue), not idle (emerald)
      expect(svg).toHaveClass('text-blue-400');
    });
  });
});

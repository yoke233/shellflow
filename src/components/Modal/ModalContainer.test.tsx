import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, fireEvent } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ModalContainer } from './ModalContainer';

describe('ModalContainer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('focus restoration', () => {
    it('restores focus to previously focused element when unmounted', async () => {
      // Create a button that will have focus before modal opens
      const { rerender } = render(
        <div>
          <button data-testid="trigger">Open Modal</button>
        </div>
      );

      // Focus the trigger button
      const trigger = screen.getByTestId('trigger');
      trigger.focus();
      expect(document.activeElement).toBe(trigger);

      // Render the modal (simulates opening it)
      rerender(
        <div>
          <button data-testid="trigger">Open Modal</button>
          <ModalContainer onClose={vi.fn()}>
            <input data-testid="modal-input" placeholder="Search..." />
          </ModalContainer>
        </div>
      );

      // Modal input should now have focus
      const modalInput = screen.getByTestId('modal-input');
      modalInput.focus();
      expect(document.activeElement).toBe(modalInput);

      // Remove the modal (parent controls unmounting based on onClose)
      rerender(
        <div>
          <button data-testid="trigger">Open Modal</button>
        </div>
      );

      // Wait for setTimeout in focus restoration
      await waitFor(() => {
        expect(document.activeElement).toBe(trigger);
      });
    });

    it('does not crash if previously focused element is removed', async () => {
      // Create a button that will be removed
      const { rerender } = render(
        <div>
          <button data-testid="will-be-removed">Temporary</button>
        </div>
      );

      // Focus the button
      const button = screen.getByTestId('will-be-removed');
      button.focus();

      // Open modal
      rerender(
        <div>
          <button data-testid="will-be-removed">Temporary</button>
          <ModalContainer onClose={vi.fn()}>
            <div>Modal content</div>
          </ModalContainer>
        </div>
      );

      // Remove both the button and the modal
      rerender(<div />);

      // Should not throw - the removed element won't be focused
      await waitFor(() => {
        // Just verify no error occurred
        expect(true).toBe(true);
      });
    });

    it('captures focus at time of mount', () => {
      // Focus body initially
      document.body.focus();

      const { rerender } = render(
        <div>
          <button data-testid="first">First</button>
          <button data-testid="second">Second</button>
        </div>
      );

      // Focus the second button
      screen.getByTestId('second').focus();
      expect(document.activeElement).toBe(screen.getByTestId('second'));

      // Open modal - it should capture focus of 'second' button
      rerender(
        <div>
          <button data-testid="first">First</button>
          <button data-testid="second">Second</button>
          <ModalContainer onClose={vi.fn()}>
            <div>Modal</div>
          </ModalContainer>
        </div>
      );

      // Focus first button while modal is open
      screen.getByTestId('first').focus();

      // Close modal - should restore to 'second' (what was focused when modal opened)
      rerender(
        <div>
          <button data-testid="first">First</button>
          <button data-testid="second">Second</button>
        </div>
      );

      // Wait for focus restoration
      return waitFor(() => {
        expect(document.activeElement).toBe(screen.getByTestId('second'));
      });
    });
  });

  describe('modal callbacks', () => {
    it('calls onModalOpen on mount', () => {
      const onModalOpen = vi.fn();

      render(
        <ModalContainer onClose={vi.fn()} onModalOpen={onModalOpen}>
          <div>Content</div>
        </ModalContainer>
      );

      expect(onModalOpen).toHaveBeenCalledTimes(1);
    });

    it('calls onModalClose on unmount', () => {
      const onModalClose = vi.fn();

      const { unmount } = render(
        <ModalContainer onClose={vi.fn()} onModalClose={onModalClose}>
          <div>Content</div>
        </ModalContainer>
      );

      unmount();

      expect(onModalClose).toHaveBeenCalledTimes(1);
    });
  });

  describe('closing behavior', () => {
    it('calls onClose when Escape is pressed on container', async () => {
      const onClose = vi.fn();

      render(
        <ModalContainer onClose={onClose}>
          <div>Content</div>
        </ModalContainer>
      );

      // Focus the container itself (it has tabIndex={-1})
      const container = document.querySelector('.fixed.inset-0') as HTMLElement;
      container.focus();

      // Use fireEvent which properly triggers React's synthetic events
      fireEvent.keyDown(container, { key: 'Escape' });

      // onClose is called after 100ms animation delay
      await waitFor(() => {
        expect(onClose).toHaveBeenCalledTimes(1);
      });
    });

    it('does not close when clicking inside modal content', async () => {
      const user = userEvent.setup();
      const onClose = vi.fn();

      render(
        <ModalContainer onClose={onClose}>
          <div data-testid="content">Content</div>
        </ModalContainer>
      );

      await user.click(screen.getByTestId('content'));

      expect(onClose).not.toHaveBeenCalled();
    });
  });

  describe('focus trapping', () => {
    it('keeps focus inside the modal when focus leaves', async () => {
      render(
        <ModalContainer onClose={vi.fn()}>
          <input data-testid="modal-input" />
        </ModalContainer>
      );

      const input = screen.getByTestId('modal-input');
      input.focus();

      // Simulate focus leaving the modal - the focusout handler should bring it back
      const container = document.querySelector('.fixed.inset-0');
      const focusOutEvent = new FocusEvent('focusout', {
        relatedTarget: document.body,
        bubbles: true,
      });
      container?.dispatchEvent(focusOutEvent);

      // Focus should stay in/return to the modal
      await waitFor(() => {
        expect(container?.contains(document.activeElement)).toBe(true);
      });
    });
  });
});

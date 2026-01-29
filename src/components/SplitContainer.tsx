/**
 * SplitContainer
 *
 * Wrapper around Gridview that manages split terminal panes within a tab.
 * Handles vim-style splits and navigation between panes.
 */

import { useCallback, useEffect, useRef, forwardRef, useImperativeHandle } from 'react';
import {
  GridviewReact,
  GridviewReadyEvent,
  IGridviewPanelProps,
  GridviewApi,
  Orientation,
} from 'dockview-react';
import { log } from '../lib/log';
import 'dockview-react/dist/styles/dockview.css';
import { SplitPaneConfig, SplitDirection, SplitOrientation, PendingSplit } from '../lib/splitTypes';

interface SplitContainerProps {
  /** All pane configurations for this container */
  panes: Map<string, SplitPaneConfig>;
  /** Currently active pane ID */
  activePaneId: string | null;
  /** Render function for pane content */
  renderPane: (paneId: string, paneConfig: SplitPaneConfig, isActivePane: boolean) => React.ReactNode;
  /** Called when a pane receives focus */
  onPaneFocus?: (paneId: string) => void;
  /** Pending split operation (from useSplitLayout) */
  pendingSplit?: PendingSplit;
  /** Called when pending split is consumed */
  onPendingSplitConsumed?: () => void;
  /** Pending focus direction (from useSplitActions) */
  pendingFocusDirection?: SplitDirection;
  /** Called when pending focus direction is consumed */
  onPendingFocusDirectionConsumed?: () => void;
}

export interface SplitContainerHandle {
  /** Create a split from the active pane */
  split: (orientation: SplitOrientation) => string | null;
  /** Focus a pane in a direction */
  focusDirection: (direction: SplitDirection) => void;
  /** Get the Gridview API (for advanced operations) */
  getApi: () => GridviewApi | null;
}

// Panel component that wraps the rendered content
function SplitPanel(props: IGridviewPanelProps<{ paneId: string; content: React.ReactNode }>) {
  const { content } = props.params;
  const containerRef = useRef<HTMLDivElement>(null);

  // Forward focus to the terminal inside when this panel receives focus
  const handleFocus = useCallback(() => {
    // Find the xterm textarea (the element that receives keyboard input)
    const textarea = containerRef.current?.querySelector('textarea.xterm-helper-textarea') as HTMLTextAreaElement | null;
    if (textarea) {
      textarea.focus();
    }
  }, []);

  // Use CSS to fill the panel instead of tracking dimensions in state
  // This avoids re-renders on every resize animation frame
  return (
    <div
      ref={containerRef}
      className="absolute inset-0 overflow-hidden"
      tabIndex={-1}
      onFocus={handleFocus}
      onClick={handleFocus}
    >
      {content}
    </div>
  );
}

// Component registry for Gridview
const components = {
  splitPanel: SplitPanel,
};

export const SplitContainer = forwardRef<SplitContainerHandle, SplitContainerProps>(
  function SplitContainer(
    { panes, activePaneId, renderPane, onPaneFocus, pendingSplit, onPendingSplitConsumed, pendingFocusDirection, onPendingFocusDirectionConsumed },
    ref
  ) {
    log.debug('[SPLIT:Container] render', { paneCount: panes.size, paneIds: Array.from(panes.keys()), activePaneId, hasPendingSplit: !!pendingSplit, hasPendingFocusDirection: !!pendingFocusDirection });

    const apiRef = useRef<GridviewApi | null>(null);

    // Store current values in refs so we can access them without adding to dependencies
    const panesRef = useRef(panes);
    panesRef.current = panes;
    const renderPaneRef = useRef(renderPane);
    renderPaneRef.current = renderPane;
    const onPendingSplitConsumedRef = useRef(onPendingSplitConsumed);
    onPendingSplitConsumedRef.current = onPendingSplitConsumed;
    const activePaneIdRef = useRef(activePaneId);
    activePaneIdRef.current = activePaneId;
    const pendingSplitRef = useRef(pendingSplit);
    pendingSplitRef.current = pendingSplit;
    const onPendingFocusDirectionConsumedRef = useRef(onPendingFocusDirectionConsumed);
    onPendingFocusDirectionConsumedRef.current = onPendingFocusDirectionConsumed;

    // Handle Gridview ready event - add the first pane
    const handleReady = useCallback((event: GridviewReadyEvent) => {
      log.debug('[SPLIT:Container] handleReady called', { existingPanels: event.api.panels.length });
      apiRef.current = event.api;

      const currentPanes = panesRef.current;
      const currentRenderPane = renderPaneRef.current;
      const currentActivePaneId = activePaneIdRef.current;

      // Add the first pane if it doesn't exist
      const paneArray = Array.from(currentPanes.values());
      if (paneArray.length > 0) {
        const firstPane = paneArray[0];
        if (!event.api.getPanel(firstPane.id)) {
          log.debug('[SPLIT:Container] handleReady: adding first panel', { paneId: firstPane.id });
          event.api.addPanel({
            id: firstPane.id,
            component: 'splitPanel',
            params: {
              paneId: firstPane.id,
              content: currentRenderPane(firstPane.id, firstPane, firstPane.id === currentActivePaneId),
            },
          });
        } else {
          log.debug('[SPLIT:Container] handleReady: first panel already exists', { paneId: firstPane.id });
        }
      }

      // Focus the active pane if it exists
      if (currentActivePaneId) {
        const panel = event.api.getPanel(currentActivePaneId);
        panel?.focus();
      }
    }, []); // Empty deps - we use refs for all values

    // Sync panes with Gridview when pane IDs or pendingSplit changes
    // Use a stable string of pane IDs to avoid unnecessary runs
    const paneIdsString = Array.from(panes.keys()).sort().join(',');

    useEffect(() => {
      log.debug('[SPLIT:Container] sync effect running', { paneIdsString, hasPendingSplit: !!pendingSplit });

      const api = apiRef.current;
      if (!api) {
        log.debug('[SPLIT:Container] sync: no api yet');
        return;
      }

      // Wait until at least one panel exists (handleReady adds the first one)
      if (api.panels.length === 0) {
        log.debug('[SPLIT:Container] sync: no panels yet, waiting for handleReady');
        return;
      }

      const currentPanes = panesRef.current;
      const currentRenderPane = renderPaneRef.current;
      const currentPendingSplit = pendingSplitRef.current;
      const currentOnPendingSplitConsumed = onPendingSplitConsumedRef.current;
      const currentActivePaneId = activePaneIdRef.current;

      log.debug('[SPLIT:Container] sync: state', {
        gridviewPanelCount: api.panels.length,
        gridviewPanelIds: api.panels.map(p => p.id),
        currentPaneCount: currentPanes.size,
        currentPaneIds: Array.from(currentPanes.keys()),
        currentPendingSplit
      });

      // Add new panes
      for (const [paneId, paneConfig] of currentPanes) {
        // Skip if panel already exists in Gridview
        if (api.getPanel(paneId)) {
          log.debug('[SPLIT:Container] sync: panel already exists', { paneId });
          continue;
        }

        // Check if this is the pane from a pending split operation
        if (currentPendingSplit && currentPendingSplit.newPaneId === paneId) {
          const refPane = api.getPanel(currentPendingSplit.referencePaneId);
          if (!refPane) {
            log.debug('[SPLIT:Container] sync: reference pane not found', { referencePaneId: currentPendingSplit.referencePaneId });
            continue;
          }

          const direction = currentPendingSplit.orientation === 'horizontal' ? 'right' : 'below';
          log.debug('[SPLIT:Container] sync: adding split panel', { paneId, referencePaneId: currentPendingSplit.referencePaneId, direction });

          api.addPanel({
            id: paneId,
            component: 'splitPanel',
            params: {
              paneId,
              content: currentRenderPane(paneId, paneConfig, false),
            },
            position: {
              referencePanel: currentPendingSplit.referencePaneId,
              direction,
            },
          });

          // Focus the new pane after split
          // Use requestAnimationFrame to ensure this happens after React renders and xterm.js initializes
          const newPanel = api.getPanel(paneId);
          requestAnimationFrame(() => {
            newPanel?.focus();
            // Directly focus the terminal textarea in the new pane
            const textarea = document.querySelector(
              `[data-terminal-id="${paneId}"] textarea.xterm-helper-textarea`
            ) as HTMLTextAreaElement | null;
            if (textarea) {
              textarea.focus();
            }
          });

          // Clear the pending split
          log.debug('[SPLIT:Container] sync: calling onPendingSplitConsumed');
          currentOnPendingSplitConsumed?.();
        } else {
          // Regular add (fallback) - add to the right of the last panel
          const existingPanels = api.panels;
          const lastPanel = existingPanels.length > 0 ? existingPanels[existingPanels.length - 1] : null;
          log.debug('[SPLIT:Container] sync: adding regular panel (fallback)', { paneId, afterPanel: lastPanel?.id });

          api.addPanel({
            id: paneId,
            component: 'splitPanel',
            params: {
              paneId,
              content: currentRenderPane(paneId, paneConfig, paneId === currentActivePaneId),
            },
            position: lastPanel ? {
              referencePanel: lastPanel.id,
              direction: 'right',
            } : undefined,
          });
        }
      }

      // Remove deleted panes
      const currentPaneIds = new Set(currentPanes.keys());
      for (const panel of api.panels) {
        if (!currentPaneIds.has(panel.id)) {
          log.debug('[SPLIT:Container] sync: removing panel', { paneId: panel.id });
          api.removePanel(panel);
        }
      }
    }, [paneIdsString, pendingSplit]); // Only run when pane IDs or pendingSplit changes

    // Listen for panel focus events
    useEffect(() => {
      const api = apiRef.current;
      if (!api) return;

      const disposable = api.onDidActivePanelChange((panel) => {
        if (panel && onPaneFocus) {
          onPaneFocus(panel.id);
        }
      });

      return () => disposable.dispose();
    }, [onPaneFocus]);

    // Update panel content when activePaneId or renderPane changes
    // This ensures panels re-render when terminal config changes (e.g., font)
    useEffect(() => {
      const api = apiRef.current;
      if (!api) return;

      const currentPanes = panesRef.current;

      // Update all panels with new content
      for (const panel of api.panels) {
        const paneConfig = currentPanes.get(panel.id);
        if (paneConfig) {
          panel.update({
            params: {
              paneId: panel.id,
              content: renderPane(panel.id, paneConfig, panel.id === activePaneId),
            },
          });
        }
      }
    }, [activePaneId, renderPane]);

    // Handle pending focus direction from context
    useEffect(() => {
      if (!pendingFocusDirection) return;

      const api = apiRef.current;
      const currentActivePaneId = activePaneIdRef.current;
      if (!api || !currentActivePaneId) {
        onPendingFocusDirectionConsumedRef.current?.();
        return;
      }

      const panels = api.panels;
      if (panels.length <= 1) {
        onPendingFocusDirectionConsumedRef.current?.();
        return;
      }

      // Get current pane's DOM element and bounds
      const currentElement = document.querySelector(`[data-terminal-id="${currentActivePaneId}"]`);
      if (!currentElement) {
        onPendingFocusDirectionConsumedRef.current?.();
        return;
      }
      const currentRect = currentElement.getBoundingClientRect();

      // Find the best candidate panel in the requested direction
      // Algorithm: prioritize panels that have overlap in the perpendicular axis
      let bestPanel: typeof panels[0] | null = null;
      let bestScore = -Infinity;

      for (const panel of panels) {
        if (panel.id === currentActivePaneId) continue;

        const element = document.querySelector(`[data-terminal-id="${panel.id}"]`);
        if (!element) continue;

        const rect = element.getBoundingClientRect();

        // Calculate overlap in perpendicular axis
        const horizontalOverlap = Math.max(0,
          Math.min(currentRect.right, rect.right) - Math.max(currentRect.left, rect.left)
        );
        const verticalOverlap = Math.max(0,
          Math.min(currentRect.bottom, rect.bottom) - Math.max(currentRect.top, rect.top)
        );

        let isValidCandidate = false;
        let score = 0;

        switch (pendingFocusDirection) {
          case 'left':
            // Panel's right edge must be to the left of (or at) current panel's left edge
            if (rect.right <= currentRect.left + 1) {
              isValidCandidate = true;
              // Prefer panels with vertical overlap, then by horizontal proximity
              const proximity = currentRect.left - rect.right;
              score = verticalOverlap * 1000 - proximity;
            }
            break;
          case 'right':
            // Panel's left edge must be to the right of (or at) current panel's right edge
            if (rect.left >= currentRect.right - 1) {
              isValidCandidate = true;
              const proximity = rect.left - currentRect.right;
              score = verticalOverlap * 1000 - proximity;
            }
            break;
          case 'up':
            // Panel's bottom edge must be above (or at) current panel's top edge
            if (rect.bottom <= currentRect.top + 1) {
              isValidCandidate = true;
              const proximity = currentRect.top - rect.bottom;
              score = horizontalOverlap * 1000 - proximity;
            }
            break;
          case 'down':
            // Panel's top edge must be below (or at) current panel's bottom edge
            if (rect.top >= currentRect.bottom - 1) {
              isValidCandidate = true;
              const proximity = rect.top - currentRect.bottom;
              score = horizontalOverlap * 1000 - proximity;
            }
            break;
        }

        if (isValidCandidate && score > bestScore) {
          bestScore = score;
          bestPanel = panel;
        }
      }

      if (bestPanel) {
        bestPanel.focus();
        onPaneFocus?.(bestPanel.id);
        // Focus the terminal textarea directly
        requestAnimationFrame(() => {
          const textarea = document.querySelector(
            `[data-terminal-id="${bestPanel!.id}"] textarea.xterm-helper-textarea`
          ) as HTMLTextAreaElement | null;
          if (textarea) {
            textarea.focus();
          }
        });
      }

      onPendingFocusDirectionConsumedRef.current?.();
    }, [pendingFocusDirection, onPaneFocus]);

    // Expose imperative handle for split operations
    useImperativeHandle(ref, () => ({
      split: (_orientation: SplitOrientation): string | null => {
        console.warn('[SplitContainer] Imperative split() is deprecated - use useSplitLayout.split() instead');
        return null;
      },

      focusDirection: (direction: SplitDirection): void => {
        const api = apiRef.current;
        const currentActivePaneId = activePaneIdRef.current;
        if (!api || !currentActivePaneId) return;

        const activePanel = api.getPanel(currentActivePaneId);
        if (!activePanel) return;

        const panels = api.panels;
        if (panels.length <= 1) return;

        const currentIndex = panels.findIndex((p) => p.id === currentActivePaneId);
        if (currentIndex === -1) return;

        let targetIndex: number;
        switch (direction) {
          case 'left':
          case 'up':
            targetIndex = (currentIndex - 1 + panels.length) % panels.length;
            break;
          case 'right':
          case 'down':
            targetIndex = (currentIndex + 1) % panels.length;
            break;
        }

        const targetPanel = panels[targetIndex];
        if (targetPanel) {
          targetPanel.focus();
          onPaneFocus?.(targetPanel.id);
        }
      },

      getApi: () => apiRef.current,
    }), [onPaneFocus]);

    return (
      <div className="w-full h-full" style={{ position: 'absolute', inset: 0 }}>
        <GridviewReact
          components={components}
          onReady={handleReady}
          orientation={Orientation.HORIZONTAL}
          className="dockview-theme-dark"
          proportionalLayout={true}
          disableAutoResizing={false}
        />
      </div>
    );
  }
);

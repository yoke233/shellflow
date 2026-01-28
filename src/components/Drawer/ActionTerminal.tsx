import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { TerminalConfig } from '../../hooks/useConfig';
import { useTerminalFontSync } from '../../hooks/useTerminalFontSync';
import { useDrawerXtermTheme } from '../../theme';
import { attachKeyboardHandlers, createTerminalCopyPaste, loadWebGLWithRecovery } from '../../lib/terminal';
import { registerActiveTerminal, unregisterActiveTerminal } from '../../lib/terminalRegistry';
import { spawnAction, ptyWrite, ptyResize, ptyKill, watchMergeState, stopMergeWatcher, watchRebaseState, stopRebaseWatcher, cleanupWorktree, MergeOptions, MergeStrategy } from '../../lib/tauri';
import '@xterm/xterm/css/xterm.css';

// Fix for xterm.js not handling 5-part colon-separated RGB sequences.
function fixColorSequences(data: string): string {
  return data.replace(/([34]8:2):(\d+):(\d+):(\d+)(?!:\d)/g, '$1::$2:$3:$4');
}

// Debounce helper with cancel support
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T & { cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  const debounced = ((...args: unknown[]) => {
    if (timeout) clearTimeout(timeout);
    timeout = setTimeout(() => {
      timeout = null;
      fn(...args);
    }, ms);
  }) as T & { cancel: () => void };
  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
  };
  return debounced;
}

interface PtyOutput {
  pty_id: string;
  data: string;
}

interface ActionTerminalProps {
  id: string;
  worktreeId: string;
  actionType?: string;
  actionPrompt: string;
  isActive: boolean;
  shouldAutoFocus: boolean;
  terminalConfig: TerminalConfig;
  /** Initial merge options from the modal (for merge actions) */
  mergeOptions?: MergeOptions;
  /** The strategy being used (merge or rebase) */
  strategy?: MergeStrategy;
  onPtyIdReady?: (ptyId: string) => void;
  onActionExit?: (exitCode: number) => void;
  onFocus?: () => void;
}

export function ActionTerminal({
  id,
  worktreeId,
  actionType,
  actionPrompt,
  isActive,
  shouldAutoFocus,
  terminalConfig,
  mergeOptions: initialMergeOptions,
  strategy,
  onPtyIdReady,
  onActionExit,
  onFocus,
}: ActionTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const ptyIdRef = useRef<string | null>(null);
  const [isPtyReady, setIsPtyReady] = useState(false);
  const [isMergeComplete, setIsMergeComplete] = useState(false);

  // Get theme from context
  const xtermTheme = useDrawerXtermTheme();

  // Editable merge options (initialized from props)
  const [deleteWorktree, setDeleteWorktree] = useState(initialMergeOptions?.deleteWorktree ?? false);
  const [deleteLocalBranch, setDeleteLocalBranch] = useState(initialMergeOptions?.deleteLocalBranch ?? false);
  const [deleteRemoteBranch, setDeleteRemoteBranch] = useState(initialMergeOptions?.deleteRemoteBranch ?? false);

  useTerminalFontSync(terminalRef, fitAddonRef, terminalConfig);

  // Store callbacks in refs
  const onFocusRef = useRef(onFocus);
  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  const onActionExitRef = useRef(onActionExit);
  useEffect(() => {
    onActionExitRef.current = onActionExit;
  }, [onActionExit]);

  const onPtyIdReadyRef = useRef(onPtyIdReady);
  useEffect(() => {
    onPtyIdReadyRef.current = onPtyIdReady;
  }, [onPtyIdReady]);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    let isMounted = true;
    let unlistenOutput: (() => void) | null = null;
    let unlistenExit: (() => void) | null = null;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: terminalConfig.fontSize,
      fontFamily: terminalConfig.fontFamily,
      linkHandler: {
        activate: (event, uri) => {
          if (event.metaKey) {
            openUrl(uri).catch(console.error);
          }
        },
      },
      theme: xtermTheme,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (event.metaKey) {
        openUrl(uri).catch(console.error);
      }
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    terminal.open(containerRef.current);

    // Load WebGL addon with automatic recovery from context loss
    const webglCleanup = loadWebGLWithRecovery(terminal);

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Write function for keyboard handlers
    const writeToPty = (data: string) => {
      if (ptyIdRef.current) {
        ptyWrite(ptyIdRef.current, data);
      }
    };

    // Attach custom keyboard handlers (Shift+Enter for newline)
    const cleanupKeyboardHandlers = attachKeyboardHandlers(terminal, writeToPty);

    // Create copy/paste functions for the terminal registry
    const copyPasteFns = createTerminalCopyPaste(terminal, writeToPty);

    // Register with terminal registry on focus, unregister on blur
    const handleTerminalFocus = () => {
      registerActiveTerminal(copyPasteFns);
    };
    const handleTerminalBlur = () => {
      unregisterActiveTerminal(copyPasteFns);
    };
    terminal.textarea?.addEventListener('focus', handleTerminalFocus);
    terminal.textarea?.addEventListener('blur', handleTerminalBlur);

    // Attach onData handler
    const onDataDisposable = terminal.onData((data) => {
      if (ptyIdRef.current) {
        ptyWrite(ptyIdRef.current, data);
      }
    });

    // Report focus changes to parent
    const handleFocus = () => {
      onFocusRef.current?.();
    };
    containerRef.current.addEventListener('focusin', handleFocus);

    // Spawn the main command and send prompt when ready
    const initAction = async () => {
      await new Promise((resolve) => requestAnimationFrame(resolve));
      if (!isMounted) return;

      fitAddon.fit();
      const cols = terminal.cols;
      const rows = terminal.rows;

      // Buffer for early events before we know the ptyId
      const earlyEvents: PtyOutput[] = [];
      let ptyIdKnown = false;

      // Set up output listener before spawning - buffer events until ptyId is known
      const outputListener = await listen<PtyOutput>('pty-output', (event) => {
        if (!ptyIdKnown) {
          earlyEvents.push(event.payload);
        } else if (event.payload.pty_id === ptyIdRef.current) {
          terminal.write(fixColorSequences(event.payload.data));
        }
      });
      unlistenOutput = outputListener;

      // Set up exit listener
      const exitListener = await listen<{ ptyId: string; exitCode: number }>(
        'pty-exit',
        (event) => {
          if (event.payload.ptyId === ptyIdRef.current) {
            const code = event.payload.exitCode;
            const color = code === 0 ? '32' : code >= 128 ? '90' : '31';
            terminal.writeln(`\r\n\x1b[${color}m[Process exited with code ${code}]\x1b[0m`);
            onActionExitRef.current?.(event.payload.exitCode);
          }
        }
      );
      unlistenExit = exitListener;

      // Spawn action command with the action prompt
      const newPtyId = await spawnAction(worktreeId, actionPrompt, cols, rows);
      ptyIdRef.current = newPtyId;
      ptyIdKnown = true;
      setIsPtyReady(true);

      // Report ptyId to parent
      onPtyIdReadyRef.current?.(newPtyId);

      // Replay buffered events that match our ptyId
      for (const event of earlyEvents) {
        if (event.pty_id === newPtyId) {
          terminal.write(fixColorSequences(event.data));
        }
      }

      // Resize to proper dimensions
      ptyResize(newPtyId, cols, rows);

      if (!isMounted) {
        ptyKill(newPtyId);
      }
    };

    initAction().catch((err) => {
      console.error('[ActionTerminal] initAction error:', err);
      terminal.writeln(`\x1b[31mError: ${err}\x1b[0m`);
    });

    return () => {
      isMounted = false;
      onDataDisposable.dispose();
      cleanupKeyboardHandlers();
      webglCleanup();
      containerRef.current?.removeEventListener('focusin', handleFocus);
      terminal.textarea?.removeEventListener('focus', handleTerminalFocus);
      terminal.textarea?.removeEventListener('blur', handleTerminalBlur);
      unregisterActiveTerminal(copyPasteFns);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      initializedRef.current = false;
      unlistenOutput?.();
      unlistenExit?.();
      if (ptyIdRef.current) {
        ptyKill(ptyIdRef.current);
        ptyIdRef.current = null;
      }
    };
  }, [id, worktreeId, actionPrompt]);

  // Listen for signal notifications
  useEffect(() => {
    const handleSignal = (e: Event) => {
      const { ptyId, signal } = (e as CustomEvent).detail;
      if (ptyId === ptyIdRef.current && terminalRef.current) {
        terminalRef.current.writeln(`\r\n\x1b[90m[Sending ${signal}...]\x1b[0m`);
      }
    };

    window.addEventListener('pty-signal', handleSignal);
    return () => window.removeEventListener('pty-signal', handleSignal);
  }, []);

  // Watch for merge/rebase completion when this is a conflict resolution action
  useEffect(() => {
    const isMergeAction = actionType === 'merge_worktree_with_conflicts';
    const isRebaseAction = actionType === 'rebase_worktree_with_conflicts';

    if (!isMergeAction && !isRebaseAction) return;

    let unlisten: (() => void) | null = null;

    const startWatching = async () => {
      if (isMergeAction) {
        // Start watching for MERGE_HEAD deletion
        await watchMergeState(worktreeId);
        // Listen for merge-complete event
        unlisten = await listen<{ worktreeId: string }>('merge-complete', (event) => {
          if (event.payload.worktreeId === worktreeId) {
            setIsMergeComplete(true);
          }
        });
      } else if (isRebaseAction) {
        // Start watching for rebase-merge/rebase-apply directory deletion
        await watchRebaseState(worktreeId);
        // Listen for rebase-complete event
        unlisten = await listen<{ worktreeId: string }>('rebase-complete', (event) => {
          if (event.payload.worktreeId === worktreeId) {
            setIsMergeComplete(true);
          }
        });
      }
    };

    startWatching().catch(console.error);

    return () => {
      unlisten?.();
      if (isMergeAction) {
        stopMergeWatcher(worktreeId);
      } else if (isRebaseAction) {
        stopRebaseWatcher(worktreeId);
      }
    };
  }, [actionType, worktreeId]);

  // Immediate resize handler
  const immediateResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || !ptyIdRef.current) return;

    // Cancel any pending debounced resize since we're handling it now
    debouncedResizeRef.current?.cancel();

    // Check if dimensions would actually change before doing expensive reflow
    const proposed = fitAddon.proposeDimensions();
    if (!proposed || (proposed.cols === terminal.cols && proposed.rows === terminal.rows)) {
      return; // No change needed
    }

    fitAddon.fit();
    ptyResize(ptyIdRef.current, terminal.cols, terminal.rows);
  }, []);

  // Debounced resize handler
  // Store in ref so immediateResize can cancel it
  const debouncedResizeRef = useRef<ReturnType<typeof debounce> | null>(null);
  const debouncedResize = useMemo(() => {
    const fn = debounce(immediateResize, 100);
    debouncedResizeRef.current = fn;
    return fn;
  }, [immediateResize]);

  // ResizeObserver for container size changes
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !isPtyReady || !isActive) return;

    const resizeObserver = new ResizeObserver(() => {
      debouncedResize();
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [isActive, isPtyReady, debouncedResize]);

  // Show overlay during panel resize to hide stretched terminal
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!isPtyReady || !isActive) return;

    const handleStart = () => setIsResizing(true);
    const handleComplete = () => {
      immediateResize();
      setTimeout(() => setIsResizing(false), 50);
    };

    window.addEventListener('panel-resize-start', handleStart);
    window.addEventListener('panel-resize-complete', handleComplete);
    return () => {
      window.removeEventListener('panel-resize-start', handleStart);
      window.removeEventListener('panel-resize-complete', handleComplete);
    };
  }, [isActive, isPtyReady, immediateResize]);

  // Fit on active change
  useEffect(() => {
    if (isActive && isPtyReady) {
      const timeout = setTimeout(immediateResize, 50);
      return () => clearTimeout(timeout);
    }
  }, [isActive, isPtyReady, immediateResize]);

  // Focus terminal when shouldAutoFocus is true
  useEffect(() => {
    if (shouldAutoFocus && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [shouldAutoFocus]);

  // Handle completion with cleanup
  const handleComplete = useCallback(() => {
    cleanupWorktree(worktreeId, {
      deleteWorktree,
      deleteLocalBranch,
      deleteRemoteBranch,
    });
    // onMergeComplete is called by the merge-completed event listener in App.tsx
  }, [worktreeId, deleteWorktree, deleteLocalBranch, deleteRemoteBranch]);

  // Keyboard shortcut for Cmd+Enter to complete when banner is showing
  // Use capture phase to handle before terminal intercepts the event
  useEffect(() => {
    if (!isMergeComplete || !isActive) return;

    const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Enter' && (isMac ? e.metaKey : e.ctrlKey)) {
        e.preventDefault();
        e.stopPropagation();
        handleComplete();
      }
    };

    document.addEventListener('keydown', handleKeyDown, true);
    return () => document.removeEventListener('keydown', handleKeyDown, true);
  }, [isMergeComplete, isActive, handleComplete]);

  // Update terminal theme when it changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  return (
    <div className="relative w-full h-full flex flex-col" style={{ backgroundColor: xtermTheme.background, padding: terminalConfig.padding, contain: 'strict' }}>
      <div ref={containerRef} className="w-full flex-1 min-h-0" />
      {isResizing && (
        <div className="absolute inset-0 z-50" style={{ backgroundColor: xtermTheme.background }} />
      )}
      {isMergeComplete && (
        <div
          className="px-3 py-2 bg-green-900/30 border-t border-green-700/50 text-sm"
          style={{ margin: `0 -${terminalConfig.padding}px -${terminalConfig.padding}px -${terminalConfig.padding}px` }}
        >
          <div className="flex items-center justify-between gap-3 mb-2">
            <span className="text-green-300 font-medium">
              {strategy === 'rebase' ? 'Rebase complete!' : 'Merge complete!'}
            </span>
            <button
              onClick={handleComplete}
              className="px-3 py-1 bg-green-600 hover:bg-green-500 text-white rounded text-sm font-medium"
            >
              Complete
            </button>
          </div>
          <div className="flex flex-wrap gap-4 text-theme-1">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteWorktree}
                onChange={(e) => setDeleteWorktree(e.target.checked)}
                className="rounded border-theme-1 bg-theme-2 text-green-500 focus:ring-green-500 focus:ring-offset-theme-1"
              />
              Delete worktree
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteLocalBranch}
                onChange={(e) => setDeleteLocalBranch(e.target.checked)}
                className="rounded border-theme-1 bg-theme-2 text-green-500 focus:ring-green-500 focus:ring-offset-theme-1"
              />
              Delete local branch
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteRemoteBranch}
                onChange={(e) => setDeleteRemoteBranch(e.target.checked)}
                className="rounded border-theme-1 bg-theme-2 text-green-500 focus:ring-green-500 focus:ring-offset-theme-1"
              />
              Delete remote branch
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

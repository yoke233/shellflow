import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { TerminalConfig, MappingsConfig } from '../../hooks/useConfig';
import { useTerminalFontSync } from '../../hooks/useTerminalFontSync';
import { attachKeyboardHandlers } from '../../lib/terminal';
import { spawnAction, ptyWrite, ptyResize, ptyKill, watchMergeState, stopMergeWatcher, watchRebaseState, stopRebaseWatcher, cleanupWorktree, MergeOptions, MergeStrategy } from '../../lib/tauri';
import '@xterm/xterm/css/xterm.css';

// Fix for xterm.js not handling 5-part colon-separated RGB sequences.
function fixColorSequences(data: string): string {
  return data.replace(/([34]8:2):(\d+):(\d+):(\d+)(?!:\d)/g, '$1::$2:$3:$4');
}

// Debounce helper
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T {
  let timeout: ReturnType<typeof setTimeout>;
  return ((...args: unknown[]) => {
    clearTimeout(timeout);
    timeout = setTimeout(() => fn(...args), ms);
  }) as T;
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
  mappings: MappingsConfig;
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
  mappings,
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
      theme: {
        background: '#18181b',
        foreground: '#fafafa',
        cursor: '#fafafa',
        cursorAccent: '#18181b',
        selectionBackground: '#3f3f46',
        black: '#18181b',
        red: '#ef4444',
        green: '#22c55e',
        yellow: '#eab308',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#f4f4f5',
        brightBlack: '#52525b',
        brightRed: '#f87171',
        brightGreen: '#4ade80',
        brightYellow: '#facc15',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
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

    // Load WebGL addon for GPU-accelerated rendering
    try {
      const webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        webglAddon.dispose();
      });
      terminal.loadAddon(webglAddon);
    } catch (e) {
      console.warn('WebGL addon failed to load, using canvas renderer:', e);
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Attach custom keyboard handlers
    attachKeyboardHandlers(
      terminal,
      (data) => {
        if (ptyIdRef.current) {
          ptyWrite(ptyIdRef.current, data);
        }
      },
      {
        copy: mappings.terminalCopy,
        paste: mappings.terminalPaste,
      }
    );

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
      containerRef.current?.removeEventListener('focusin', handleFocus);
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

    fitAddon.fit();
    ptyResize(ptyIdRef.current, terminal.cols, terminal.rows);
  }, []);

  // Debounced resize handler
  const debouncedResize = useMemo(
    () => debounce(immediateResize, 100),
    [immediateResize]
  );

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

  // Listen for panel toggle completion
  useEffect(() => {
    if (!isPtyReady || !isActive) return;

    const handlePanelResizeComplete = () => {
      immediateResize();
    };

    window.addEventListener('panel-resize-complete', handlePanelResizeComplete);
    return () =>
      window.removeEventListener('panel-resize-complete', handlePanelResizeComplete);
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

  return (
    <div className="w-full h-full flex flex-col" style={{ backgroundColor: '#18181b', padding: terminalConfig.padding }}>
      <div ref={containerRef} className="w-full flex-1 min-h-0" />
      {isMergeComplete && (
        <div className="px-3 py-2 bg-green-900/30 border-t border-green-700/50 text-sm">
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
          <div className="flex flex-wrap gap-4 text-zinc-300">
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteWorktree}
                onChange={(e) => setDeleteWorktree(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-800 text-green-500 focus:ring-green-500 focus:ring-offset-zinc-900"
              />
              Delete worktree
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteLocalBranch}
                onChange={(e) => setDeleteLocalBranch(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-800 text-green-500 focus:ring-green-500 focus:ring-offset-zinc-900"
              />
              Delete local branch
            </label>
            <label className="flex items-center gap-1.5 cursor-pointer">
              <input
                type="checkbox"
                checked={deleteRemoteBranch}
                onChange={(e) => setDeleteRemoteBranch(e.target.checked)}
                className="rounded border-zinc-600 bg-zinc-800 text-green-500 focus:ring-green-500 focus:ring-offset-zinc-900"
              />
              Delete remote branch
            </label>
          </div>
        </div>
      )}
    </div>
  );
}

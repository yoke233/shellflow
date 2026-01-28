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
import { spawnTask, ptyWrite, ptyResize, ptyKill } from '../../lib/tauri';
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

interface TaskTerminalProps {
  id: string;
  entityId: string;
  taskName: string;
  isActive: boolean;
  shouldAutoFocus: boolean;
  terminalConfig: TerminalConfig;
  onPtyIdReady?: (ptyId: string) => void;
  onTaskExit?: (exitCode: number) => void;
  onFocus?: () => void;
}

export function TaskTerminal({
  id,
  entityId,
  taskName,
  isActive,
  shouldAutoFocus,
  terminalConfig,
  onPtyIdReady,
  onTaskExit,
  onFocus,
}: TaskTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const ptyIdRef = useRef<string | null>(null);

  // Get theme from context
  const xtermTheme = useDrawerXtermTheme();
  const [isPtyReady, setIsPtyReady] = useState(false);

  useTerminalFontSync(terminalRef, fitAddonRef, terminalConfig);

  // Store onFocus in ref for use in terminal events
  const onFocusRef = useRef(onFocus);
  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  // Store onTaskExit in ref
  const onTaskExitRef = useRef(onTaskExit);
  useEffect(() => {
    onTaskExitRef.current = onTaskExit;
  }, [onTaskExit]);

  // Store onPtyIdReady in ref
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

    // Spawn task
    const initTask = async () => {
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
            // Show exit code in terminal
            const code = event.payload.exitCode;
            // green for 0, grey for signal (128+), red for error (1-127)
            const color = code === 0 ? '32' : code >= 128 ? '90' : '31';
            terminal.writeln(`\r\n\x1b[${color}m[Process exited with code ${code}]\x1b[0m`);
            onTaskExitRef.current?.(event.payload.exitCode);
          }
        }
      );
      unlistenExit = exitListener;

      // Spawn the task
      const newPtyId = await spawnTask(entityId, taskName, cols, rows);
      ptyIdRef.current = newPtyId;
      ptyIdKnown = true;
      setIsPtyReady(true);

      // Report ptyId to parent so it can stop the task
      onPtyIdReadyRef.current?.(newPtyId);

      // Replay buffered events that match our ptyId
      for (const event of earlyEvents) {
        if (event.pty_id === newPtyId) {
          terminal.write(fixColorSequences(event.data));
        }
      }

      if (!isMounted) {
        ptyKill(newPtyId);
      }
    };

    initTask().catch((err) => {
      console.error('[TaskTerminal] initTask error:', err);
      // Show error in terminal
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
  }, [id, entityId, taskName]);

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
  }, [isPtyReady, isActive, debouncedResize]);

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
  }, [isPtyReady, isActive, immediateResize]);

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

  // Update terminal theme when it changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  return (
    <div className="relative w-full h-full" style={{ backgroundColor: xtermTheme.background, padding: terminalConfig.padding, contain: 'strict' }}>
      <div ref={containerRef} className="w-full h-full" />
      {isResizing && (
        <div className="absolute inset-0 z-50" style={{ backgroundColor: xtermTheme.background }} />
      )}
    </div>
  );
}

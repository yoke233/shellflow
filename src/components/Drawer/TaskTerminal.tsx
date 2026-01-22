import { useEffect, useRef, useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { TerminalConfig, MappingsConfig } from '../../hooks/useConfig';
import { useTerminalFontSync } from '../../hooks/useTerminalFontSync';
import { attachKeyboardHandlers } from '../../lib/terminal';
import { spawnTask, ptyWrite, ptyResize, ptyKill } from '../../lib/tauri';
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

interface TaskTerminalProps {
  id: string;
  entityId: string;
  taskName: string;
  isActive: boolean;
  shouldAutoFocus: boolean;
  terminalConfig: TerminalConfig;
  mappings: MappingsConfig;
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
  mappings,
  onPtyIdReady,
  onTaskExit,
  onFocus,
}: TaskTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const ptyIdRef = useRef<string | null>(null);

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
            onTaskExitRef.current?.(event.payload.exitCode);
          }
        }
      );
      unlistenExit = exitListener;

      // Spawn the task
      const newPtyId = await spawnTask(entityId, taskName, cols, rows);
      ptyIdRef.current = newPtyId;
      ptyIdKnown = true;

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
  }, [id, entityId, taskName]);

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
    if (!container || !ptyIdRef.current || !isActive) return;

    const resizeObserver = new ResizeObserver(() => {
      debouncedResize();
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [isActive, debouncedResize]);

  // Listen for panel toggle completion
  useEffect(() => {
    if (!ptyIdRef.current || !isActive) return;

    const handlePanelResizeComplete = () => {
      immediateResize();
    };

    window.addEventListener('panel-resize-complete', handlePanelResizeComplete);
    return () =>
      window.removeEventListener('panel-resize-complete', handlePanelResizeComplete);
  }, [isActive, immediateResize]);

  // Fit on active change
  useEffect(() => {
    if (isActive && ptyIdRef.current) {
      const timeout = setTimeout(immediateResize, 50);
      return () => clearTimeout(timeout);
    }
  }, [isActive, immediateResize]);

  // Focus terminal when shouldAutoFocus is true
  useEffect(() => {
    if (shouldAutoFocus && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [shouldAutoFocus]);

  return (
    <div className="w-full h-full p-2" style={{ backgroundColor: '#18181b' }}>
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
}

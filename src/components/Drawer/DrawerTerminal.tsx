import { useEffect, useRef, useCallback, useMemo } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { listen } from '@tauri-apps/api/event';
import { usePty } from '../../hooks/usePty';
import { TerminalConfig } from '../../hooks/useConfig';
import { useTerminalFontSync } from '../../hooks/useTerminalFontSync';
import '@xterm/xterm/css/xterm.css';

// Fix for xterm.js not handling 5-part colon-separated RGB sequences.
// Neovim sends 38:2:R:G:B but xterm.js expects 38:2:CS:R:G:B (with colorspace).
// This adds an empty colorspace to fix the parsing.
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

interface DrawerTerminalProps {
  id: string;
  worktreeId: string;
  isActive: boolean;
  shouldAutoFocus: boolean;
  terminalConfig: TerminalConfig;
  onClose?: () => void;
  onFocus?: () => void;
}

export function DrawerTerminal({ id, worktreeId, isActive, shouldAutoFocus, terminalConfig, onClose, onFocus }: DrawerTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);

  useTerminalFontSync(terminalRef, fitAddonRef, terminalConfig);

  // Handle PTY output by writing directly to terminal
  const handleOutput = useCallback((data: string) => {
    if (terminalRef.current) {
      terminalRef.current.write(fixColorSequences(data));
    }
  }, []);

  const { ptyId, spawn, write, resize, kill } = usePty(handleOutput);

  // Store spawn/kill in refs so they're stable for the effect
  const spawnRef = useRef(spawn);
  const killRef = useRef(kill);
  useEffect(() => {
    spawnRef.current = spawn;
    killRef.current = kill;
  }, [spawn, kill]);

  // Store write function in ref so onData handler can use it immediately
  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  }, [write]);

  // Store onFocus in ref for use in terminal events
  const onFocusRef = useRef(onFocus);
  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    // Track if component is still mounted (for StrictMode double-mount handling)
    let isMounted = true;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: terminalConfig.fontSize,
      fontFamily: terminalConfig.fontFamily,
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
    terminal.loadAddon(fitAddon);
    terminal.open(containerRef.current);

    // Load ligatures addon if enabled (incompatible with WebGL)
    if (terminalConfig.fontLigatures) {
      try {
        const ligaturesAddon = new LigaturesAddon();
        terminal.loadAddon(ligaturesAddon);
      } catch (e) {
        console.warn('Ligatures addon failed to load:', e);
      }
    } else {
      // Load WebGL addon for GPU-accelerated rendering (only when ligatures disabled)
      try {
        const webglAddon = new WebglAddon();
        webglAddon.onContextLoss(() => {
          webglAddon.dispose();
        });
        terminal.loadAddon(webglAddon);
      } catch (e) {
        console.warn('WebGL addon failed to load, using canvas renderer:', e);
      }
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Attach onData handler immediately
    const onDataDisposable = terminal.onData((data) => {
      writeRef.current(data);
    });

    // Report focus changes to parent via DOM events on container
    const handleFocus = () => {
      onFocusRef.current?.();
    };
    containerRef.current.addEventListener('focusin', handleFocus);

    // Fit terminal and spawn shell
    const initPty = async () => {
      // Wait for next frame to ensure container is laid out
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (!isMounted) return; // Component unmounted during wait

      fitAddon.fit();
      const cols = terminal.cols;
      const rows = terminal.rows;
      await spawnRef.current(worktreeId, 'shell', cols, rows);

      // If component unmounted while spawning, kill the PTY immediately
      if (!isMounted) {
        killRef.current();
      }
    };

    initPty().catch(console.error);

    return () => {
      isMounted = false;
      onDataDisposable.dispose();
      containerRef.current?.removeEventListener('focusin', handleFocus);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      initializedRef.current = false;
      killRef.current();
    };
  }, [id, worktreeId]);

  // Listen for pty-exit event to auto-close the tab
  useEffect(() => {
    if (!ptyId) return;

    const unlisten = listen<{ ptyId: string }>('pty-exit', (event) => {
      if (event.payload.ptyId === ptyId) {
        onClose?.();
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [ptyId, onClose]);

  // Store resize function in ref
  const resizeRef = useRef(resize);
  const ptyIdRef = useRef(ptyId);

  useEffect(() => {
    resizeRef.current = resize;
    ptyIdRef.current = ptyId;
  }, [resize, ptyId]);

  // Immediate resize handler (for panel toggle completion)
  const immediateResize = useCallback(() => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon || !ptyIdRef.current) return;

    fitAddon.fit();
    resizeRef.current(terminal.cols, terminal.rows);
  }, []);

  // Debounced resize handler (for drag operations)
  const debouncedResize = useMemo(
    () => debounce(immediateResize, 100),
    [immediateResize]
  );

  // ResizeObserver for container size changes (debounced for smooth dragging)
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !ptyId || !isActive) return;

    const resizeObserver = new ResizeObserver(() => {
      debouncedResize();
    });

    resizeObserver.observe(container);
    return () => resizeObserver.disconnect();
  }, [ptyId, isActive, debouncedResize]);

  // Listen for panel toggle completion to resize immediately
  useEffect(() => {
    if (!ptyId || !isActive) return;

    const handlePanelResizeComplete = () => {
      immediateResize();
    };

    window.addEventListener('panel-resize-complete', handlePanelResizeComplete);
    return () => window.removeEventListener('panel-resize-complete', handlePanelResizeComplete);
  }, [ptyId, isActive, immediateResize]);

  // Fit on active change
  useEffect(() => {
    if (isActive && ptyId) {
      const timeout = setTimeout(immediateResize, 50);
      return () => clearTimeout(timeout);
    }
  }, [isActive, ptyId, immediateResize]);

  // Focus terminal when shouldAutoFocus is true
  useEffect(() => {
    if (shouldAutoFocus && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [shouldAutoFocus]);

  return (
    <div className="w-full h-full p-2" style={{ backgroundColor: '#18181b' }}>
      <div
        ref={containerRef}
        className="w-full h-full"
      />
    </div>
  );
}

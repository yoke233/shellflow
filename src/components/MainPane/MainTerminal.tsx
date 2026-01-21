import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { listen } from '@tauri-apps/api/event';
import { Loader2, RotateCcw } from 'lucide-react';
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

interface MainTerminalProps {
  worktreeId: string;
  isActive: boolean;
  shouldAutoFocus: boolean;
  terminalConfig: TerminalConfig;
  onFocus?: () => void;
  onNotification?: (title: string, body: string) => void;
  onThinkingChange?: (isThinking: boolean) => void;
}

export function MainTerminal({ worktreeId, isActive, shouldAutoFocus, terminalConfig, onFocus, onNotification, onThinkingChange }: MainTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const spawnedAtRef = useRef<number>(0);
  const [isReady, setIsReady] = useState(false);

  useTerminalFontSync(terminalRef, fitAddonRef, terminalConfig);
  const [hasExited, setHasExited] = useState(false);
  const [exitInfo, setExitInfo] = useState<{ command: string; exitCode: number | null } | null>(null);

  // Handle PTY output by writing directly to terminal
  const handleOutput = useCallback((data: string) => {
    if (terminalRef.current) {
      terminalRef.current.write(fixColorSequences(data));
    }
  }, []);

  const { ptyId, spawn, write, resize, kill } = usePty(handleOutput);

  // Listen for pty-ready event
  useEffect(() => {
    if (!ptyId) return;

    const unlisten = listen<{ ptyId: string; worktreeId: string }>('pty-ready', (event) => {
      if (event.payload.ptyId === ptyId) {
        setIsReady(true);
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [ptyId]);

  // Listen for pty-exit event
  useEffect(() => {
    if (!ptyId) return;

    const unlisten = listen<{ ptyId: string; worktreeId: string; command: string; exitCode: number | null }>('pty-exit', (event) => {
      if (event.payload.ptyId === ptyId) {
        setHasExited(true);
        setExitInfo({ command: event.payload.command, exitCode: event.payload.exitCode });
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [ptyId]);

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

  // Store onNotification in ref so handlers can access the latest version
  const onNotificationRef = useRef(onNotification);
  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  // Store onThinkingChange in ref so handlers can access the latest version
  const onThinkingChangeRef = useRef(onThinkingChange);
  useEffect(() => {
    onThinkingChangeRef.current = onThinkingChange;
  }, [onThinkingChange]);

  // Initialize terminal and spawn PTY
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    let isMounted = true;

    const terminal = new Terminal({
      cursorBlink: true,
      cursorStyle: 'block',
      fontSize: terminalConfig.fontSize,
      fontFamily: terminalConfig.fontFamily,
      allowProposedApi: true,
      theme: {
        background: '#09090b',
        foreground: '#fafafa',
        cursor: '#fafafa',
        cursorAccent: '#09090b',
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
    const webLinksAddon = new WebLinksAddon();

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
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

    // Attach onData handler immediately so terminal query responses work
    const onDataDisposable = terminal.onData((data) => {
      writeRef.current(data);
    });

    // Report focus changes to parent via DOM events on container
    const handleFocus = () => {
      onFocusRef.current?.();
    };
    containerRef.current.addEventListener('focusin', handleFocus);

    // Register notification handlers
    // OSC 777: format is "notify;title;body"
    const osc777Disposable = terminal.parser.registerOscHandler(777, (data) => {
      const parts = data.split(';');
      if (parts[0] === 'notify' && parts.length >= 3) {
        const title = parts[1];
        const body = parts.slice(2).join(';');
        onNotificationRef.current?.(title, body);
      }
      return true;
    });

    // OSC 9: ConEmu-style sequences
    // - OSC 9 ; 4 ; state ; progress - Progress reporting (state: 0=hidden, 1=default, 2=error, 3=indeterminate, 4=warning)
    // - OSC 9 ; text - Notification (just the body)
    const osc9Disposable = terminal.parser.registerOscHandler(9, (data) => {
      // Check for progress reporting: "4;state" or "4;state;progress"
      if (data.startsWith('4;')) {
        const parts = data.split(';');
        const state = parseInt(parts[1], 10);
        // State 0 means hidden/done, anything else means busy/thinking
        const isThinking = state !== 0 && !isNaN(state);
        onThinkingChangeRef.current?.(isThinking);
        return true;
      }
      // Otherwise treat as notification
      onNotificationRef.current?.('', data);
      return true;
    });

    // Bell (BEL character)
    const bellDisposable = terminal.onBell(() => {
      onNotificationRef.current?.('', 'Bell');
    });

    // Claude-specific: detect thinking state from terminal title
    // Claude Code sets title with braille spinner chars (⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏) when thinking
    // Only trigger if: spinner is at start of title, OR title contains "claude" (case-insensitive)
    const SPINNER_CHARS = new Set(['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏']);
    const titleChangeDisposable = terminal.onTitleChange((title) => {
      const startsWithSpinner = SPINNER_CHARS.has(title[0]);
      const hasClaudeWithSpinner = title.toLowerCase().includes('claude') &&
        [...title].some(char => SPINNER_CHARS.has(char));
      onThinkingChangeRef.current?.(startsWithSpinner || hasClaudeWithSpinner);
    });

    // Fit terminal and spawn main process with correct size
    const initPty = async () => {
      // Wait for next frame to ensure container is laid out
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (!isMounted) return;

      fitAddon.fit();
      const cols = terminal.cols;
      const rows = terminal.rows;

      spawnedAtRef.current = Date.now();
      await spawnRef.current(worktreeId, 'main', cols, rows);

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
      osc777Disposable.dispose();
      osc9Disposable.dispose();
      bellDisposable.dispose();
      titleChangeDisposable.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      initializedRef.current = false;
      killRef.current();
    };
  }, [worktreeId]);

  // Restart handler for when the process exits
  const handleRestart = useCallback(async () => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    // Reset state
    setHasExited(false);
    setIsReady(false);
    setExitInfo(null);

    // Clear terminal and show restart message
    terminal.clear();

    // Spawn new PTY with current terminal size
    const cols = terminal.cols;
    const rows = terminal.rows;
    spawnedAtRef.current = Date.now();
    await spawn(worktreeId, 'main', cols, rows);
  }, [spawn, worktreeId]);

  // Store resize function in ref to avoid dependency issues
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
    if (Date.now() - spawnedAtRef.current < 1000) return;

    fitAddon.fit();
    resizeRef.current(terminal.cols, terminal.rows);
  }, []);

  // Debounced resize handler (for drag operations)
  const debouncedResize = useMemo(
    () => debounce(immediateResize, 150),
    [immediateResize]
  );

  // Fit on active change
  useEffect(() => {
    if (isActive && ptyId) {
      const timeout = setTimeout(immediateResize, 50);
      return () => clearTimeout(timeout);
    }
  }, [isActive, ptyId, immediateResize]);

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

  // Focus terminal when shouldAutoFocus is true
  useEffect(() => {
    if (shouldAutoFocus && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [shouldAutoFocus]);

  return (
    <div className="relative w-full h-full p-2" style={{ backgroundColor: '#09090b' }}>
      {!isReady && !hasExited && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-zinc-950">
          <div className="flex flex-col items-center gap-3 text-zinc-400">
            <Loader2 size={32} className="animate-spin" />
            <span className="text-sm">Starting...</span>
          </div>
        </div>
      )}
      {hasExited && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-zinc-950/90">
          <div className="flex flex-col items-center gap-4 text-zinc-400">
            <div className="flex flex-col items-center gap-1">
              <span className="text-zinc-200 font-medium">
                {exitInfo?.command ?? 'Process'} exited
              </span>
              {exitInfo?.exitCode !== null && exitInfo?.exitCode !== undefined && (
                <span className="text-sm">
                  Exit code: {exitInfo.exitCode}
                </span>
              )}
            </div>
            <button
              onClick={handleRestart}
              className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-200 transition-colors"
            >
              <RotateCcw size={16} />
              <span>Restart</span>
            </button>
          </div>
        </div>
      )}
      <div
        ref={containerRef}
        className={`w-full h-full transition-opacity duration-200 ${isReady && !hasExited ? 'opacity-100' : 'opacity-0'}`}
      />
    </div>
  );
}

import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { WebglAddon } from '@xterm/addon-webgl';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Loader2, RotateCcw, Terminal as TerminalIcon } from 'lucide-react';
import { usePty } from '../../hooks/usePty';
import { TerminalConfig, MappingsConfig } from '../../hooks/useConfig';
import { useTerminalFontSync } from '../../hooks/useTerminalFontSync';
import { attachKeyboardHandlers } from '../../lib/terminal';
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
  entityId: string;
  type?: 'main' | 'project';
  isActive: boolean;
  shouldAutoFocus: boolean;
  terminalConfig: TerminalConfig;
  mappings: MappingsConfig;
  activityTimeout?: number;
  onFocus?: () => void;
  onNotification?: (title: string, body: string) => void;
  onThinkingChange?: (isThinking: boolean) => void;
}

export function MainTerminal({ entityId, type = 'main', isActive, shouldAutoFocus, terminalConfig, mappings, activityTimeout = 250, onFocus, onNotification, onThinkingChange }: MainTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const spawnedAtRef = useRef<number>(0);
  const [isReady, setIsReady] = useState(false);

  useTerminalFontSync(terminalRef, fitAddonRef, terminalConfig);
  const [hasExited, setHasExited] = useState(false);
  const [exitInfo, setExitInfo] = useState<{ command: string; exitCode: number | null } | null>(null);

  // Progress indicator state refs (declared early so handleOutput can use them)
  // Only track activity when terminal is NOT active (background tabs only)
  // Two sources: activity-based (output/title with timeout) and OSC-based (explicit start/stop)
  const activityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActivityThinkingRef = useRef(false);
  const isOscThinkingRef = useRef(false);
  const isActiveRef = useRef(isActive);
  const activityTimeoutMsRef = useRef(activityTimeout);
  // Grace period after becoming inactive before tracking starts (prevents false triggers from tab switch events)
  const becameInactiveAtRef = useRef<number | null>(null);
  const INACTIVE_GRACE_PERIOD = 100; // ms

  // Keep refs in sync with props
  useEffect(() => {
    activityTimeoutMsRef.current = activityTimeout;
  }, [activityTimeout]);

  // Keep isActiveRef in sync and clear thinking state when becoming active
  useEffect(() => {
    const wasActive = isActiveRef.current;
    isActiveRef.current = isActive;

    if (isActive) {
      // When becoming active, clear any pending activity state
      // (no need to show indicator for the tab you're looking at)
      becameInactiveAtRef.current = null;
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
        activityTimeoutRef.current = null;
      }
      isActivityThinkingRef.current = false;
      isOscThinkingRef.current = false;
      // Notify parent that thinking stopped
      onThinkingChangeRef.current?.(false);
    } else if (wasActive) {
      // Just became inactive - record timestamp for grace period
      becameInactiveAtRef.current = Date.now();
    }
  }, [isActive]);

  // Unified function to update thinking state based on both sources
  const updateThinkingStateRef = useRef<() => void>(() => {});

  // Function to trigger activity-based thinking (resets timeout)
  const triggerActivityRef = useRef<() => void>(() => {});

  // Handle PTY output by writing directly to terminal
  const handleOutput = useCallback((data: string) => {
    if (terminalRef.current) {
      // Only fix color sequences for main terminals (Claude uses them)
      terminalRef.current.write(type === 'main' ? fixColorSequences(data) : data);

      // Output activity detection only for main terminals when NOT active
      if (type === 'main' && data.length > 0 && !isActiveRef.current) {
        triggerActivityRef.current();
      }
    }
  }, [type]);

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

  // Progress indicator logic:
  // - Activity (output/title): start timer, reset on more activity, turn off when timer expires
  // - OSC 9 progress: explicit start/stop (no timeout)
  // - Final state = activity OR osc
  const wasThinkingRef = useRef(false);

  useEffect(() => {
    // Update the combined thinking state
    updateThinkingStateRef.current = () => {
      const shouldBeThinking = isActivityThinkingRef.current || isOscThinkingRef.current;
      if (shouldBeThinking !== wasThinkingRef.current) {
        wasThinkingRef.current = shouldBeThinking;
        onThinkingChangeRef.current?.(shouldBeThinking);
      }
    };

    // Trigger activity-based thinking (resets timeout)
    triggerActivityRef.current = () => {
      // Skip if within grace period after becoming inactive (prevents false triggers from tab switch)
      if (becameInactiveAtRef.current !== null) {
        const elapsed = Date.now() - becameInactiveAtRef.current;
        if (elapsed < INACTIVE_GRACE_PERIOD) {
          return;
        }
      }

      // Clear existing timeout
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }

      // Turn on activity thinking
      isActivityThinkingRef.current = true;
      updateThinkingStateRef.current();

      // Schedule turn off
      activityTimeoutRef.current = setTimeout(() => {
        activityTimeoutRef.current = null;
        isActivityThinkingRef.current = false;
        updateThinkingStateRef.current();
      }, activityTimeoutMsRef.current);
    };
  }, []);

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
      linkHandler: {
        activate: (event, uri) => {
          if (event.metaKey) {
            openUrl(uri).catch(console.error);
          }
        },
      },
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
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (event.metaKey) {
        openUrl(uri).catch(console.error);
      }
    });

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

    // Attach custom keyboard handlers (copy, paste, Shift+Enter for newline)
    attachKeyboardHandlers(terminal, (data) => writeRef.current(data), {
      copy: mappings.terminalCopy,
      paste: mappings.terminalPaste,
    });

    // Attach onData handler immediately so terminal query responses work
    const onDataDisposable = terminal.onData((data) => {
      writeRef.current(data);
    });

    // Report focus changes to parent via DOM events on container
    const handleFocus = () => {
      onFocusRef.current?.();
    };
    containerRef.current.addEventListener('focusin', handleFocus);

    // Disposables to clean up (only used for main type)
    let osc777Disposable: { dispose: () => void } | null = null;
    let osc9Disposable: { dispose: () => void } | null = null;
    let osc99Disposable: { dispose: () => void } | null = null;
    let bellDisposable: { dispose: () => void } | null = null;
    let titleChangeDisposable: { dispose: () => void } | null = null;

    // Register notification handlers only for main terminals
    if (type === 'main') {
      // OSC 777: format is "notify;title;body"
      osc777Disposable = terminal.parser.registerOscHandler(777, (data) => {
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
      osc9Disposable = terminal.parser.registerOscHandler(9, (data) => {
        // Check for progress reporting: "4;state" or "4;state;progress"
        if (data.startsWith('4;')) {
          // Only track when not active (background tabs only)
          if (isActiveRef.current) return true;
          const parts = data.split(';');
          const state = parseInt(parts[1], 10);
          // State 0 means hidden/done, anything else means busy/thinking
          // OSC progress uses explicit start/stop (no timeout)
          isOscThinkingRef.current = state !== 0 && !isNaN(state);
          updateThinkingStateRef.current();
          return true;
        }
        // Otherwise treat as notification
        onNotificationRef.current?.('', data);
        return true;
      });

      // OSC 99: Kitty notification protocol
      // Format: "i=<id>:d=<done>:p=<progress>:...;<payload>"
      // or just ";<payload>" for simple notifications
      osc99Disposable = terminal.parser.registerOscHandler(99, (data) => {
        // Find the payload after the semicolon
        const semicolonIndex = data.indexOf(';');
        if (semicolonIndex === -1) {
          // No semicolon, treat entire data as payload
          onNotificationRef.current?.('', data);
          return true;
        }

        const params = data.slice(0, semicolonIndex);
        const payload = data.slice(semicolonIndex + 1);

        // Parse parameters (key=value pairs separated by :)
        const paramMap: Record<string, string> = {};
        for (const param of params.split(':')) {
          const eqIndex = param.indexOf('=');
          if (eqIndex !== -1) {
            paramMap[param.slice(0, eqIndex)] = param.slice(eqIndex + 1);
          }
        }

        // 'p' parameter can indicate progress, 'a' can be action type
        // For now, just send the payload as a notification
        // Could extend to support progress via 'p' parameter in the future
        if (payload) {
          onNotificationRef.current?.('', payload);
        }
        return true;
      });

      // Bell (BEL character)
      bellDisposable = terminal.onBell(() => {
        onNotificationRef.current?.('', 'Bell');
      });

      // Any title change triggers activity-based thinking (with timeout)
      // Only track when not active (background tabs only)
      titleChangeDisposable = terminal.onTitleChange(() => {
        if (!isActiveRef.current) {
          triggerActivityRef.current();
        }
      });
    }

    // Fit terminal and spawn process with correct size
    const initPty = async () => {
      // Wait for next frame to ensure container is laid out
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (!isMounted) return;

      fitAddon.fit();
      const cols = terminal.cols;
      const rows = terminal.rows;

      spawnedAtRef.current = Date.now();
      await spawnRef.current(entityId, type, cols, rows);

      // For project type, mark as ready immediately (no startup delay like main command)
      if (type === 'project') {
        setIsReady(true);
      }

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
      osc777Disposable?.dispose();
      osc9Disposable?.dispose();
      osc99Disposable?.dispose();
      bellDisposable?.dispose();
      titleChangeDisposable?.dispose();
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      initializedRef.current = false;
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
      }
      killRef.current();
    };
  }, [entityId, type]);

  // Restart handler for when the process exits
  const handleRestart = useCallback(async () => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    // Reset state
    setHasExited(false);
    setIsReady(false);
    setExitInfo(null);
    isActivityThinkingRef.current = false;
    isOscThinkingRef.current = false;
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
      activityTimeoutRef.current = null;
    }

    // Clear terminal and show restart message
    terminal.clear();

    // Spawn new PTY with current terminal size
    const cols = terminal.cols;
    const rows = terminal.rows;
    spawnedAtRef.current = Date.now();
    await spawn(entityId, type, cols, rows);

    // For project type, mark as ready immediately
    if (type === 'project') {
      setIsReady(true);
    }
  }, [spawn, entityId, type]);

  // Launch shell handler for when the user wants a shell instead of the main command
  const handleLaunchShell = useCallback(async () => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    // Reset state
    setHasExited(false);
    setIsReady(true); // Shell is ready immediately
    setExitInfo(null);
    isActivityThinkingRef.current = false;
    isOscThinkingRef.current = false;
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
      activityTimeoutRef.current = null;
    }

    // Clear terminal
    terminal.clear();

    // Spawn shell with current terminal size
    const cols = terminal.cols;
    const rows = terminal.rows;
    spawnedAtRef.current = Date.now();
    await spawn(entityId, 'shell', cols, rows);
  }, [spawn, entityId]);

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
    <div className="relative w-full h-full" style={{ backgroundColor: '#09090b', padding: terminalConfig.padding }}>
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
                {exitInfo?.command ?? (type === 'project' ? 'Shell' : 'Process')} exited
              </span>
              {exitInfo?.exitCode !== null && exitInfo?.exitCode !== undefined && (
                <span className="text-sm">
                  Exit code: {exitInfo.exitCode}
                </span>
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRestart}
                className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-200 transition-colors"
              >
                <RotateCcw size={16} />
                <span>Restart</span>
              </button>
              {type === 'main' && (
                <button
                  onClick={handleLaunchShell}
                  className="flex items-center gap-2 px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-md text-zinc-200 transition-colors"
                >
                  <TerminalIcon size={16} />
                  <span>Shell</span>
                </button>
              )}
            </div>
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

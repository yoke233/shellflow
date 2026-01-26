import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { Loader2, RotateCcw, Terminal as TerminalIcon } from 'lucide-react';
import { usePty } from '../../hooks/usePty';
import { TerminalConfig } from '../../hooks/useConfig';
import { useTerminalFontSync } from '../../hooks/useTerminalFontSync';
import { useTerminalFileDrop } from '../../hooks/useTerminalFileDrop';
import { attachKeyboardHandlers, createTerminalCopyPaste, loadWebGLWithRecovery } from '../../lib/terminal';
import { registerActiveTerminal, unregisterActiveTerminal } from '../../lib/terminalRegistry';
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
  /** The session ID (worktree/project/scratch) - used for spawn and working directory */
  sessionId?: string;
  type?: 'main' | 'project' | 'scratch';
  isActive: boolean;
  shouldAutoFocus: boolean;
  /** Counter that triggers focus when incremented */
  focusTrigger?: number;
  terminalConfig: TerminalConfig;
  activityTimeout?: number;
  onFocus?: () => void;
  onNotification?: (title: string, body: string) => void;
  onThinkingChange?: (isThinking: boolean) => void;
  onCwdChange?: (cwd: string) => void;
  /** Called when terminal title changes (via OSC escape codes) */
  onTitleChange?: (title: string) => void;
}

export function MainTerminal({ entityId, sessionId, type = 'main', isActive, shouldAutoFocus, focusTrigger, terminalConfig, activityTimeout = 250, onFocus, onNotification, onThinkingChange, onCwdChange, onTitleChange }: MainTerminalProps) {
  // Use sessionId for spawn if provided, otherwise fall back to entityId (for backward compatibility)
  const spawnId = sessionId ?? entityId;
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const spawnedAtRef = useRef<number>(0);
  const [isReady, setIsReady] = useState(false);

  useTerminalFontSync(terminalRef, fitAddonRef, terminalConfig);
  const [hasExited, setHasExited] = useState(false);
  const [exitInfo, setExitInfo] = useState<{ command: string; exitCode: number | null } | null>(null);
  const [currentMode, setCurrentMode] = useState<'main' | 'project' | 'scratch' | 'shell'>(type);

  // File drag-and-drop support - uses stable callback via ref
  const writeForDropRef = useRef<(data: string) => void>(() => {});

  // Progress indicator state refs (declared early so handleOutput can use them)
  // Only track activity when terminal is NOT active (background tabs only)
  // Two sources: activity-based (output/title with timeout) and OSC-based (explicit start/stop)
  const activityTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isActivityThinkingRef = useRef(false);
  const isOscThinkingRef = useRef(false);
  const isActiveRef = useRef(isActive);
  const activityTimeoutMsRef = useRef(activityTimeout);
  // Grace period after becoming inactive before tracking starts (prevents false triggers from tab switch events)
  const gracePeriodTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const activityCountDuringGracePeriodRef = useRef(0);
  const INACTIVE_GRACE_PERIOD = 100; // ms
  const MIN_ACTIVITY_COUNT = 2; // Require multiple events to filter out tab-switch noise

  // Keep refs in sync with props
  useEffect(() => {
    activityTimeoutMsRef.current = activityTimeout;
  }, [activityTimeout]);

  // Keep isActiveRef in sync and clear thinking state when becoming active
  useEffect(() => {
    const wasActive = isActiveRef.current;
    isActiveRef.current = isActive;

    if (isActive) {
      // When becoming active, clear any pending activity-based state
      // (activity indicators are for background tabs only)
      // Note: OSC-based thinking state persists - it only clears on explicit OSC stop
      if (gracePeriodTimeoutRef.current) {
        clearTimeout(gracePeriodTimeoutRef.current);
        gracePeriodTimeoutRef.current = null;
      }
      activityCountDuringGracePeriodRef.current = 0;
      if (activityTimeoutRef.current) {
        clearTimeout(activityTimeoutRef.current);
        activityTimeoutRef.current = null;
      }
      isActivityThinkingRef.current = false;
      // Report current state (OSC thinking may still be active)
      updateThinkingStateRef.current();
    } else if (wasActive) {
      // Just became inactive - start grace period timer
      // If sustained activity occurs during grace period, we'll trigger when it ends
      activityCountDuringGracePeriodRef.current = 0;
      gracePeriodTimeoutRef.current = setTimeout(() => {
        gracePeriodTimeoutRef.current = null;
        // Only trigger if we saw multiple events (filters out single tab-switch noise)
        if (activityCountDuringGracePeriodRef.current >= MIN_ACTIVITY_COUNT) {
          activityCountDuringGracePeriodRef.current = 0;
          triggerActivityRef.current();
        }
      }, INACTIVE_GRACE_PERIOD);
    }
  }, [isActive]);

  // Unified function to update thinking state based on both sources
  const updateThinkingStateRef = useRef<() => void>(() => {});

  // Function to trigger activity-based thinking (resets timeout)
  // bypassGracePeriod: if true, triggers immediately even during grace period (for strong signals like title changes)
  const triggerActivityRef = useRef<(bypassGracePeriod?: boolean) => void>(() => {});

  // Handle PTY output by writing directly to terminal
  const handleOutput = useCallback((data: string) => {
    if (terminalRef.current) {
      // Only fix color sequences for main terminals (Claude uses them)
      terminalRef.current.write(type === 'main' ? fixColorSequences(data) : data);

      // Output activity detection when NOT active (for background tab indicators)
      if (data.length > 0 && !isActiveRef.current) {
        triggerActivityRef.current();
      }
    }
  }, []);

  // Handle pty-ready event - passed to usePty to avoid race condition
  const handleReady = useCallback(() => {
    setIsReady(true);
  }, []);

  const { ptyId, spawn, write, resize, interrupt, kill } = usePty(handleOutput, handleReady);

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
  const interruptRef = useRef(interrupt);
  useEffect(() => {
    writeRef.current = write;
    writeForDropRef.current = write;
    interruptRef.current = interrupt;
  }, [write, interrupt]);

  // Enable file drag-and-drop when terminal is ready, active, and not exited
  const { isDragOver } = useTerminalFileDrop(containerRef, (data) => writeForDropRef.current(data), isActive && isReady && !hasExited);

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

  // Store onCwdChange in ref so handlers can access the latest version
  const onCwdChangeRef = useRef(onCwdChange);
  useEffect(() => {
    onCwdChangeRef.current = onCwdChange;
  }, [onCwdChange]);

  // Store onTitleChange in ref so handlers can access the latest version
  const onTitleChangeRef = useRef(onTitleChange);
  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

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
    // bypassGracePeriod: if true, triggers immediately even during grace period (for strong signals like title changes)
    triggerActivityRef.current = (bypassGracePeriod = false) => {
      // If within grace period, count activity (need multiple events to filter out tab-switch noise)
      // Title changes bypass this because they're a strong signal of real activity
      if (gracePeriodTimeoutRef.current !== null && !bypassGracePeriod) {
        activityCountDuringGracePeriodRef.current++;
        return;
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
    // Store WebGL cleanup function if used
    let webglCleanup: (() => void) | null = null;

    if (terminalConfig.fontLigatures) {
      try {
        const ligaturesAddon = new LigaturesAddon();
        terminal.loadAddon(ligaturesAddon);
      } catch (e) {
        console.warn('Ligatures addon failed to load:', e);
      }
    } else {
      // Load WebGL addon with automatic recovery from context loss
      webglCleanup = loadWebGLWithRecovery(terminal);
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;

    // Attach custom keyboard handlers (Ctrl+C for interrupt, Shift+Enter for newline)
    const cleanupKeyboardHandlers = attachKeyboardHandlers(terminal, (data) => writeRef.current(data), () => interruptRef.current());

    // Create copy/paste functions for the terminal registry
    const copyPasteFns = createTerminalCopyPaste(terminal, (data) => writeRef.current(data));

    // Register with terminal registry on focus, unregister on blur
    const handleTerminalFocus = () => {
      registerActiveTerminal(copyPasteFns);
    };
    const handleTerminalBlur = () => {
      unregisterActiveTerminal(copyPasteFns);
    };
    terminal.textarea?.addEventListener('focus', handleTerminalFocus);
    terminal.textarea?.addEventListener('blur', handleTerminalBlur);

    // Attach onData handler immediately so terminal query responses work
    const onDataDisposable = terminal.onData((data) => {
      writeRef.current(data);
    });

    // Report focus changes to parent via DOM events on container
    const handleFocus = () => {
      onFocusRef.current?.();
    };
    containerRef.current.addEventListener('focusin', handleFocus);

    // Disposables to clean up
    let osc7Disposable: { dispose: () => void } | null = null;
    let osc777Disposable: { dispose: () => void } | null = null;
    let osc9Disposable: { dispose: () => void } | null = null;
    let osc99Disposable: { dispose: () => void } | null = null;
    let bellDisposable: { dispose: () => void } | null = null;
    let titleChangeDisposable: { dispose: () => void } | null = null;

    // OSC 7: Current working directory (works for all terminal types)
    // Format: file://hostname/path or just /path
    osc7Disposable = terminal.parser.registerOscHandler(7, (data) => {
      let path = data;
      // Parse file:// URL format
      if (data.startsWith('file://')) {
        try {
          const url = new URL(data);
          path = decodeURIComponent(url.pathname);
        } catch {
          // If URL parsing fails, try to extract path after hostname
          const match = data.match(/^file:\/\/[^/]*(\/.*)/);
          if (match) {
            path = decodeURIComponent(match[1]);
          }
        }
      }
      if (path && path.startsWith('/')) {
        onCwdChangeRef.current?.(path);
      }
      return true;
    });

    // Register notification and progress handlers for all terminals
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
        const parts = data.split(';');
        const state = parseInt(parts[1], 10);
        // State 0 means hidden/done, anything else means busy/thinking
        // OSC progress uses explicit start/stop (no timeout) and works even when active
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


    // Title change handler - works for all terminal types
    // For main terminals: also triggers activity-based thinking (with timeout)
    // Title changes bypass grace period since they're a strong signal of real activity
    titleChangeDisposable = terminal.onTitleChange((title) => {
      // Notify parent of title change (for tab label updates)
      onTitleChangeRef.current?.(title);

      // For main terminals, also trigger thinking indicator when not active
      if (type === 'main' && !isActiveRef.current) {
        triggerActivityRef.current(true);
      }
    });

    // Fit terminal and spawn process with correct size
    const initPty = async () => {
      // Wait for next frame to ensure container is laid out
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (!isMounted) return;

      fitAddon.fit();
      const cols = terminal.cols;
      const rows = terminal.rows;

      spawnedAtRef.current = Date.now();
      await spawnRef.current(spawnId, type, cols, rows);

      // For project type, mark as ready immediately (no startup delay like main command)
      if (type === 'project' && isMounted) {
        setIsReady(true);
      }
      // NOTE: We do NOT kill the PTY if unmounted during spawn. React may
      // unmount/remount components during StrictMode. Orphaned PTYs are cleaned
      // up when the process exits or app restarts.
    };

    initPty().catch(console.error);

    return () => {
      isMounted = false;
      onDataDisposable.dispose();
      cleanupKeyboardHandlers();
      webglCleanup?.();
      containerRef.current?.removeEventListener('focusin', handleFocus);
      terminal.textarea?.removeEventListener('focus', handleTerminalFocus);
      terminal.textarea?.removeEventListener('blur', handleTerminalBlur);
      unregisterActiveTerminal(copyPasteFns);
      osc7Disposable?.dispose();
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
      // NOTE: We do NOT kill the PTY here. React may unmount/remount components
      // during re-renders, reordering, or StrictMode. PTY cleanup is handled by:
      // 1. The pty-exit event handler (when process exits naturally)
      // 2. App.tsx cleanup when tab is explicitly closed
    };
  }, [entityId, type]);

  // Restart handler for when the process exits - restarts whatever was last running
  const handleRestart = useCallback(async () => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    // Reset state
    setHasExited(false);
    setIsReady(currentMode === 'shell' || currentMode === 'project');
    setExitInfo(null);
    isActivityThinkingRef.current = false;
    isOscThinkingRef.current = false;
    if (activityTimeoutRef.current) {
      clearTimeout(activityTimeoutRef.current);
      activityTimeoutRef.current = null;
    }

    // Clear terminal
    terminal.clear();

    // Spawn new PTY with current terminal size
    const cols = terminal.cols;
    const rows = terminal.rows;
    spawnedAtRef.current = Date.now();
    await spawn(spawnId, currentMode, cols, rows);
  }, [spawn, spawnId, currentMode]);

  // Launch shell handler for when the user wants a shell instead of the main command
  const handleLaunchShell = useCallback(async () => {
    const terminal = terminalRef.current;
    const fitAddon = fitAddonRef.current;
    if (!terminal || !fitAddon) return;

    // Reset state
    setHasExited(false);
    setIsReady(true); // Shell is ready immediately
    setExitInfo(null);
    setCurrentMode('shell');
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
    await spawn(spawnId, 'shell', cols, rows);
  }, [spawn, spawnId]);

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

  // Focus terminal when shouldAutoFocus is true or when focusTrigger changes
  useEffect(() => {
    if (shouldAutoFocus && terminalRef.current) {
      terminalRef.current.focus();
    }
  }, [shouldAutoFocus, focusTrigger]);

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
              {currentMode === 'main' && (
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
      {isDragOver && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-zinc-950/60 pointer-events-none border-2 border-dashed border-zinc-500 rounded">
          <span className="text-zinc-300 text-sm">Drop files to insert path</span>
        </div>
      )}
    </div>
  );
}

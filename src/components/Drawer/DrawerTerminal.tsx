import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { LigaturesAddon } from '@xterm/addon-ligatures';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { usePty } from '../../hooks/usePty';
import { TerminalConfig } from '../../hooks/useConfig';
import { useTerminalFontSync } from '../../hooks/useTerminalFontSync';
import { useDrawerXtermTheme } from '../../theme';
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

interface DrawerTerminalProps {
  id: string;
  entityId: string;
  directory?: string;  // undefined = use home directory
  /** Command to run instead of shell (for editors, etc.) */
  command?: string;
  isActive: boolean;
  shouldAutoFocus: boolean;
  terminalConfig: TerminalConfig;
  onClose?: () => void;
  onFocus?: () => void;
  onPtyIdReady?: (ptyId: string) => void;
  /** Called when terminal title changes (via OSC escape codes) */
  onTitleChange?: (title: string) => void;
}

export function DrawerTerminal({ id, entityId, directory, command, isActive, shouldAutoFocus, terminalConfig, onClose, onFocus, onPtyIdReady, onTitleChange }: DrawerTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);

  // Get theme from context (uses sideBar.background for visual hierarchy)
  const xtermTheme = useDrawerXtermTheme();

  useTerminalFontSync(terminalRef, fitAddonRef, terminalConfig);

  // Handle PTY output by writing directly to terminal
  const handleOutput = useCallback((data: string) => {
    if (terminalRef.current) {
      terminalRef.current.write(fixColorSequences(data));
    }
  }, []);

  const { ptyId, spawnShell, spawnCommand, write, resize, kill } = usePty(handleOutput);

  // Store spawnShell/spawnCommand/kill in refs so they're stable for the effect
  const spawnShellRef = useRef(spawnShell);
  const spawnCommandRef = useRef(spawnCommand);
  const killRef = useRef(kill);
  useEffect(() => {
    spawnShellRef.current = spawnShell;
    spawnCommandRef.current = spawnCommand;
    killRef.current = kill;
  }, [spawnShell, spawnCommand, kill]);

  // Store write function in ref so handlers can use it immediately
  const writeRef = useRef(write);
  useEffect(() => {
    writeRef.current = write;
  }, [write]);

  // Enable file drag-and-drop when PTY is ready and terminal is active
  const { isDragOver } = useTerminalFileDrop(containerRef, (data) => writeRef.current(data), isActive && !!ptyId);

  // Store onFocus in ref for use in terminal events
  const onFocusRef = useRef(onFocus);
  useEffect(() => {
    onFocusRef.current = onFocus;
  }, [onFocus]);

  // Store onPtyIdReady in ref
  const onPtyIdReadyRef = useRef(onPtyIdReady);
  useEffect(() => {
    onPtyIdReadyRef.current = onPtyIdReady;
  }, [onPtyIdReady]);

  // Store onTitleChange in ref
  const onTitleChangeRef = useRef(onTitleChange);
  useEffect(() => {
    onTitleChangeRef.current = onTitleChange;
  }, [onTitleChange]);

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current || initializedRef.current) return;
    initializedRef.current = true;

    // Track if component is still mounted (for StrictMode double-mount handling)
    let isMounted = true;

    const terminal = new Terminal({
      allowProposedApi: true,
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

    // Attach custom keyboard handlers (Shift+Enter for newline)
    const cleanupKeyboardHandlers = attachKeyboardHandlers(terminal, (data) => writeRef.current(data));

    // Create copy/paste functions for the terminal registry
    const copyPasteFns = createTerminalCopyPaste(terminal, (data) => writeRef.current(data));

    // Attach onData handler immediately
    const onDataDisposable = terminal.onData((data) => {
      writeRef.current(data);
    });

    // Title change handler - notify parent for tab label updates
    const titleChangeDisposable = terminal.onTitleChange((title) => {
      onTitleChangeRef.current?.(title);
    });

    // Register with terminal registry on focus, unregister on blur
    const handleTerminalFocus = () => {
      registerActiveTerminal(copyPasteFns);
    };
    const handleTerminalBlur = () => {
      unregisterActiveTerminal(copyPasteFns);
    };
    terminal.textarea?.addEventListener('focus', handleTerminalFocus);
    terminal.textarea?.addEventListener('blur', handleTerminalBlur);

    // Report focus changes to parent via DOM events on container
    const handleFocus = () => {
      onFocusRef.current?.();
    };
    containerRef.current.addEventListener('focusin', handleFocus);

    // Fit terminal and spawn shell or command
    const initPty = async () => {
      // Wait for next frame to ensure container is laid out
      await new Promise(resolve => requestAnimationFrame(resolve));
      if (!isMounted) return; // Component unmounted during wait

      fitAddon.fit();
      const cols = terminal.cols;
      const rows = terminal.rows;

      // If a command is specified, spawn it; otherwise spawn a shell
      const newPtyId = command
        ? await spawnCommandRef.current(entityId, directory ?? '', command, cols, rows)
        : await spawnShellRef.current(entityId, directory, cols, rows);

      if (newPtyId && isMounted) {
        onPtyIdReadyRef.current?.(newPtyId);
      }
    };

    initPty().catch(console.error);

    return () => {
      isMounted = false;
      onDataDisposable.dispose();
      titleChangeDisposable.dispose();
      cleanupKeyboardHandlers();
      webglCleanup?.();
      containerRef.current?.removeEventListener('focusin', handleFocus);
      terminal.textarea?.removeEventListener('focus', handleTerminalFocus);
      terminal.textarea?.removeEventListener('blur', handleTerminalBlur);
      unregisterActiveTerminal(copyPasteFns);
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      initializedRef.current = false;
      // NOTE: We do NOT kill the PTY here. React may unmount/remount components
      // during reordering or StrictMode. PTY cleanup is handled by:
      // 1. The pty-exit event handler (when shell exits naturally)
      // 2. App.tsx cleanup when tab is explicitly closed
    };
  }, [id, entityId, directory, command]);

  // Update terminal theme when it changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

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

    // Cancel any pending debounced resize since we're handling it now
    debouncedResizeRef.current?.cancel();

    // Check if dimensions would actually change before doing expensive reflow
    const proposed = fitAddon.proposeDimensions();
    if (!proposed || (proposed.cols === terminal.cols && proposed.rows === terminal.rows)) {
      return; // No change needed
    }

    fitAddon.fit();
    resizeRef.current(terminal.cols, terminal.rows);
  }, []);

  // Debounced resize handler (for drag operations)
  // Store in ref so immediateResize can cancel it
  const debouncedResizeRef = useRef<ReturnType<typeof debounce> | null>(null);
  const debouncedResize = useMemo(() => {
    const fn = debounce(immediateResize, 100);
    debouncedResizeRef.current = fn;
    return fn;
  }, [immediateResize]);

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

  // Show overlay during panel resize to hide stretched terminal
  const [isResizing, setIsResizing] = useState(false);

  useEffect(() => {
    if (!ptyId || !isActive) return;

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
    <div className="relative w-full h-full" style={{ backgroundColor: xtermTheme.background, padding: terminalConfig.padding, contain: 'strict' }}>
      <div
        ref={containerRef}
        className="w-full h-full"
      />
      {isResizing && (
        <div className="absolute inset-0 z-50" style={{ backgroundColor: xtermTheme.background }} />
      )}
      {isDragOver && (
        <div className="absolute inset-0 flex items-center justify-center z-10 bg-theme-1/60 pointer-events-none border-2 border-dashed border-theme-2 rounded">
          <span className="text-theme-1 text-sm">Drop files to insert path</span>
        </div>
      )}
    </div>
  );
}

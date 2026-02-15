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
import { useTerminalSearch } from '../../hooks/useTerminalSearch';
import { attachKeyboardHandlers, attachSelectionDragPause, createCursorVisibilityGuard, createTerminalCopyPaste, createImeGuard, createTerminalOutputBuffer, createStreamingSgrColorNormalizer, enableUnicode11Width, getPlatformTerminalOptions, loadWebGLWithRecovery, resolveTerminalFontFamily, resolveTerminalScrollback, resolveTerminalWebglMode, shouldOpenTerminalLink } from '../../lib/terminal';
import { registerActiveTerminal, unregisterActiveTerminal, registerTerminalInstance, unregisterTerminalInstance } from '../../lib/terminalRegistry';
import { log } from '../../lib/log';
import { TerminalSearchControl } from '../TerminalSearchControl';
import '@xterm/xterm/css/xterm.css';


// Debounce helper with cancel support
function debounce<T extends (...args: unknown[]) => void>(fn: T, ms: number): T & { cancel: () => void } {
  let timeout: ReturnType<typeof setTimeout> | null = null;
  let lastInvokeTs = 0;
  let pendingArgs: unknown[] | null = null;

  const invoke = (args: unknown[]) => {
    lastInvokeTs = Date.now();
    fn(...args);
  };

  const debounced = ((...args: unknown[]) => {
    const now = Date.now();
    const elapsed = now - lastInvokeTs;

    if (lastInvokeTs === 0 || elapsed >= ms) {
      if (timeout) {
        clearTimeout(timeout);
        timeout = null;
      }
      pendingArgs = null;
      invoke(args);
      return;
    }

    pendingArgs = args;
    if (timeout) {
      return;
    }

    timeout = setTimeout(() => {
      timeout = null;
      const argsToUse = pendingArgs ?? [];
      pendingArgs = null;
      invoke(argsToUse);
    }, ms - elapsed);
  }) as T & { cancel: () => void };

  debounced.cancel = () => {
    if (timeout) {
      clearTimeout(timeout);
      timeout = null;
    }
    pendingArgs = null;
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
  isVisible?: boolean;
  shouldAutoFocus: boolean;
  /** Counter that triggers focus when incremented */
  focusTrigger?: number;
  terminalConfig: TerminalConfig;
  onClose?: () => void;
  onFocus?: () => void;
  onPtyIdReady?: (ptyId: string) => void;
  /** Called when terminal title changes (via OSC escape codes) */
  onTitleChange?: (title: string) => void;
}

export function DrawerTerminal({ id, entityId, directory, command, isActive, isVisible = true, shouldAutoFocus, focusTrigger, terminalConfig, onClose, onFocus, onPtyIdReady, onTitleChange }: DrawerTerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const initializedRef = useRef(false);
  const isComposingRef = useRef(false);
  const imeGuardRef = useRef<ReturnType<typeof createImeGuard> | null>(null);
  const cursorGuardRef = useRef<ReturnType<typeof createCursorVisibilityGuard> | null>(null);
  const outputBufferRef = useRef<ReturnType<typeof createTerminalOutputBuffer> | null>(null);
  const webglControllerRef = useRef<ReturnType<typeof loadWebGLWithRecovery> | null>(null);
  const sgrNormalizerRef = useRef(createStreamingSgrColorNormalizer());
  const isActiveRef = useRef(isActive);
  const isVisibleRef = useRef(isVisible);

  const {
    isSearchOpen,
    searchQuery,
    hasMatch,
    currentMatchIndex,
    totalMatches,
    setSearchQuery,
    openSearch,
    closeSearch,
    findNext,
    findPrevious,
    onTerminalKeyDown,
  } = useTerminalSearch(terminalRef, { enabled: isActive });

  // Get theme from context (uses sideBar.background for visual hierarchy)
  const xtermTheme = useDrawerXtermTheme();
  const shouldPauseOutputWhenHidden = terminalConfig.pauseOutputWhenHidden === true;

  useTerminalFontSync(terminalRef, fitAddonRef, terminalConfig);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  // Handle PTY output by writing directly to terminal
  const handleOutput = useCallback((data: string) => {
    if (terminalRef.current && outputBufferRef.current) {
      const payload = sgrNormalizerRef.current.normalize(data);
      if (payload.length === 0) return;
      outputBufferRef.current.write(payload);
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
      cursorStyle: 'bar',
      cursorWidth: 1,
      cursorInactiveStyle: 'outline',
      scrollback: resolveTerminalScrollback(terminalConfig.scrollback),
      fontSize: terminalConfig.fontSize,
      fontFamily: resolveTerminalFontFamily(terminalConfig.fontFamily),
      ...getPlatformTerminalOptions(),
      linkHandler: {
        activate: (event, uri) => {
          if (shouldOpenTerminalLink(event)) {
            openUrl(uri).catch(console.error);
          }
        },
      },
      theme: xtermTheme,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon((event, uri) => {
      if (shouldOpenTerminalLink(event)) {
        openUrl(uri).catch(console.error);
      }
    });

    terminal.loadAddon(fitAddon);
    terminal.loadAddon(webLinksAddon);
    enableUnicode11Width(terminal);
    terminal.open(containerRef.current);

    // Load ligatures addon if enabled (incompatible with WebGL)
    let webglController: ReturnType<typeof loadWebGLWithRecovery> | null = null;

    const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
    if (terminalConfig.fontLigatures && !isWindows) {
      try {
        const ligaturesAddon = new LigaturesAddon();
        terminal.loadAddon(ligaturesAddon);
      } catch (e) {
        console.warn('Ligatures addon failed to load:', e);
      }
    } else {
      // Load WebGL addon with automatic recovery from context loss
      webglController = loadWebGLWithRecovery(terminal, {
        mode: resolveTerminalWebglMode(terminalConfig.webgl),
        active: isActiveRef.current,
      });
      webglControllerRef.current = webglController;
    }

    terminalRef.current = terminal;
    fitAddonRef.current = fitAddon;
    const outputBuffer = createTerminalOutputBuffer(terminal, () => {
      if (isComposingRef.current) {
        imeGuardRef.current?.pin();
      } else {
        cursorGuardRef.current?.update();
      }
    });
    if (shouldPauseOutputWhenHidden && !isVisibleRef.current) {
      outputBuffer.pause();
    }
    const cleanupSelectionDragPause = attachSelectionDragPause(terminal, outputBuffer);
    outputBufferRef.current = outputBuffer;

    // Attach custom keyboard handlers (Shift+Enter for newline)
    const cleanupKeyboardHandlers = attachKeyboardHandlers(terminal, (data) => writeRef.current(data));

    // Create copy/paste functions for the terminal registry
    const copyPasteFns = createTerminalCopyPaste(terminal, (data) => writeRef.current(data));

    // Attach onData handler immediately
    const onDataDisposable = terminal.onData((data) => {
      cursorGuardRef.current?.anchor();
      writeRef.current(data);
    });

    // Title change handler - notify parent for tab label updates
    const titleChangeDisposable = terminal.onTitleChange((title) => {
      onTitleChangeRef.current?.(title);
    });

    // Register terminal instance for blur management
    registerTerminalInstance(id, terminal);

    // Register with terminal registry on focus, unregister on blur
    const handleTerminalFocus = () => {
      registerActiveTerminal(copyPasteFns);
    };
    const handleTerminalBlur = () => {
      unregisterActiveTerminal(copyPasteFns);
    };
    terminal.textarea?.addEventListener('focus', handleTerminalFocus);
    terminal.textarea?.addEventListener('blur', handleTerminalBlur);
    terminal.textarea?.addEventListener('keydown', onTerminalKeyDown, true);
    const imeGuard = createImeGuard(terminal);
    imeGuardRef.current = imeGuard;
    const cursorGuard = createCursorVisibilityGuard(terminal, { rowTolerance: 0, minIntervalMs: 33 });
    cursorGuardRef.current = cursorGuard;
    const handleCompositionStart = () => {
      isComposingRef.current = true;
      terminal.options.cursorBlink = false;
      imeGuard.lock();
    };
    const handleCompositionEnd = () => {
      isComposingRef.current = false;
      terminal.options.cursorBlink = isActiveRef.current;
      imeGuard.unlock();
    };
    terminal.textarea?.addEventListener('compositionstart', handleCompositionStart);
    terminal.textarea?.addEventListener('compositionend', handleCompositionEnd);

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
      // Wait for fonts so cell sizing is stable (prevents TUI layout drift)
      await (document.fonts?.ready ?? Promise.resolve());

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
      webglController?.dispose();
      webglControllerRef.current = null;
      containerRef.current?.removeEventListener('focusin', handleFocus);
      terminal.textarea?.removeEventListener('focus', handleTerminalFocus);
      terminal.textarea?.removeEventListener('blur', handleTerminalBlur);
      terminal.textarea?.removeEventListener('keydown', onTerminalKeyDown, true);
      terminal.textarea?.removeEventListener('compositionstart', handleCompositionStart);
      terminal.textarea?.removeEventListener('compositionend', handleCompositionEnd);
      imeGuard.dispose();
      imeGuardRef.current = null;
      cursorGuard.dispose();
      cursorGuardRef.current = null;
      unregisterActiveTerminal(copyPasteFns);
      unregisterTerminalInstance(id);
      cleanupSelectionDragPause();
      outputBuffer.dispose();
      const tail = sgrNormalizerRef.current.flush();
      if (tail && outputBufferRef.current) {
        outputBufferRef.current.write(tail);
      }
      outputBufferRef.current = null;
      terminal.dispose();
      terminalRef.current = null;
      fitAddonRef.current = null;
      initializedRef.current = false;
      // NOTE: We do NOT kill the PTY here. React may unmount/remount components
      // during reordering or StrictMode. PTY cleanup is handled by:
      // 1. The pty-exit event handler (when shell exits naturally)
      // 2. App.tsx cleanup when tab is explicitly closed
    };
  }, [id, entityId, directory, command, onTerminalKeyDown, shouldPauseOutputWhenHidden]);

  // Update terminal theme when it changes
  useEffect(() => {
    if (terminalRef.current) {
      terminalRef.current.options.theme = xtermTheme;
    }
  }, [xtermTheme]);

  useEffect(() => {
    webglControllerRef.current?.setMode(resolveTerminalWebglMode(terminalConfig.webgl));
  }, [terminalConfig.webgl]);

  // Track active state for composition handlers
  useEffect(() => {
    isActiveRef.current = isActive;
    webglControllerRef.current?.setActive(isActive);
  }, [isActive]);

  // Hidden tabs keep receiving PTY output; optionally pause painting until visible.
  useEffect(() => {
    const outputBuffer = outputBufferRef.current;
    if (!outputBuffer) return;

    if (!shouldPauseOutputWhenHidden) {
      outputBuffer.resume();
      return;
    }

    if (isVisible) {
      outputBuffer.resume();
      return;
    }

    outputBuffer.pause();
  }, [isVisible, shouldPauseOutputWhenHidden]);

  // Control cursor blink and style based on active state
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    terminal.options.cursorBlink = isActive && !isComposingRef.current;

    // Access xterm internals to force the inactive cursor style (outline)
    const core = (terminal as any)._core;
    if (core?._coreBrowserService) {
      core._coreBrowserService._isFocused = isActive;
    }
  }, [isActive]);

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
    webglControllerRef.current?.refresh();
    resizeRef.current(terminal.cols, terminal.rows);
  }, []);

  // Debounced resize handler (for drag operations)
  // Store in ref so immediateResize can cancel it
  const debouncedResizeRef = useRef<ReturnType<typeof debounce> | null>(null);
  const debouncedResize = useMemo(() => {
    const fn = debounce(immediateResize, 1000);
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
    const handleStartWithGpuSuspend = () => {
      webglControllerRef.current?.suspend();
      handleStart();
    };
    const handleCompleteWithGpuResume = () => {
      handleComplete();
      webglControllerRef.current?.resume();
    };

    window.addEventListener('panel-resize-start', handleStartWithGpuSuspend);
    window.addEventListener('panel-resize-complete', handleCompleteWithGpuResume);
    return () => {
      window.removeEventListener('panel-resize-start', handleStartWithGpuSuspend);
      window.removeEventListener('panel-resize-complete', handleCompleteWithGpuResume);
      webglControllerRef.current?.resume();
    };
  }, [ptyId, isActive, immediateResize]);

  // Fit on active change
  useEffect(() => {
    if (isActive && ptyId) {
      const timeout = setTimeout(immediateResize, 50);
      return () => clearTimeout(timeout);
    }
  }, [isActive, ptyId, immediateResize]);

  // Focus terminal when shouldAutoFocus is true or when focusTrigger changes
  useEffect(() => {
    log.debug('[DrawerTerminal] Focus effect', { id, shouldAutoFocus, focusTrigger, hasTerminal: !!terminalRef.current });
    if (shouldAutoFocus && !isSearchOpen) {
      // Focus the xterm textarea directly
      const textarea = document.querySelector(
        `[data-terminal-id="${id}"] textarea.xterm-helper-textarea`
      ) as HTMLTextAreaElement | null;
      log.debug('[DrawerTerminal] Focusing terminal textarea', { id, found: !!textarea });
      if (textarea && document.activeElement !== textarea && !isComposingRef.current) {
        textarea.focus();
      }
    }
  }, [shouldAutoFocus, focusTrigger, id, isSearchOpen]);

  return (
    <div className="relative w-full h-full" data-terminal-id={id} style={{ backgroundColor: xtermTheme.background, padding: terminalConfig.padding }}>
      <TerminalSearchControl
        isOpen={isSearchOpen}
        query={searchQuery}
        hasMatch={hasMatch}
        currentMatchIndex={currentMatchIndex}
        totalMatches={totalMatches}
        onOpen={openSearch}
        onClose={closeSearch}
        onQueryChange={setSearchQuery}
        onNext={findNext}
        onPrevious={findPrevious}
      />
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

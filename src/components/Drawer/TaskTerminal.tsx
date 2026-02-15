import { useEffect, useRef, useCallback, useMemo, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';
import { listen } from '@tauri-apps/api/event';
import { openUrl } from '@tauri-apps/plugin-opener';
import { TerminalConfig } from '../../hooks/useConfig';
import { useTerminalFontSync } from '../../hooks/useTerminalFontSync';
import { useDrawerXtermTheme } from '../../theme';
import { useTerminalSearch } from '../../hooks/useTerminalSearch';
import { attachKeyboardHandlers, attachSelectionDragPause, createCursorVisibilityGuard, createTerminalCopyPaste, createImeGuard, createTerminalOutputBuffer, createStreamingSgrColorNormalizer, enableUnicode11Width, getPlatformTerminalOptions, loadWebGLWithRecovery, resolveTerminalFontFamily, resolveTerminalScrollback, resolveTerminalWebglMode, shouldOpenTerminalLink } from '../../lib/terminal';
import { registerActiveTerminal, unregisterActiveTerminal, registerTerminalInstance, unregisterTerminalInstance } from '../../lib/terminalRegistry';
import { spawnTask, ptyWrite, ptyResize, ptyKill } from '../../lib/tauri';
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

interface PtyOutput {
  pty_id: string;
  data: string;
}

interface TaskTerminalProps {
  id: string;
  entityId: string;
  taskName: string;
  isActive: boolean;
  isVisible?: boolean;
  shouldAutoFocus: boolean;
  /** Counter that triggers focus when incremented */
  focusTrigger?: number;
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
  isVisible = true,
  shouldAutoFocus,
  focusTrigger,
  terminalConfig,
  onPtyIdReady,
  onTaskExit,
  onFocus,
}: TaskTerminalProps) {
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
  const ptyIdRef = useRef<string | null>(null);

  // Get theme from context
  const xtermTheme = useDrawerXtermTheme();
  const shouldPauseOutputWhenHidden = terminalConfig.pauseOutputWhenHidden === true;
  const [isPtyReady, setIsPtyReady] = useState(false);

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

  useTerminalFontSync(terminalRef, fitAddonRef, terminalConfig);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

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

    // Load WebGL addon with automatic recovery from context loss
    const webglController = loadWebGLWithRecovery(terminal, {
      mode: resolveTerminalWebglMode(terminalConfig.webgl),
      active: isActiveRef.current,
    });
    webglControllerRef.current = webglController;

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

    // Attach onData handler
    const onDataDisposable = terminal.onData((data) => {
      cursorGuardRef.current?.anchor();
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
      // Wait for fonts so cell sizing is stable (prevents TUI layout drift)
      await (document.fonts?.ready ?? Promise.resolve());

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
          const payload = sgrNormalizerRef.current.normalize(event.payload.data);
          if (payload.length > 0) {
            outputBuffer.write(payload);
          }
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
            outputBuffer.write(`\r\n\x1b[${color}m[Process exited with code ${code}]\x1b[0m\r\n`);
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
          const payload = sgrNormalizerRef.current.normalize(event.data);
          if (payload.length > 0) {
            outputBuffer.write(payload);
          }
        }
      }

      if (!isMounted) {
        ptyKill(newPtyId);
      }
    };

    initTask().catch((err) => {
      console.error('[TaskTerminal] initTask error:', err);
      // Show error in terminal
      outputBuffer.write(`\x1b[31mError: ${err}\x1b[0m\r\n`);
    });

    return () => {
      isMounted = false;
      onDataDisposable.dispose();
      cleanupKeyboardHandlers();
      webglController.dispose();
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
      const tail = sgrNormalizerRef.current.flush();
      if (tail) {
        outputBuffer.write(tail);
      }
      outputBuffer.dispose();
      outputBufferRef.current = null;
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
  }, [id, entityId, taskName, onTerminalKeyDown, shouldPauseOutputWhenHidden]);

  // Listen for signal notifications
  useEffect(() => {
    const handleSignal = (e: Event) => {
    const { ptyId, signal } = (e as CustomEvent).detail;
      if (ptyId === ptyIdRef.current && outputBufferRef.current) {
        outputBufferRef.current.write(`\r\n\x1b[90m[Sending ${signal}...]\x1b[0m\r\n`);
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
    webglControllerRef.current?.refresh();
    ptyResize(ptyIdRef.current, terminal.cols, terminal.rows);
  }, []);

  // Debounced resize handler
  // Store in ref so immediateResize can cancel it
  const debouncedResizeRef = useRef<ReturnType<typeof debounce> | null>(null);
  const debouncedResize = useMemo(() => {
    const fn = debounce(immediateResize, 1000);
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
  }, [isPtyReady, isActive, immediateResize]);

  // Fit on active change
  useEffect(() => {
    if (isActive && isPtyReady) {
      const timeout = setTimeout(immediateResize, 50);
      return () => clearTimeout(timeout);
    }
  }, [isActive, isPtyReady, immediateResize]);

  // Focus terminal when shouldAutoFocus is true or when focusTrigger changes
  useEffect(() => {
    if (shouldAutoFocus && !isSearchOpen) {
      // Focus the xterm textarea directly using document.querySelector (same approach as SplitContainer)
      requestAnimationFrame(() => {
        const textarea = document.querySelector(
          `[data-terminal-id="${id}"] textarea.xterm-helper-textarea`
        ) as HTMLTextAreaElement | null;
        if (textarea && document.activeElement !== textarea && !isComposingRef.current) {
          textarea.focus();
        }
      });
    }
  }, [shouldAutoFocus, focusTrigger, id, isSearchOpen]);

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
      <div ref={containerRef} className="w-full h-full" />
      {isResizing && (
        <div className="absolute inset-0 z-50" style={{ backgroundColor: xtermTheme.background }} />
      )}
    </div>
  );
}

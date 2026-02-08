import type { Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

/**
 * Loads the WebGL addon with automatic recovery from context loss.
 *
 * WebGL contexts can be lost due to GPU driver issues, system sleep,
 * OOM conditions, or when the window loses focus. This function
 * automatically recreates the addon after context loss to prevent
 * the terminal from becoming blurry (falling back to canvas renderer).
 *
 * Also watches for device pixel ratio changes (moving between displays,
 * zooming) and clears the texture atlas to prevent blurriness.
 *
 * @param terminal - The xterm.js Terminal instance
 * @returns Cleanup function to dispose the addon and stop watching DPR
 */
export function loadWebGLWithRecovery(terminal: Terminal): () => void {
  let webglAddon: WebglAddon | null = null;
  let disposed = false;
  let recoveryTimeout: ReturnType<typeof setTimeout> | null = null;

  const loadAddon = () => {
    if (disposed) return;

    try {
      webglAddon = new WebglAddon();
      webglAddon.onContextLoss(() => {
        console.warn('WebGL context lost, will recover...');
        webglAddon?.dispose();
        webglAddon = null;

        // Recreate after a delay to allow GPU to recover
        recoveryTimeout = setTimeout(loadAddon, 1000);
      });
      terminal.loadAddon(webglAddon);
    } catch (e) {
      console.warn('WebGL addon failed to load, using canvas renderer:', e);
      webglAddon = null;
    }
  };

  // Initial load
  loadAddon();

  // Watch for device pixel ratio changes (display switching, zooming)
  // This can cause blurriness if the texture atlas isn't cleared
  let currentDpr = window.devicePixelRatio;
  const dprMediaQuery = window.matchMedia(`(resolution: ${currentDpr}dppx)`);

  const handleDprChange = () => {
    const newDpr = window.devicePixelRatio;
    if (newDpr !== currentDpr) {
      currentDpr = newDpr;
      // Clear texture atlas to force re-render at new DPR
      if (webglAddon) {
        try {
          webglAddon.clearTextureAtlas();
        } catch {
          // Addon may have been disposed, try to reload
          loadAddon();
        }
      }
    }
    // Re-register since the media query is now stale
    dprMediaQuery.removeEventListener('change', handleDprChange);
    const newQuery = window.matchMedia(`(resolution: ${currentDpr}dppx)`);
    newQuery.addEventListener('change', handleDprChange);
  };

  dprMediaQuery.addEventListener('change', handleDprChange);

  // Cleanup function
  return () => {
    disposed = true;
    if (recoveryTimeout) {
      clearTimeout(recoveryTimeout);
    }
    dprMediaQuery.removeEventListener('change', handleDprChange);
    webglAddon?.dispose();
    webglAddon = null;
  };
}

/**
 * Attaches custom keyboard handlers to an xterm.js terminal.
 *
 * Handles:
 * - Shift+Enter: Sends LF for newline insertion in multi-line input
 *   (allows multiline input in applications like Claude CLI)
 *
 * Note: Copy/paste are now handled globally via App.tsx and the terminal registry.
 * Note: Ctrl+C is handled by xterm.js which sends \x03 to the PTY. The line
 * discipline converts this to SIGINT for the foreground process. We don't
 * send SIGINT directly as it interferes with shell readline (breaks ^C echo
 * and line clearing at the prompt).
 *
 * @param terminal - The xterm.js Terminal instance
 * @param write - Function to write data to the PTY
 * @returns Cleanup function to remove event listeners
 */
export function attachKeyboardHandlers(
  terminal: Terminal,
  write: (data: string) => void
): () => void {
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;

    // Shift+Enter: Send LF for newline insertion in multi-line input
    if (event.shiftKey && event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
      write('\x0a');
      return false; // Prevent xterm.js handling
    }

    return true; // Let xterm.js handle normally
  });

  // Prevent native paste event to avoid double-paste.
  // Copy/paste is handled by App.tsx via the terminal registry.
  const handlePaste = (event: ClipboardEvent) => {
    event.preventDefault();
  };

  const element = terminal.element;
  element?.addEventListener('paste', handlePaste);

  return () => {
    element?.removeEventListener('paste', handlePaste);
  };
}

/**
 * Create copy/paste functions for a terminal.
 * Used with the terminal registry for global keyboard handling.
 *
 * @param terminal - The xterm.js Terminal instance
 * @param write - Function to write data to the PTY
 * @returns Object with copy and paste functions
 */
export function createTerminalCopyPaste(
  terminal: Terminal,
  write: (data: string) => void
): { copy: () => boolean; paste: () => void } {
  return {
    copy: () => {
      if (terminal.hasSelection()) {
        const selection = terminal.getSelection();
        writeText(selection).catch(console.error);
        return true;
      }
      return false;
    },
    paste: () => {
      readText()
        .then((text) => {
          if (text) {
            write(text);
          }
        })
        .catch(console.error);
    },
  };
}

export function createInputLineGuard(): {
  shouldSend: (data: string) => boolean;
  reset: () => void;
  getLength: () => number;
} {
  let lineLen = 0;

  const countChars = (text: string) => Array.from(text).length;

  const shouldSend = (data: string) => {
    if (data.length === 0) return false;

    // Enter or newline (Shift+Enter sends LF)
    if (data === '\r' || data === '\n' || data === '\x0a') {
      lineLen = 0;
      return true;
    }

    // Ctrl+C / Ctrl+U clear line
    if (data === '\x03' || data === '\x15') {
      lineLen = 0;
      return true;
    }

    // Backspace/Delete at line start: swallow
    if (data === '\x7f' || data === '\b' || data === '\x1b[3~') {
      if (lineLen === 0) return false;
      lineLen = Math.max(0, lineLen - 1);
      return true;
    }

    // Escape sequences (arrows/function keys) - don't affect line length
    if (data.startsWith('\x1b')) {
      return true;
    }

    const lastNewline = Math.max(data.lastIndexOf('\r'), data.lastIndexOf('\n'));
    if (lastNewline !== -1) {
      const tail = data.slice(lastNewline + 1);
      lineLen = countChars(tail);
      return true;
    }

    lineLen += countChars(data);
    return true;
  };

  const reset = () => {
    lineLen = 0;
  };

  const getLength = () => lineLen;

  return { shouldSend, reset, getLength };
}

export function createImeGuard(terminal: Terminal): {
  lock: () => void;
  unlock: () => void;
  pin: () => void;
  dispose: () => void;
} {
  let locked = false;
  let lockedX = 0;
  let lockedY = 0;
  let originalUpdate: ((dontRecurse?: boolean) => void) | null = null;
  let compositionHelper: any = null;
  let lastPin = 0;
  const MIN_PIN_INTERVAL = 33; // ms, ~30fps
  let stableX = terminal.buffer.active.cursorX;
  let stableY = terminal.buffer.active.cursorY;
  let lastX = stableX;
  let lastY = stableY;
  let settleTimer: ReturnType<typeof setTimeout> | null = null;
  let hasPreferred = false;

  const isIgnoredPosition = (x: number, y: number) => {
    const cols = terminal.cols;
    const rows = terminal.rows;
    if (cols <= 0 || rows <= 0) return false;
    const nearRight = x >= Math.max(cols - 20, 0);
    const nearBottom = y >= Math.max(rows - 2, 0);
    return nearRight && nearBottom;
  };

  const cursorMoveDisposable = terminal.onCursorMove(() => {
    const buffer = terminal.buffer.active;
    lastX = buffer.cursorX;
    lastY = buffer.cursorY;
    if (settleTimer) {
      clearTimeout(settleTimer);
    }
    settleTimer = setTimeout(() => {
      const ignore = isIgnoredPosition(lastX, lastY);
      if (!ignore || !hasPreferred) {
        stableX = lastX;
        stableY = lastY;
        if (!ignore) {
          hasPreferred = true;
        }
      }
      if (locked && hasPreferred && isIgnoredPosition(lockedX, lockedY)) {
        lockedX = stableX;
        lockedY = stableY;
      }
      settleTimer = null;
    }, 30);
  });

  const pin = () => {
    if (!locked) return;
    const now = performance.now();
    if (now - lastPin < MIN_PIN_INTERVAL) return;
    lastPin = now;
    if (hasPreferred && isIgnoredPosition(lockedX, lockedY)) {
      lockedX = stableX;
      lockedY = stableY;
    }
    terminal.write(`\x1b[${lockedY + 1};${lockedX + 1}H`);
  };

  const lock = () => {
    if (locked) return;
    const core = (terminal as any)._core;
    const helper = core?._compositionHelper;
    if (!helper?.updateCompositionElements) return;

    const buffer = terminal.buffer.active;
    if (hasPreferred) {
      lockedX = stableX;
      lockedY = stableY;
    } else {
      lockedX = buffer.cursorX;
      lockedY = buffer.cursorY;
    }

    compositionHelper = helper;
    originalUpdate = helper.updateCompositionElements.bind(helper);

    helper.updateCompositionElements = (dontRecurse?: boolean) => {
      if (!compositionHelper?._isComposing) {
        return originalUpdate?.(dontRecurse);
      }
      const bufferService = compositionHelper?._bufferService;
      const buf = bufferService?.buffer;
      if (!buf) {
        return originalUpdate?.(dontRecurse);
      }
      const origX = buf.x;
      const origY = buf.y;
      buf.x = lockedX;
      buf.y = lockedY;
      try {
        originalUpdate?.(dontRecurse);
      } finally {
        buf.x = origX;
        buf.y = origY;
      }
    };

    locked = true;
    pin();
  };

  const unlock = () => {
    if (!locked) return;
    locked = false;
    if (compositionHelper && originalUpdate) {
      compositionHelper.updateCompositionElements = originalUpdate;
    }
    compositionHelper = null;
    originalUpdate = null;
  };

  const dispose = () => {
    unlock();
    cursorMoveDisposable.dispose();
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
  };

  return { lock, unlock, pin, dispose };
}

export function createCursorVisibilityGuard(
  terminal: Terminal,
  options?: { rowTolerance?: number; minIntervalMs?: number }
): {
  anchor: () => void;
  update: () => void;
  dispose: () => void;
} {
  let anchorY = terminal.buffer.active.cursorY;
  let hasAnchor = false;
  let hidden = false;
  let lastUpdate = 0;
  const rowTolerance = options?.rowTolerance ?? 0;
  const minIntervalMs = options?.minIntervalMs ?? 33;

  const setHidden = (hide: boolean) => {
    if (hidden === hide) return;
    hidden = hide;
    const core = (terminal as any)._core;
    if (core?.coreService) {
      core.coreService.isCursorHidden = hide;
    }
    terminal.refresh(terminal.buffer.active.cursorY, terminal.buffer.active.cursorY);
  };

  const anchor = () => {
    const buffer = terminal.buffer.active;
    anchorY = buffer.cursorY;
    hasAnchor = true;
    setHidden(false);
  };

  const update = () => {
    if (!hasAnchor) return;
    const now = performance.now();
    if (now - lastUpdate < minIntervalMs) return;
    lastUpdate = now;
    const buffer = terminal.buffer.active;
    const cursorY = buffer.cursorY;
    const away = Math.abs(cursorY - anchorY) > rowTolerance;
    setHidden(away);
  };

  const dispose = () => {
    setHidden(false);
  };

  return { anchor, update, dispose };
}

import type { ITerminalOptions, Terminal } from '@xterm/xterm';
import { WebglAddon } from '@xterm/addon-webgl';
import { Unicode11Addon } from '@xterm/addon-unicode11';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

/**
 * Return platform-specific xterm options.
 *
 * On Windows, explicitly enabling ConPTY compatibility heuristics prevents
 * scrollback corruption and missing rows when terminal size changes.
 */
export function getPlatformTerminalOptions(): Partial<ITerminalOptions> {
  if (typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)) {
    return {
      windowsPty: { backend: 'conpty' },
      customGlyphs: false,
    };
  }

  return {};
}

export const TERMINAL_SCROLLBACK = 20000;
export function resolveTerminalFontFamily(fontFamily: string): string {
  const trimmed = fontFamily.trim();
  if (trimmed.length === 0) {
    return 'Consolas, "Courier New", monospace';
  }

  const hasGenericFamily = /\b(monospace|sans-serif|serif|system-ui)\b/i.test(trimmed);
  if (hasGenericFamily) {
    return trimmed;
  }

  return `${trimmed}, monospace`;
}
/**
 * 规范化 ANSI SGR 颜色序列，避免部分工具输出的冒号参数在 xterm.js 中
 * 产生渲染与选区错位（例如 Windows 下彩色块拖拽选择出现白块）。
 *
 * 仅处理以 `m` 结尾的 SGR 序列，且只在存在 `:` 参数时转换为 `;`。
 */
export function normalizeSgrColorSequences(data: string): string {
  if (!data.includes('\x1b[') || !data.includes('m') || !data.includes(':')) {
    return data;
  }

  return data.replace(/\x1b\[([0-9:;]*)m/g, (full, params: string) => {
    if (!params.includes(':')) {
      return full;
    }

    return `\x1b[${params.replace(/:/g, ';')}m`;
  });
}


/**
 * 增量规范化 SGR 颜色序列，处理 ESC 序列跨 chunk 被切开的场景。
 */
export function createStreamingSgrColorNormalizer(): {
  normalize: (data: string) => string;
  flush: () => string;
  reset: () => void;
} {
  let carry = '';

  const extractIncompleteCsiTail = (input: string): { body: string; tail: string } => {
    for (let index = input.length - 1; index >= 0; index--) {
      if (input.charCodeAt(index) !== 0x1b) {
        continue;
      }

      if (index + 1 >= input.length || input.charCodeAt(index + 1) !== 0x5b) {
        continue;
      }

      const tail = input.slice(index);
      if (/^\x1b\[[0-9:;?]*$/.test(tail)) {
        return {
          body: input.slice(0, index),
          tail,
        };
      }

      break;
    }

    return { body: input, tail: '' };
  };

  const normalize = (data: string) => {
    if (!data) {
      return '';
    }

    const merged = carry + data;
    const { body, tail } = extractIncompleteCsiTail(merged);
    carry = tail;
    return normalizeSgrColorSequences(body);
  };

  const flush = () => {
    const tail = carry;
    carry = '';
    return tail;
  };

  const reset = () => {
    carry = '';
  };

  return { normalize, flush, reset };
}
/**
 * Batch PTY output writes to keep ordering stable under high throughput.
 *
 * xterm.js internally buffers writes, but feeding it one tiny chunk per event
 * can still cause visible jitter when events arrive very quickly.
 */
export function createTerminalOutputBuffer(
  terminal: Terminal,
  onAfterWrite?: () => void
): {
  write: (data: string) => void;
  dispose: () => void;
} {
  let queuedChunks: string[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let writing = false;
  let disposed = false;

  const flush = () => {
    if (disposed || writing || queuedChunks.length === 0) {
      return;
    }

    const payload = queuedChunks.join('');
    queuedChunks = [];
    writing = true;

    terminal.write(payload, () => {
      writing = false;
      onAfterWrite?.();

      if (queuedChunks.length > 0) {
        scheduleFlush();
      }
    });
  };

  const scheduleFlush = () => {
    if (disposed || flushTimer !== null) {
      return;
    }

    flushTimer = setTimeout(() => {
      flushTimer = null;
      flush();
    }, 0);
  };

  const write = (data: string) => {
    if (disposed || data.length === 0) {
      return;
    }

    queuedChunks.push(data);

    if (!writing) {
      scheduleFlush();
    }
  };

  const dispose = () => {
    disposed = true;
    queuedChunks = [];
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  return { write, dispose };
}

/**
 * Enable modern Unicode width tables so CJK characters are measured correctly.
 * This improves cursor hit-testing and selection boundaries for Chinese text.
 */
export function enableUnicode11Width(terminal: Terminal): void {
  try {
    const unicodeAddon = new Unicode11Addon();
    terminal.loadAddon(unicodeAddon);
    terminal.unicode.activeVersion = '11';
  } catch (error) {
    console.warn('Unicode11 addon failed to load, using default width tables:', error);
  }
}

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
  if (typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)) {
    // xterm WebGL renderer can produce selection artifacts on ANSI-colored text
    // in Windows (e.g. white blocks at color boundaries while drag-selecting).
    // Keep canvas renderer on Windows for correctness.
    return () => {};
  }

  let webglAddon: WebglAddon | null = null;
  let disposed = false;
  let recoveryTimeout: ReturnType<typeof setTimeout> | null = null;
  let selectionDisposable: { dispose: () => void } | null = null;

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

      // Work around intermittent glyph artifacts on colored lines while dragging
      // selection in WebGL renderer. Clearing the atlas on selection changes
      // forces re-rasterization and avoids "white box" overlays.
      selectionDisposable?.dispose();
      selectionDisposable = terminal.onSelectionChange(() => {
        try {
          webglAddon?.clearTextureAtlas();
        } catch {
          // ignore transient renderer states
        }
      });
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
    selectionDisposable?.dispose();
    selectionDisposable = null;
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
  if (typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)) {
    return {
      lock: () => {},
      unlock: () => {},
      pin: () => {},
      dispose: () => {},
    };
  }
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
    if (terminal.hasSelection()) return;
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
    if (terminal.hasSelection()) return;
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

  const selectionDisposable = terminal.onSelectionChange(() => {
    const hasSelection = terminal.hasSelection();

    if (hasSelection && locked) {
      unlock();
      return;
    }
  });

  // Some IME implementations keep composition helper active while the user starts
  // mouse drag selection. Unlock immediately on mouse down to avoid overlay blocks.
  const handleMouseDown = () => {
    unlock();
  };
  terminal.element?.addEventListener('mousedown', handleMouseDown, true);

  const dispose = () => {
    unlock();
    cursorMoveDisposable.dispose();
    selectionDisposable.dispose();
    terminal.element?.removeEventListener('mousedown', handleMouseDown, true);
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
  if (typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent)) {
    // Custom cursor hiding can leave stale overlay artifacts on some Windows
    // terminals with ANSI-colored output during drag selection.
    return {
      anchor: () => {},
      update: () => {},
      dispose: () => {},
    };
  }

  let anchorY = terminal.buffer.active.cursorY;
  let hasAnchor = false;
  let hidden = false;
  let hiddenByAway = false;
  let hiddenBySelection = false;
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

  const applyHiddenState = () => {
    setHidden(hiddenByAway || hiddenBySelection);
  };

  const selectionDisposable = terminal.onSelectionChange(() => {
    hiddenBySelection = terminal.hasSelection();
    applyHiddenState();
  });

  const anchor = () => {
    const buffer = terminal.buffer.active;
    anchorY = buffer.cursorY;
    hasAnchor = true;
    hiddenByAway = false;
    applyHiddenState();
  };

  const update = () => {
    if (!hasAnchor) return;
    const now = performance.now();
    if (now - lastUpdate < minIntervalMs) return;
    lastUpdate = now;
    const buffer = terminal.buffer.active;
    const cursorY = buffer.cursorY;
    const away = Math.abs(cursorY - anchorY) > rowTolerance;
    hiddenByAway = away;
    applyHiddenState();
  };

  const dispose = () => {
    selectionDisposable.dispose();
    hiddenByAway = false;
    hiddenBySelection = false;
    applyHiddenState();
  };

  return { anchor, update, dispose };
}

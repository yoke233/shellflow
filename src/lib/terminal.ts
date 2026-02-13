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
export const MAX_TERMINAL_SCROLLBACK = 100000;
export const MIN_TERMINAL_SCROLLBACK = 0;
export type TerminalWebglMode = 'off' | 'auto' | 'on';

export function resolveTerminalScrollback(scrollback: number): number {
  if (!Number.isFinite(scrollback)) {
    return TERMINAL_SCROLLBACK;
  }

  const normalized = Math.trunc(scrollback);
  if (normalized < MIN_TERMINAL_SCROLLBACK) {
    return MIN_TERMINAL_SCROLLBACK;
  }
  if (normalized > MAX_TERMINAL_SCROLLBACK) {
    return MAX_TERMINAL_SCROLLBACK;
  }
  return normalized;
}

export function resolveTerminalWebglMode(value: unknown): TerminalWebglMode {
  if (value === false) return 'off';
  if (value === true) return 'auto';
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (normalized === 'off' || normalized === 'auto' || normalized === 'on') {
      return normalized;
    }
  }
  return 'auto';
}
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
  pause: () => void;
  resume: () => void;
  dispose: () => void;
} {
  let queuedChunks: string[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;
  let writing = false;
  let paused = false;
  let disposed = false;

  const flush = () => {
    if (disposed || writing || paused || queuedChunks.length === 0) {
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

    if (!writing && !paused) {
      scheduleFlush();
    }
  };

  const pause = () => {
    if (disposed) {
      return;
    }
    paused = true;
  };

  const resume = () => {
    if (disposed || !paused) {
      return;
    }
    paused = false;
    if (!writing && queuedChunks.length > 0) {
      scheduleFlush();
    }
  };

  const dispose = () => {
    disposed = true;
    paused = false;
    queuedChunks = [];
    if (flushTimer !== null) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
  };

  return { write, pause, resume, dispose };
}

export function attachSelectionDragPause(
  terminal: Terminal,
  outputBuffer: { pause: () => void; resume: () => void },
  webglController?: { suspend: () => void; resume: () => void }
): () => void {
  const element = terminal.element;
  if (!element) {
    return () => {};
  }

  let pausedByDrag = false;
  let mouseDown = false;
  let dragMode = false;
  let startX = 0;
  let startY = 0;
  const DRAG_THRESHOLD_PX = 3;

  const handleMouseDown = (event: MouseEvent) => {
    if (event.button !== 0) {
      return;
    }
    mouseDown = true;
    dragMode = false;
    startX = event.clientX;
    startY = event.clientY;
  };

  const handleMouseMove = (event: MouseEvent) => {
    if (!mouseDown || dragMode) {
      return;
    }
    const deltaX = Math.abs(event.clientX - startX);
    const deltaY = Math.abs(event.clientY - startY);
    if (deltaX < DRAG_THRESHOLD_PX && deltaY < DRAG_THRESHOLD_PX) {
      return;
    }

    dragMode = true;
    pausedByDrag = true;
    outputBuffer.pause();
    webglController?.suspend();
  };

  const handleMouseUp = () => {
    mouseDown = false;
    dragMode = false;
    if (!pausedByDrag) {
      return;
    }
    pausedByDrag = false;
    outputBuffer.resume();
    webglController?.resume();
  };

  const handleWindowBlur = () => {
    mouseDown = false;
    dragMode = false;
    if (!pausedByDrag) {
      return;
    }
    pausedByDrag = false;
    outputBuffer.resume();
    webglController?.resume();
  };

  element.addEventListener('mousedown', handleMouseDown, true);
  window.addEventListener('mousemove', handleMouseMove, true);
  window.addEventListener('mouseup', handleMouseUp, true);
  window.addEventListener('blur', handleWindowBlur);

  return () => {
    element.removeEventListener('mousedown', handleMouseDown, true);
    window.removeEventListener('mousemove', handleMouseMove, true);
    window.removeEventListener('mouseup', handleMouseUp, true);
    window.removeEventListener('blur', handleWindowBlur);
  };
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
 * @returns WebGL controller (setMode / setActive / suspend / resume / dispose)
 */
export function loadWebGLWithRecovery(
  terminal: Terminal,
  options: WebglRecoveryOptions = {}
): WebglRecoveryController {
  return loadWebGLWithRecoveryController(terminal, options);
}

type WebglRecoveryOptions = {
  mode?: TerminalWebglMode | boolean;
  active?: boolean;
};

type WebglRecoveryController = {
  setMode: (mode: TerminalWebglMode | boolean) => void;
  setActive: (active: boolean) => void;
  suspend: () => void;
  resume: () => void;
  isEnabled: () => boolean;
  dispose: () => void;
};

export function loadWebGLWithRecoveryController(
  terminal: Terminal,
  options: WebglRecoveryOptions = {}
): WebglRecoveryController {
  let mode = resolveTerminalWebglMode(options.mode);
  let active = options.active ?? true;
  let suspendedCount = 0;
  let webglAddon: WebglAddon | null = null;
  let disposed = false;
  let recoveryTimeout: ReturnType<typeof setTimeout> | null = null;
  let selectionDisposable: { dispose: () => void } | null = null;
  let atlasRefreshTimer: ReturnType<typeof setTimeout> | null = null;
  let fusedOff = false;
  const contextLossTimestamps: number[] = [];
  const CONTEXT_LOSS_WINDOW_MS = 30000;
  const CONTEXT_LOSS_FUSE_THRESHOLD = 2;

  const isWindows = typeof navigator !== 'undefined' && /Windows/i.test(navigator.userAgent);
  let currentDpr = window.devicePixelRatio;
  const dprMediaQuery = window.matchMedia(`(resolution: ${currentDpr}dppx)`);

  const queueAtlasRefresh = () => {
    if (!webglAddon || disposed) return;
    if (atlasRefreshTimer) return;
    atlasRefreshTimer = setTimeout(() => {
      atlasRefreshTimer = null;
      if (!webglAddon) return;
      try {
        webglAddon.clearTextureAtlas();
      } catch {
        // ignore transient renderer states
      }
    }, 120);
  };

  const disableAddon = () => {
    if (recoveryTimeout) {
      clearTimeout(recoveryTimeout);
      recoveryTimeout = null;
    }
    if (atlasRefreshTimer) {
      clearTimeout(atlasRefreshTimer);
      atlasRefreshTimer = null;
    }
    selectionDisposable?.dispose();
    selectionDisposable = null;
    webglAddon?.dispose();
    webglAddon = null;
  };

  const shouldEnableAddon = () => {
    if (disposed || fusedOff || suspendedCount > 0) {
      return false;
    }
    if (mode === 'off') {
      return false;
    }
    if (mode === 'on') {
      return true;
    }
    // auto 模式：仅活跃终端启用，降低多终端并发渲染冲突
    return active;
  };

  const scheduleRecover = () => {
    if (recoveryTimeout || disposed) {
      return;
    }
    recoveryTimeout = setTimeout(() => {
      recoveryTimeout = null;
      syncAddonState();
    }, 1000);
  };

  const onContextLoss = () => {
    const now = Date.now();
    contextLossTimestamps.push(now);
    while (contextLossTimestamps.length > 0 && now - contextLossTimestamps[0] > CONTEXT_LOSS_WINDOW_MS) {
      contextLossTimestamps.shift();
    }

    disableAddon();
    if (mode === 'auto' && (contextLossTimestamps.length >= CONTEXT_LOSS_FUSE_THRESHOLD || isWindows)) {
      fusedOff = true;
      console.warn('WebGL fused off due to instability; using canvas renderer.');
      return;
    }

    scheduleRecover();
  };

  const enableAddon = () => {
    if (webglAddon || disposed) {
      return;
    }

    try {
      const addon = new WebglAddon();
      addon.onContextLoss(onContextLoss);
      terminal.loadAddon(addon);
      webglAddon = addon;
      queueAtlasRefresh();

      selectionDisposable?.dispose();
      selectionDisposable = terminal.onSelectionChange(() => {
        queueAtlasRefresh();
      });
    } catch (e) {
      console.warn('WebGL addon failed to load, using canvas renderer:', e);
      webglAddon = null;
      if (mode === 'auto') {
        fusedOff = true;
      }
    }
  };

  const syncAddonState = () => {
    if (shouldEnableAddon()) {
      enableAddon();
    } else {
      disableAddon();
    }
  };

  const handleDprChange = () => {
    const newDpr = window.devicePixelRatio;
    if (newDpr !== currentDpr) {
      currentDpr = newDpr;
      queueAtlasRefresh();
    }
  };

  dprMediaQuery.addEventListener('change', handleDprChange);
  syncAddonState();

  return {
    setMode: (nextMode) => {
      mode = resolveTerminalWebglMode(nextMode);
      // 用户明确切换模式时重置熔断状态
      fusedOff = false;
      contextLossTimestamps.length = 0;
      syncAddonState();
    },
    setActive: (nextActive) => {
      active = nextActive;
      syncAddonState();
    },
    suspend: () => {
      suspendedCount += 1;
      syncAddonState();
    },
    resume: () => {
      suspendedCount = Math.max(0, suspendedCount - 1);
      syncAddonState();
    },
    isEnabled: () => webglAddon !== null,
    dispose: () => {
      disposed = true;
      disableAddon();
      dprMediaQuery.removeEventListener('change', handleDprChange);
    },
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

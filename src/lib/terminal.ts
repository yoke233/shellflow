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

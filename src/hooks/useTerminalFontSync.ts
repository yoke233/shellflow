import { useEffect, useRef, RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TerminalConfig } from './useConfig';

/**
 * Syncs terminal font settings when config changes.
 * Handles dynamic font updates when switching between projects with different configs,
 * as well as zoom level changes.
 *
 * When the font family changes, this also clears xterm.js internal caches to force
 * character re-measurement. This is necessary because xterm caches character dimensions
 * and the WebGL texture atlas at terminal.open() time.
 */
export function useTerminalFontSync(
  terminalRef: RefObject<Terminal | null>,
  fitAddonRef: RefObject<FitAddon | null>,
  config: TerminalConfig
) {
  // Track previous font family to detect changes
  const lastFontFamilyRef = useRef<string | null>(null);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    // Detect if this is our first sync with this terminal (ref was null) or if font changed
    const isFirstSync = lastFontFamilyRef.current === null;
    const fontFamilyChanged = !isFirstSync && lastFontFamilyRef.current !== config.fontFamily;
    lastFontFamilyRef.current = config.fontFamily;

    terminal.options.fontSize = config.fontSize;
    terminal.options.fontFamily = config.fontFamily;

    // Clear caches on first sync (terminal may have been created with different font)
    // or when font family changes. This forces xterm.js to re-measure characters.
    if (isFirstSync || fontFamilyChanged) {
      // Access xterm internals to clear the character size cache
      const core = (terminal as any)._core;
      if (core?._charSizeService) {
        // Force character size recalculation by invalidating the cache
        core._charSizeService._width = 0;
        core._charSizeService._height = 0;
      }

      // Clear the render service's dimensions cache
      if (core?._renderService?._renderer) {
        const renderer = core._renderService._renderer;
        // For WebGL renderer, clear the texture atlas
        if (renderer._charAtlas?.clearTexture) {
          renderer._charAtlas.clearTexture();
        }
        // For canvas renderer
        if (renderer._charAtlas?.clear) {
          renderer._charAtlas.clear();
        }
      }
    }

    // Refit terminal to apply new font size and trigger re-measurement
    fitAddonRef.current?.fit();

    // Force a full refresh to re-render all characters
    terminal.refresh(0, terminal.rows - 1);

    // Dispatch resize event so active terminals notify their PTY of new dimensions
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('panel-resize-complete'));
    });
  }, [config.fontSize, config.fontFamily]);
}

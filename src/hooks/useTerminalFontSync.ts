import { useEffect, useRef, RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TerminalConfig } from './useConfig';
import { resolveTerminalFontFamily } from '../lib/terminal';

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
  const lastFontFamilyRef = useRef<string | null>(null);
  const lastFontSizeRef = useRef<number | null>(null);

  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    const resolvedFontFamily = resolveTerminalFontFamily(config.fontFamily);

    const isFirstSync = lastFontFamilyRef.current === null;
    const fontFamilyChanged = !isFirstSync && lastFontFamilyRef.current !== resolvedFontFamily;
    const fontSizeChanged =
      !isFirstSync && lastFontSizeRef.current !== null && lastFontSizeRef.current !== config.fontSize;

    lastFontFamilyRef.current = resolvedFontFamily;
    lastFontSizeRef.current = config.fontSize;

    terminal.options.fontSize = config.fontSize;
    terminal.options.fontFamily = resolvedFontFamily;

    if (isFirstSync || fontFamilyChanged || fontSizeChanged) {
      const core = (terminal as any)._core;
      if (core?._charSizeService) {
        core._charSizeService._width = 0;
        core._charSizeService._height = 0;
      }

      if (core?._renderService?._renderer) {
        const renderer = core._renderService._renderer;
        if (renderer._charAtlas?.clearTexture) {
          renderer._charAtlas.clearTexture();
        }
        if (renderer._charAtlas?.clear) {
          renderer._charAtlas.clear();
        }
      }
    }

    fitAddonRef.current?.fit();
    terminal.refresh(0, terminal.rows - 1);

    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('panel-resize-complete'));
    });
  }, [config.fontSize, config.fontFamily]);
}
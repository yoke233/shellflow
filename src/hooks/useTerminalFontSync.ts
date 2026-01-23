import { useEffect, RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TerminalConfig } from './useConfig';

/**
 * Syncs terminal font settings when config changes.
 * Handles dynamic font updates when switching between projects with different configs,
 * as well as zoom level changes.
 */
export function useTerminalFontSync(
  terminalRef: RefObject<Terminal | null>,
  fitAddonRef: RefObject<FitAddon | null>,
  config: TerminalConfig
) {
  useEffect(() => {
    const terminal = terminalRef.current;
    if (!terminal) return;

    terminal.options.fontSize = config.fontSize;
    terminal.options.fontFamily = config.fontFamily;

    // Refit terminal to apply new font size
    fitAddonRef.current?.fit();

    // Dispatch resize event so active terminals notify their PTY of new dimensions
    // (e.g., after zoom changes the font size, the PTY needs to know the new cols/rows)
    requestAnimationFrame(() => {
      window.dispatchEvent(new Event('panel-resize-complete'));
    });
  }, [config.fontSize, config.fontFamily]);
}

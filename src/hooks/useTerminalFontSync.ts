import { useEffect, RefObject } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { TerminalConfig } from './useConfig';

/**
 * Syncs terminal font settings when config changes.
 * Handles dynamic font updates when switching between projects with different configs.
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
  }, [config.fontSize, config.fontFamily]);
}

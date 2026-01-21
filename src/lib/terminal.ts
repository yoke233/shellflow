import type { Terminal } from '@xterm/xterm';
import type { Shortcut } from '../hooks/useConfig';
import { matchesShortcut } from './keyboard';
import { readText, writeText } from '@tauri-apps/plugin-clipboard-manager';

export interface TerminalShortcuts {
  copy: Shortcut;
  paste: Shortcut;
}

/**
 * Attaches custom keyboard handlers to an xterm.js terminal.
 *
 * Handles:
 * - Copy shortcut: Copy selected text to clipboard (configurable, default Cmd+C / Ctrl+Shift+C)
 * - Paste shortcut: Paste from clipboard (configurable, default Cmd+V / Ctrl+Shift+V)
 * - Shift+Enter: Sends kitty keyboard protocol sequence for newline insertion
 *   (allows multiline input in applications like Claude CLI)
 *
 * @param terminal - The xterm.js Terminal instance
 * @param write - Function to write data to the PTY
 * @param shortcuts - Configurable keyboard shortcuts for copy/paste
 */
export function attachKeyboardHandlers(
  terminal: Terminal,
  write: (data: string) => void,
  shortcuts?: TerminalShortcuts
): void {
  terminal.attachCustomKeyEventHandler((event) => {
    if (event.type !== 'keydown') return true;

    // Copy shortcut: copy selection to clipboard
    if (shortcuts?.copy && matchesShortcut(event, shortcuts.copy)) {
      if (terminal.hasSelection()) {
        const selection = terminal.getSelection();
        writeText(selection).catch(console.error);
        return false; // Prevent default handling
      }
      // No selection: let the key pass through (e.g., Ctrl+C sends interrupt)
      return true;
    }

    // Paste shortcut: paste from clipboard (uses native Tauri API to avoid macOS prompt)
    if (shortcuts?.paste && matchesShortcut(event, shortcuts.paste)) {
      readText()
        .then((text) => {
          if (text) {
            write(text);
          }
        })
        .catch(console.error);
      return false; // Prevent default handling
    }

    // Shift+Enter: Send kitty keyboard protocol sequence for newline
    if (event.shiftKey && event.key === 'Enter') {
      write('\x1b[13;2u');
      return false; // Prevent default handling
    }

    return true; // Let xterm.js handle normally
  });
}

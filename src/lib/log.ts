/**
 * Unified logging that outputs to:
 * - Browser DevTools console
 * - Terminal stdout (when running `npm run tauri dev`)
 * - Log file (~/.../shellflow.log)
 */

import { invoke } from "@tauri-apps/api/core";
import {
  info as tauriInfo,
  warn as tauriWarn,
  error as tauriError,
  debug as tauriDebug,
  trace as tauriTrace,
} from "@tauri-apps/plugin-log";

// Also log to browser console for DevTools visibility
const LOG_TO_CONSOLE = true;

// Also log to terminal stdout (via Tauri command)
const LOG_TO_TERMINAL = true;

// Check if we're in a Tauri environment (evaluated at call time, not module load)
function isTauri(): boolean {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
}

// Send log to terminal via Tauri command (fire and forget)
function logToTerminal(level: string, message: string) {
  if (isTauri() && LOG_TO_TERMINAL) {
    invoke('log_to_terminal', { level, message }).catch(() => {
      // Ignore errors - logging should never break the app
    });
  }
}

export const log = {
  /** Info level - general information (maps to console.log) */
  info: (message: string, ...args: unknown[]) => {
    const formatted = formatMessage(message, args);
    if (LOG_TO_CONSOLE) console.log(message, ...args);
    if (isTauri()) tauriInfo(formatted);
    logToTerminal('info', formatted);
  },

  /** Warning level */
  warn: (message: string, ...args: unknown[]) => {
    const formatted = formatMessage(message, args);
    if (LOG_TO_CONSOLE) console.warn(message, ...args);
    if (isTauri()) tauriWarn(formatted);
    logToTerminal('warn', formatted);
  },

  /** Error level */
  error: (message: string, ...args: unknown[]) => {
    const formatted = formatMessage(message, args);
    if (LOG_TO_CONSOLE) console.error(message, ...args);
    if (isTauri()) tauriError(formatted);
    logToTerminal('error', formatted);
  },

  /** Debug level - detailed debugging info */
  debug: (message: string, ...args: unknown[]) => {
    const formatted = formatMessage(message, args);
    if (LOG_TO_CONSOLE) console.debug(message, ...args);
    if (isTauri()) tauriDebug(formatted);
    logToTerminal('debug', formatted);
  },

  /** Trace level - very detailed tracing */
  trace: (message: string, ...args: unknown[]) => {
    const formatted = formatMessage(message, args);
    if (LOG_TO_CONSOLE) console.trace(message, ...args);
    if (isTauri()) tauriTrace(formatted);
    logToTerminal('trace', formatted);
  },
};

function formatMessage(message: string, args: unknown[]): string {
  if (args.length === 0) return message;

  // Format objects for the log file
  const formattedArgs = args.map(arg => {
    if (typeof arg === 'object' && arg !== null) {
      try {
        return JSON.stringify(arg);
      } catch {
        return String(arg);
      }
    }
    return String(arg);
  });

  return `${message} ${formattedArgs.join(' ')}`;
}

export default log;

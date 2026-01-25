const isMac = typeof navigator !== 'undefined' && navigator.platform.toUpperCase().includes('MAC');

/** Platform-specific shortcut mapping */
export interface PlatformShortcut {
  mac?: string;
  other?: string;
}

/** A shortcut entry: either a universal string or platform-specific object */
export type ShortcutEntry = string | PlatformShortcut;

/**
 * A shortcut configuration that can be:
 * - A simple string (universal)
 * - A platform-specific object { mac?: string, other?: string }
 * - An array of strings and/or platform-specific objects
 */
export type Shortcut = string | PlatformShortcut | ShortcutEntry[];

/**
 * Check if a keyboard event matches a single shortcut string.
 *
 * Shortcut format: "mod+key" where mod is ctrl, cmd, alt, shift (combine with +)
 * - "cmd" = Cmd on macOS, Ctrl on other platforms
 * - "ctrl" = Ctrl key specifically
 *
 * Examples: "ctrl+`", "cmd+t", "cmd+shift+p"
 */
// Map of special keys where event.key differs from the shortcut key
// (e.g., Ctrl+\ produces a control character, not '\')
const KEY_CODE_MAP: Record<string, string> = {
  '\\': 'Backslash',
  '/': 'Slash',
  '[': 'BracketLeft',
  ']': 'BracketRight',
  '`': 'Backquote',
  'escape': 'Escape',
  "'": 'Quote',
};

function matchesSingleShortcut(event: KeyboardEvent, shortcut: string): boolean {
  const parts = shortcut.toLowerCase().split('+');
  const key = parts.pop();
  const modifiers = new Set(parts);

  if (!key) return false;

  // Check key match - use event.code for special keys that produce control characters
  const expectedCode = KEY_CODE_MAP[key];
  const eventKey = event.key.toLowerCase();
  const keyMatches = expectedCode
    ? event.code === expectedCode
    : eventKey === key;

  if (!keyMatches) return false;

  // "cmd" means metaKey on Mac, ctrlKey elsewhere
  const wantsCmd = modifiers.has('cmd');
  const wantsCtrl = modifiers.has('ctrl');
  const wantsAlt = modifiers.has('alt');
  const wantsShift = modifiers.has('shift');

  // Calculate expected modifier state
  let expectedMeta = false;
  let expectedCtrl = false;

  if (wantsCmd) {
    if (isMac) {
      expectedMeta = true;
    } else {
      expectedCtrl = true;
    }
  }
  if (wantsCtrl) {
    expectedCtrl = true;
  }

  // Check all modifiers match
  if (event.metaKey !== expectedMeta) return false;
  if (event.ctrlKey !== expectedCtrl) return false;
  if (event.altKey !== wantsAlt) return false;
  if (event.shiftKey !== wantsShift) return false;

  return true;
}

/**
 * Check if an object is a PlatformShortcut (has mac or other keys).
 */
function isPlatformShortcut(obj: unknown): obj is PlatformShortcut {
  return typeof obj === 'object' && obj !== null && ('mac' in obj || 'other' in obj);
}

/**
 * Get the applicable shortcut string from a platform shortcut.
 */
function getPlatformShortcutString(ps: PlatformShortcut): string | undefined {
  return isMac ? ps.mac : ps.other;
}

/**
 * Resolve a ShortcutEntry to applicable shortcut strings for the current platform.
 */
function resolveShortcutEntry(entry: ShortcutEntry): string[] {
  if (typeof entry === 'string') {
    return [entry];
  }
  if (isPlatformShortcut(entry)) {
    const s = getPlatformShortcutString(entry);
    return s ? [s] : [];
  }
  return [];
}

/**
 * Resolve a Shortcut config to all applicable shortcut strings for the current platform.
 */
function resolveShortcut(shortcut: Shortcut): string[] {
  if (typeof shortcut === 'string') {
    return [shortcut];
  }
  if (Array.isArray(shortcut)) {
    return shortcut.flatMap(resolveShortcutEntry);
  }
  if (isPlatformShortcut(shortcut)) {
    const s = getPlatformShortcutString(shortcut);
    return s ? [s] : [];
  }
  return [];
}

/**
 * Check if a keyboard event matches a shortcut configuration.
 *
 * The shortcut can be:
 * - A string: "cmd+c" (universal)
 * - A platform object: { mac: "cmd+c", other: "ctrl+shift+c" }
 * - An array of strings and/or platform objects
 */
export function matchesShortcut(event: KeyboardEvent, shortcut: Shortcut): boolean {
  const shortcuts = resolveShortcut(shortcut);
  return shortcuts.some(s => matchesSingleShortcut(event, s));
}

// ============================================================================
// Shortcut Display Formatting
// ============================================================================

/** Map of shortcut keys to display symbols */
const DISPLAY_KEY_MAP: Record<string, string> = {
  cmd: isMac ? '⌘' : 'Ctrl',
  ctrl: isMac ? '⌃' : 'Ctrl',
  alt: isMac ? '⌥' : 'Alt',
  shift: isMac ? '⇧' : 'Shift',
  escape: 'Esc',
  '`': '`',
  '\\': '\\',
  '/': '/',
  '[': '[',
  ']': ']',
  "'": "'",
  '-': '-',
  '=': '+',
};

/**
 * Format a shortcut string for display.
 * E.g., "cmd+shift+p" -> "⌘⇧P" on Mac, "Ctrl+Shift+P" elsewhere
 */
function formatSingleShortcut(shortcut: string): string {
  const parts = shortcut.toLowerCase().split('+');
  const key = parts.pop();
  const modifiers = parts;

  if (!key) return '';

  const formattedParts: string[] = [];

  // Format modifiers in standard order
  const modOrder = ['ctrl', 'alt', 'shift', 'cmd'];
  for (const mod of modOrder) {
    if (modifiers.includes(mod)) {
      formattedParts.push(DISPLAY_KEY_MAP[mod] || mod);
    }
  }

  // Format key
  const displayKey = DISPLAY_KEY_MAP[key] || key.toUpperCase();
  formattedParts.push(displayKey);

  // On Mac, modifiers are typically shown without separators
  if (isMac) {
    return formattedParts.join('');
  }
  return formattedParts.join('+');
}

/**
 * Format a Shortcut configuration for display (first applicable shortcut).
 * Returns undefined if no shortcut is available for the current platform.
 */
export function formatShortcut(shortcut: Shortcut): string | undefined {
  const shortcuts = resolveShortcut(shortcut);
  if (shortcuts.length === 0) return undefined;
  return formatSingleShortcut(shortcuts[0]);
}

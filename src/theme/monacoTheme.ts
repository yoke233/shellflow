/**
 * Convert VSCode themes to Monaco editor format.
 */

import type { VSCodeTheme, VSCodeTokenColor, MonacoThemeData, MonacoTokenRule } from './types';

/**
 * Determine the Monaco base theme from VSCode theme type.
 */
function getMonacoBase(vscodeType?: string): 'vs' | 'vs-dark' | 'hc-black' | 'hc-light' {
  switch (vscodeType) {
    case 'light':
      return 'vs';
    case 'dark':
      return 'vs-dark';
    case 'hc':
    case 'hc-black':
      return 'hc-black';
    case 'hcLight':
    case 'hc-light':
      return 'hc-light';
    default:
      return 'vs-dark';
  }
}

/**
 * Normalize a color value into a Monaco-compatible hex string (no leading #).
 * Monaco token colors must be 6 or 8 hex digits; 3/4-digit forms are expanded.
 */
function normalizeTokenColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const trimmed = color.trim();
  if (trimmed.length === 0) return undefined;

  let hex = trimmed.startsWith('#') ? trimmed.slice(1) : trimmed;
  if (hex.startsWith('0x') || hex.startsWith('0X')) {
    hex = hex.slice(2);
  }

  if (!/^[0-9a-fA-F]+$/.test(hex)) return undefined;

  if (hex.length === 3 || hex.length === 4) {
    hex = hex
      .split('')
      .map((c) => c + c)
      .join('');
  }

  if (hex.length !== 6 && hex.length !== 8) return undefined;

  return hex;
}

/**
 * Normalize a theme color value for Monaco colors map (requires leading #).
 */
function normalizeThemeColor(color: string | undefined): string | undefined {
  if (!color) return undefined;
  const trimmed = color.trim();
  if (trimmed.length === 0) return undefined;
  if (trimmed.toLowerCase() === 'transparent') return '#00000000';

  const hex = normalizeTokenColor(trimmed);
  return hex ? `#${hex}` : undefined;
}

/**
 * Convert a VSCode scope to Monaco token names.
 * Monaco uses dot-separated token names while VSCode uses space-separated scopes.
 */
function vscodeScoreToMonacoToken(scope: string): string {
  // Monaco token names use dots, VSCode scopes use dots too but with different meanings
  // For simplicity, we keep the scope as-is since Monaco can match partial scopes
  return scope.trim();
}

/**
 * Convert VSCode tokenColors to Monaco token rules.
 */
function convertTokenColors(tokenColors: VSCodeTokenColor[]): MonacoTokenRule[] {
  const rules: MonacoTokenRule[] = [];

  for (const tokenColor of tokenColors) {
    const { scope, settings } = tokenColor;
    const scopes = Array.isArray(scope) ? scope : [scope];

    for (const s of scopes) {
      if (!s) continue;

      const rule: MonacoTokenRule = {
        token: vscodeScoreToMonacoToken(s),
      };

      if (settings.foreground) {
        const foreground = normalizeTokenColor(settings.foreground);
        if (foreground) {
          rule.foreground = foreground;
        }
      }
      if (settings.background) {
        const background = normalizeTokenColor(settings.background);
        if (background) {
          rule.background = background;
        }
      }
      if (settings.fontStyle) {
        rule.fontStyle = settings.fontStyle;
      }

      rules.push(rule);
    }
  }

  return rules;
}

/**
 * Convert VSCode theme colors to Monaco colors format.
 * Monaco expects colors with # prefix in the colors object.
 */
function convertColors(colors: Record<string, string> | undefined): Record<string, string> {
  if (!colors) return {};

  const result: Record<string, string> = {};

  for (const [key, value] of Object.entries(colors)) {
    const normalized = normalizeThemeColor(value);
    if (normalized) {
      // Monaco uses the same color keys as VSCode
      result[key] = normalized;
    }
  }

  return result;
}

/**
 * Convert a VSCode theme to Monaco editor theme format.
 */
export function convertToMonacoTheme(theme: VSCodeTheme): MonacoThemeData {
  return {
    base: getMonacoBase(theme.type),
    inherit: true,
    rules: convertTokenColors(theme.tokenColors ?? []),
    colors: convertColors(theme.colors),
  };
}

/**
 * Register a theme with Monaco editor.
 * Must be called before setting the theme.
 */
export function registerMonacoTheme(
  monaco: typeof import('monaco-editor'),
  name: string,
  theme: MonacoThemeData
): void {
  monaco.editor.defineTheme(name, theme);
}

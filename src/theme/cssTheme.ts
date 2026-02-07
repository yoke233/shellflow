/**
 * Convert VSCode themes to CSS variables for UI elements.
 */

import type { VSCodeColors, CSSThemeVariables, ThemeBorderStyle } from './types';

/**
 * Adjust color brightness.
 * @param hex - Hex color string
 * @param percent - Positive for lighter, negative for darker
 */
function adjustBrightness(hex: string, percent: number): string {
  // Handle rgba
  if (hex.startsWith('rgba')) {
    return hex; // Can't easily adjust rgba
  }

  // Remove # if present
  const color = hex.replace('#', '');
  if (color.length < 6) return hex;

  // Parse RGB
  let r = parseInt(color.slice(0, 2), 16);
  let g = parseInt(color.slice(2, 4), 16);
  let b = parseInt(color.slice(4, 6), 16);

  // Adjust
  r = Math.min(255, Math.max(0, r + (percent / 100) * 255));
  g = Math.min(255, Math.max(0, g + (percent / 100) * 255));
  b = Math.min(255, Math.max(0, b + (percent / 100) * 255));

  // Convert back to hex
  const toHex = (n: number) => Math.round(n).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/**
 * Convert hex color to rgba with alpha.
 */
function hexToRgba(hex: string, alpha: number): string {
  if (hex.startsWith('rgba')) {
    // Already rgba, try to adjust alpha
    return hex.replace(/[\d.]+\)$/, `${alpha})`);
  }
  const color = hex.replace('#', '');
  if (color.length < 6) return hex;
  const r = parseInt(color.slice(0, 2), 16);
  const g = parseInt(color.slice(2, 4), 16);
  const b = parseInt(color.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

/**
 * Default dark theme CSS variables.
 */
const DEFAULT_DARK_CSS: CSSThemeVariables = {
  // Body/document
  '--body-bg': '#09090b',
  '--body-fg': '#fafafa',

  // Backgrounds (from darkest to lightest)
  '--bg-0': '#09090b',      // Darkest - main terminal bg
  '--bg-1': '#18181b',      // Sidebar, drawer bg
  '--bg-2': '#27272a',      // Cards, inputs
  '--bg-3': '#3f3f46',      // Hover states
  '--bg-4': '#52525b',      // Active states

  // Text colors (from brightest to dimmest)
  '--fg-0': '#fafafa',      // Primary text
  '--fg-1': '#e4e4e7',      // Secondary text
  '--fg-2': '#a1a1aa',      // Muted text
  '--fg-3': '#71717a',      // Very muted text
  '--fg-4': '#52525b',      // Labels, hints

  // Borders
  '--border-0': '#27272a',  // Subtle borders
  '--border-1': '#3f3f46',  // Normal borders
  '--border-2': '#52525b',  // Emphasized borders

  // Sidebar
  '--sidebar-bg': '#18181b',
  '--sidebar-fg': '#fafafa',
  '--sidebar-border': '#27272a',
  '--sidebar-item-hover': '#27272a',
  '--sidebar-item-active': '#3f3f46',

  // Modal
  '--modal-bg': 'rgba(39, 39, 42, 0.98)',
  '--modal-border': 'rgba(255, 255, 255, 0.08)',
  '--modal-item-highlight': 'rgba(255, 255, 255, 0.08)',
  '--modal-item-text': 'rgba(255, 255, 255, 0.9)',
  '--modal-item-text-muted': 'rgba(255, 255, 255, 0.5)',
  '--modal-input-bg': 'rgba(0, 0, 0, 0.25)',
  '--modal-input-border': 'rgba(255, 255, 255, 0.1)',
  '--modal-footer-bg': 'rgba(0, 0, 0, 0.15)',
  '--modal-footer-border': 'rgba(255, 255, 255, 0.06)',

  // Buttons
  '--btn-primary-bg': 'rgba(59, 130, 246, 0.8)',
  '--btn-primary-bg-hover': 'rgba(59, 130, 246, 1)',
  '--btn-primary-text': '#ffffff',
  '--btn-secondary-bg': 'rgba(255, 255, 255, 0.08)',
  '--btn-secondary-bg-hover': 'rgba(255, 255, 255, 0.14)',
  '--btn-secondary-text': 'rgba(255, 255, 255, 0.8)',
  '--btn-danger-bg': 'rgba(220, 38, 38, 0.75)',
  '--btn-danger-bg-hover': 'rgba(220, 38, 38, 0.95)',
  '--btn-danger-text': '#ffffff',

  // Keyboard hints
  '--kbd-bg': 'rgba(255, 255, 255, 0.08)',
  '--kbd-border': 'rgba(255, 255, 255, 0.1)',
  '--kbd-text': 'rgba(255, 255, 255, 0.5)',

  // Scrollbar
  '--scrollbar-thumb': 'rgba(255, 255, 255, 0.2)',
  '--scrollbar-thumb-hover': 'rgba(255, 255, 255, 0.35)',

  // Accent color (for selected items, links)
  '--accent': '#60a5fa',
  '--accent-fg': '#ffffff',

  // Status colors
  '--success': '#22c55e',
  '--warning': '#eab308',
  '--error': '#ef4444',
  '--info': '#3b82f6',

  // Panel resize handles
  '--resize-handle': '#3f3f46',
  '--resize-handle-hover': '#52525b',

  // Tab bar
  '--tab-bg': 'transparent',
  '--tab-bg-hover': '#27272a',
  '--tab-bg-active': '#3f3f46',
  '--tab-fg': '#a1a1aa',
  '--tab-fg-active': '#fafafa',
  '--tab-border': '#3f3f46',
};

/**
 * Default light theme CSS variables.
 */
const DEFAULT_LIGHT_CSS: CSSThemeVariables = {
  // Body/document
  '--body-bg': '#ffffff',
  '--body-fg': '#1e1e1e',

  // Backgrounds (from lightest to darkest)
  '--bg-0': '#ffffff',      // Main terminal bg
  '--bg-1': '#f4f4f5',      // Sidebar, drawer bg
  '--bg-2': '#e4e4e7',      // Cards, inputs
  '--bg-3': '#d4d4d8',      // Hover states
  '--bg-4': '#a1a1aa',      // Active states

  // Text colors (from darkest to lightest)
  '--fg-0': '#18181b',      // Primary text
  '--fg-1': '#27272a',      // Secondary text
  '--fg-2': '#52525b',      // Muted text
  '--fg-3': '#71717a',      // Very muted text
  '--fg-4': '#a1a1aa',      // Labels, hints

  // Borders
  '--border-0': '#e4e4e7',  // Subtle borders
  '--border-1': '#d4d4d8',  // Normal borders
  '--border-2': '#a1a1aa',  // Emphasized borders

  // Sidebar
  '--sidebar-bg': '#f4f4f5',
  '--sidebar-fg': '#18181b',
  '--sidebar-border': '#e4e4e7',
  '--sidebar-item-hover': '#e4e4e7',
  '--sidebar-item-active': '#d4d4d8',

  // Modal
  '--modal-bg': 'rgba(255, 255, 255, 0.98)',
  '--modal-border': 'rgba(0, 0, 0, 0.1)',
  '--modal-item-highlight': 'rgba(0, 0, 0, 0.05)',
  '--modal-item-text': 'rgba(0, 0, 0, 0.9)',
  '--modal-item-text-muted': 'rgba(0, 0, 0, 0.5)',
  '--modal-input-bg': 'rgba(0, 0, 0, 0.05)',
  '--modal-input-border': 'rgba(0, 0, 0, 0.15)',
  '--modal-footer-bg': 'rgba(0, 0, 0, 0.03)',
  '--modal-footer-border': 'rgba(0, 0, 0, 0.08)',

  // Buttons
  '--btn-primary-bg': 'rgba(59, 130, 246, 0.9)',
  '--btn-primary-bg-hover': 'rgba(59, 130, 246, 1)',
  '--btn-primary-text': '#ffffff',
  '--btn-secondary-bg': 'rgba(0, 0, 0, 0.06)',
  '--btn-secondary-bg-hover': 'rgba(0, 0, 0, 0.12)',
  '--btn-secondary-text': 'rgba(0, 0, 0, 0.8)',
  '--btn-danger-bg': 'rgba(220, 38, 38, 0.85)',
  '--btn-danger-bg-hover': 'rgba(220, 38, 38, 1)',
  '--btn-danger-text': '#ffffff',

  // Keyboard hints
  '--kbd-bg': 'rgba(0, 0, 0, 0.06)',
  '--kbd-border': 'rgba(0, 0, 0, 0.12)',
  '--kbd-text': 'rgba(0, 0, 0, 0.5)',

  // Scrollbar
  '--scrollbar-thumb': 'rgba(0, 0, 0, 0.2)',
  '--scrollbar-thumb-hover': 'rgba(0, 0, 0, 0.35)',

  // Accent color
  '--accent': '#2563eb',
  '--accent-fg': '#ffffff',

  // Status colors
  '--success': '#16a34a',
  '--warning': '#ca8a04',
  '--error': '#dc2626',
  '--info': '#2563eb',

  // Panel resize handles
  '--resize-handle': '#d4d4d8',
  '--resize-handle-hover': '#a1a1aa',

  // Tab bar
  '--tab-bg': 'transparent',
  '--tab-bg-hover': '#e4e4e7',
  '--tab-bg-active': '#d4d4d8',
  '--tab-fg': '#52525b',
  '--tab-fg-active': '#18181b',
  '--tab-border': '#d4d4d8',
};

/**
 * Convert VSCode colors to CSS variables.
 * @param colors - VSCode theme colors
 * @param themeType - Theme type ('light' or 'dark')
 * @param borderStyle - How to handle borders: 'theme' (use as-is), 'subtle' (add subtle if missing), 'visible' (ensure visible)
 */
export function convertToCSSVariables(
  colors: VSCodeColors,
  themeType: 'light' | 'dark' = 'dark',
  borderStyle: ThemeBorderStyle = 'subtle'
): CSSThemeVariables {
  const defaults = themeType === 'light' ? DEFAULT_LIGHT_CSS : DEFAULT_DARK_CSS;
  const result = { ...defaults };

  // Get key colors from theme
  const editorBg = colors['editor.background'];
  const editorFg = colors['editor.foreground'];
  const sidebarBg = colors['sideBar.background'];
  const sidebarFg = colors['sideBar.foreground'];
  const inputBg = colors['input.background'];
  const buttonBg = colors['button.background'];
  const buttonFg = colors['button.foreground'];
  const listHover = colors['list.hoverBackground'];
  const listActive = colors['list.activeSelectionBackground'];

  // Body colors
  if (editorBg) {
    result['--body-bg'] = editorBg;
    result['--bg-0'] = editorBg;
  }
  if (editorFg) {
    result['--body-fg'] = editorFg;
    result['--fg-0'] = editorFg;
  }

  // Generate background scale from editor background
  if (editorBg) {
    const isLight = themeType === 'light';
    result['--bg-1'] = adjustBrightness(editorBg, isLight ? -3 : 5);
    result['--bg-2'] = adjustBrightness(editorBg, isLight ? -8 : 12);
    result['--bg-3'] = adjustBrightness(editorBg, isLight ? -15 : 20);
    result['--bg-4'] = adjustBrightness(editorBg, isLight ? -25 : 30);
  }

  // Generate foreground scale
  if (editorFg) {
    result['--fg-1'] = hexToRgba(editorFg, 0.85);
    result['--fg-2'] = hexToRgba(editorFg, 0.6);
    result['--fg-3'] = hexToRgba(editorFg, 0.45);
    result['--fg-4'] = hexToRgba(editorFg, 0.35);
  }

  // Borders - behavior depends on borderStyle setting
  if (borderStyle === 'theme') {
    // Use exactly what theme specifies
    const themeBorder = colors['sideBar.border'] || colors['panel.border'] || colors['editorGroup.border'];
    if (themeBorder) {
      result['--border-0'] = themeBorder;
      result['--border-1'] = themeBorder;
      result['--border-2'] = themeBorder;
    }
  } else if (borderStyle === 'visible') {
    // 'visible' mode: always derive solid borders from background for high contrast
    if (editorBg) {
      result['--border-0'] = adjustBrightness(editorBg, themeType === 'light' ? -12 : 18);
      result['--border-1'] = adjustBrightness(editorBg, themeType === 'light' ? -18 : 25);
      result['--border-2'] = adjustBrightness(editorBg, themeType === 'light' ? -25 : 35);
    }
  } else if (borderStyle === 'subtle') {
    // 'subtle' mode: always use low opacity foreground for minimal visual separation
    if (editorFg) {
      result['--border-0'] = hexToRgba(editorFg, themeType === 'light' ? 0.08 : 0.1);
      result['--border-1'] = hexToRgba(editorFg, themeType === 'light' ? 0.12 : 0.15);
      result['--border-2'] = hexToRgba(editorFg, themeType === 'light' ? 0.18 : 0.22);
    }
  }

  // Sidebar
  if (sidebarBg) {
    result['--sidebar-bg'] = sidebarBg;
    result['--bg-1'] = sidebarBg;
    result['--sidebar-item-hover'] = adjustBrightness(sidebarBg, themeType === 'light' ? -5 : 8);
    result['--sidebar-item-active'] = adjustBrightness(sidebarBg, themeType === 'light' ? -10 : 15);
  }
  if (sidebarFg) {
    result['--sidebar-fg'] = sidebarFg;
  } else if (editorFg) {
    // Derive sidebar foreground from editor foreground
    result['--sidebar-fg'] = editorFg;
  }
  // Sidebar border - behavior depends on borderStyle setting
  if (borderStyle === 'theme') {
    // Use exactly what theme specifies, even if transparent
    if (colors['sideBar.border']) {
      result['--sidebar-border'] = colors['sideBar.border'];
    }
  } else if (borderStyle === 'visible') {
    // 'visible' mode: derive solid border from sidebar background
    if (sidebarBg) {
      result['--sidebar-border'] = adjustBrightness(sidebarBg, themeType === 'light' ? -12 : 18);
    } else if (editorBg) {
      result['--sidebar-border'] = adjustBrightness(editorBg, themeType === 'light' ? -12 : 18);
    }
  } else if (borderStyle === 'subtle') {
    // 'subtle' mode: use low opacity foreground
    if (editorFg) {
      result['--sidebar-border'] = hexToRgba(editorFg, themeType === 'light' ? 0.08 : 0.1);
    }
  }

  // Modal colors
  const dropdownBg = colors['dropdown.background'] || colors['quickInput.background'];
  if (dropdownBg) {
    result['--modal-bg'] = hexToRgba(dropdownBg, 0.98);
  }
  if (listHover) {
    result['--modal-item-highlight'] = listHover;
    result['--sidebar-item-hover'] = listHover;
  }
  if (listActive) {
    result['--sidebar-item-active'] = listActive;
  }
  if (inputBg) {
    result['--modal-input-bg'] = inputBg;
    result['--bg-2'] = inputBg;
  }

  // Buttons
  if (buttonBg) {
    result['--btn-primary-bg'] = buttonBg;
    result['--btn-primary-bg-hover'] = adjustBrightness(buttonBg, 10);
    result['--accent'] = buttonBg;
  }
  if (buttonFg) {
    result['--btn-primary-text'] = buttonFg;
    result['--accent-fg'] = buttonFg;
  }
  if (colors['button.secondaryBackground']) {
    result['--btn-secondary-bg'] = colors['button.secondaryBackground'];
    result['--btn-secondary-bg-hover'] = adjustBrightness(colors['button.secondaryBackground'], 10);
  }
  if (colors['button.secondaryForeground']) {
    result['--btn-secondary-text'] = colors['button.secondaryForeground'];
  }

  // Scrollbar
  if (colors['scrollbarSlider.background']) {
    result['--scrollbar-thumb'] = colors['scrollbarSlider.background'];
  }
  if (colors['scrollbarSlider.hoverBackground']) {
    result['--scrollbar-thumb-hover'] = colors['scrollbarSlider.hoverBackground'];
  }

  // Resize handles - follow same logic as borders
  if (borderStyle === 'theme') {
    const themeBorder = colors['sideBar.border'] || colors['panel.border'] || colors['editorGroup.border'];
    if (themeBorder) {
      result['--resize-handle'] = themeBorder;
      result['--resize-handle-hover'] = themeBorder;
    }
  } else if (borderStyle === 'visible' && editorBg) {
    // Slightly softer than borders for a calmer divider
    result['--resize-handle'] = adjustBrightness(editorBg, themeType === 'light' ? -12 : 18);
    result['--resize-handle-hover'] = adjustBrightness(editorBg, themeType === 'light' ? -18 : 26);
  } else if (borderStyle === 'subtle' && editorFg) {
    // Lower opacity for a softer split line
    result['--resize-handle'] = hexToRgba(editorFg, themeType === 'light' ? 0.08 : 0.1);
    result['--resize-handle-hover'] = hexToRgba(editorFg, themeType === 'light' ? 0.14 : 0.18);
  }

  // Tab bar
  if (colors['tab.inactiveBackground']) {
    result['--tab-bg'] = colors['tab.inactiveBackground'];
  }
  if (colors['tab.hoverBackground']) {
    result['--tab-bg-hover'] = colors['tab.hoverBackground'];
  }
  if (colors['tab.activeBackground']) {
    result['--tab-bg-active'] = colors['tab.activeBackground'];
  }
  if (colors['tab.inactiveForeground']) {
    result['--tab-fg'] = colors['tab.inactiveForeground'];
  }
  if (colors['tab.activeForeground']) {
    result['--tab-fg-active'] = colors['tab.activeForeground'];
  }
  if (colors['tab.border']) {
    result['--tab-border'] = colors['tab.border'];
  }

  // Status colors
  if (colors['notificationsInfoIcon.foreground']) {
    result['--info'] = colors['notificationsInfoIcon.foreground'];
  }
  if (colors['notificationsWarningIcon.foreground']) {
    result['--warning'] = colors['notificationsWarningIcon.foreground'];
  }
  if (colors['notificationsErrorIcon.foreground']) {
    result['--error'] = colors['notificationsErrorIcon.foreground'];
  }

  return result;
}

/**
 * Apply CSS variables to the document root.
 */
export function applyCSSVariables(variables: CSSThemeVariables): void {
  const root = document.documentElement;

  for (const [key, value] of Object.entries(variables)) {
    root.style.setProperty(key, value);
  }

  // Update color-scheme for proper native scrollbar colors
  const bodyBg = variables['--body-bg'];
  if (bodyBg) {
    const isLight = isLightColor(bodyBg);
    root.style.colorScheme = isLight ? 'light' : 'dark';
  }
}

/**
 * Check if a color is considered light.
 */
function isLightColor(color: string): boolean {
  // Handle rgba
  if (color.startsWith('rgba')) {
    const match = color.match(/rgba\((\d+),\s*(\d+),\s*(\d+)/);
    if (match) {
      const [, r, g, b] = match.map(Number);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance > 0.5;
    }
  }

  // Handle hex
  const hex = color.replace('#', '');
  if (hex.length >= 6) {
    const r = parseInt(hex.slice(0, 2), 16);
    const g = parseInt(hex.slice(2, 4), 16);
    const b = parseInt(hex.slice(4, 6), 16);
    const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    return luminance > 0.5;
  }

  return false;
}

/**
 * Get default CSS variables.
 */
export function getDefaultCSSVariables(themeType: 'light' | 'dark' = 'dark'): CSSThemeVariables {
  return themeType === 'light' ? { ...DEFAULT_LIGHT_CSS } : { ...DEFAULT_DARK_CSS };
}

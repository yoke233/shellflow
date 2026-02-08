/**
 * VSCode theme type definitions and Shellflow theme configuration types.
 */

// ============================================================================
// VSCode Theme Types (from theme JSON files)
// ============================================================================

/** A single token color rule in a VSCode theme */
export interface VSCodeTokenColor {
  name?: string;
  scope: string | string[];
  settings: {
    foreground?: string;
    background?: string;
    fontStyle?: string;
  };
}

/** VSCode theme colors object (editor.background, terminal.foreground, etc.) */
export type VSCodeColors = Record<string, string>;

/** A VSCode theme JSON file structure */
export interface VSCodeTheme {
  name?: string;
  type?: 'light' | 'dark' | 'hc' | 'hcLight';
  colors?: VSCodeColors;
  tokenColors?: VSCodeTokenColor[];
  /** Some themes use semanticHighlighting */
  semanticHighlighting?: boolean;
  /** Some themes include other themes */
  include?: string;
}

// ============================================================================
// Shellflow Theme Configuration
// ============================================================================

/**
 * Theme configuration in shellflow config.
 * Can be:
 * - A single theme name (string): ignores system preference
 * - An object with light/dark: switches based on system preference
 */
export type ThemeConfig =
  | string
  | {
      light: string;
      dark: string;
    };

/** Default theme configuration (uses light/dark object form) */
export const DEFAULT_THEME_CONFIG = {
  light: 'Catppuccin Latte',
  dark: 'Catppuccin Mocha',
} as const;

// ============================================================================
// Theme Info (from backend)
// ============================================================================

/** Information about an available theme */
export interface ThemeInfo {
  /** Display name of the theme */
  name: string;
  /** Full path to the theme file */
  path: string;
  /** Source location: 'bundled' or 'user' */
  source: 'bundled' | 'user';
  /** Theme type if detected */
  type?: 'light' | 'dark';
}

// ============================================================================
// Resolved Theme Types (after conversion)
// ============================================================================

/** xterm.js ITheme interface */
export interface XtermTheme {
  background?: string;
  foreground?: string;
  cursor?: string;
  cursorAccent?: string;
  selectionBackground?: string;
  selectionForeground?: string;
  selectionInactiveBackground?: string;
  black?: string;
  red?: string;
  green?: string;
  yellow?: string;
  blue?: string;
  magenta?: string;
  cyan?: string;
  white?: string;
  brightBlack?: string;
  brightRed?: string;
  brightGreen?: string;
  brightYellow?: string;
  brightBlue?: string;
  brightMagenta?: string;
  brightCyan?: string;
  brightWhite?: string;
}

/** Monaco editor theme definition */
export interface MonacoThemeData {
  base: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
  inherit: boolean;
  rules: MonacoTokenRule[];
  colors: Record<string, string>;
}

/** A single token rule for Monaco */
export interface MonacoTokenRule {
  token: string;
  foreground?: string;
  background?: string;
  fontStyle?: string;
}

/** CSS variables generated from theme */
export interface CSSThemeVariables {
  // Body/document
  '--body-bg': string;
  '--body-fg': string;

  // Sidebar
  '--sidebar-bg': string;
  '--sidebar-fg': string;
  '--sidebar-border': string;

  // Modal
  '--modal-bg': string;
  '--modal-border': string;
  '--modal-item-highlight': string;
  '--modal-item-text': string;
  '--modal-item-text-muted': string;
  '--modal-error-bg': string;
  '--modal-error-border': string;
  '--modal-error-text': string;
  '--modal-input-bg': string;
  '--modal-input-border': string;
  '--modal-footer-bg': string;
  '--modal-footer-border': string;

  // Buttons
  '--btn-primary-bg': string;
  '--btn-primary-bg-hover': string;
  '--btn-primary-text': string;
  '--btn-secondary-bg': string;
  '--btn-secondary-bg-hover': string;
  '--btn-secondary-text': string;
  '--btn-danger-bg': string;
  '--btn-danger-bg-hover': string;
  '--btn-danger-text': string;

  // Keyboard hints
  '--kbd-bg': string;
  '--kbd-border': string;
  '--kbd-text': string;

  // Scrollbar
  '--scrollbar-thumb': string;
  '--scrollbar-thumb-hover': string;

  // Allow additional variables
  [key: string]: string;
}

/** Complete resolved theme with all conversions */
export interface ResolvedTheme {
  /** Original theme name */
  name: string;
  /** Theme type */
  type: 'light' | 'dark';
  /** Monaco theme data */
  monaco: MonacoThemeData;
  /** xterm.js theme for main terminal */
  xterm: XtermTheme;
  /** xterm.js theme for drawer (uses sideBar.background) */
  xtermDrawer: XtermTheme;
  /** CSS variables for UI elements */
  css: CSSThemeVariables;
  /** Raw VSCode colors for reference */
  colors: VSCodeColors;
}

// ============================================================================
// Theme Context Value
// ============================================================================

/** Border style options */
export type ThemeBorderStyle = 'theme' | 'subtle' | 'visible';

/** Value provided by ThemeContext */
export interface ThemeContextValue {
  /** Current resolved theme */
  theme: ResolvedTheme | null;
  /** List of available themes */
  availableThemes: ThemeInfo[];
  /** Current theme name */
  currentThemeName: string;
  /** Current color scheme (system preference or forced) */
  colorScheme: 'light' | 'dark';
  /** Current border style */
  borderStyle: ThemeBorderStyle;
  /** Whether theme is currently loading */
  loading: boolean;
  /** Set theme by name (updates config) */
  setTheme: (name: string) => void;
  /** Set border style */
  setBorderStyle: (style: ThemeBorderStyle) => void;
  /** Force a specific color scheme (null to use system) */
  forceColorScheme: (scheme: 'light' | 'dark' | null) => void;
}

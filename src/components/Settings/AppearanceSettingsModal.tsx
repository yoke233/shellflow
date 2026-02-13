import { useCallback, useEffect, useMemo, useState } from 'react';
import type { CSSProperties } from 'react';
import { X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { useTheme } from '../../theme';
import type { ThemeBorderStyle } from '../../theme/types';
import type { TerminalWebglMode } from '../../hooks/useConfig';
import {
  Modal,
  ModalBody,
  ModalActions,
  ModalButton,
  ModalText,
  ModalList,
  ModalListItem,
  ModalSearchInput,
} from '../Modal';

type SystemFontFamily = {
  family: string;
};

const FONT_SUGGESTIONS = [
  'JetBrains Mono',
  'Fira Code',
  'Cascadia Code',
  'Cascadia Mono',
  'CaskaydiaCove Nerd Font',
  'CaskaydiaMono Nerd Font',
  'Iosevka',
  'Monaspace Neon',
  'Monaspace Argon',
  'SF Mono',
  'Menlo',
  'Consolas',
  'Source Code Pro',
  'IBM Plex Mono',
  'Ubuntu Mono',
  'Hack',
];

const FONT_PRIORITY_KEYWORDS = [
  'mono',
  'monospace',
  'monospaced',
  'code',
  'console',
  'terminal',
  'fixed',
  'nerd',
  'typewriter',
];

const FONT_SIZE_MIN = 10;
const FONT_SIZE_MAX = 24;

const FONT_ALIAS_MAP: Record<string, string> = {
  'cascadiamono-nf': 'CaskaydiaMono Nerd Font',
  'cascadia mono nf': 'CaskaydiaMono Nerd Font',
  'cascadiamono nf': 'CaskaydiaMono Nerd Font',
  'cascadia mono nerd font': 'CaskaydiaMono Nerd Font',
  'cascadiacode-nf': 'CaskaydiaCove Nerd Font',
  'cascadia code nf': 'CaskaydiaCove Nerd Font',
  'cascadiacode nf': 'CaskaydiaCove Nerd Font',
  'cascadia code nerd font': 'CaskaydiaCove Nerd Font',
};

const WEBGL_MODE_OPTIONS: Array<{ value: TerminalWebglMode; label: string; description: string }> = [
  { value: 'off', label: 'Off', description: 'Always use canvas renderer.' },
  { value: 'auto', label: 'Auto', description: 'Use WebGL only for active terminal; auto fallback on instability.' },
  { value: 'on', label: 'On', description: 'Force WebGL unless ligatures disable it.' },
];

function normalizeFontFamily(input: string): string {
  const trimmed = input.trim();
  const key = trimmed.toLowerCase();
  return FONT_ALIAS_MAP[key] ?? trimmed;
}

function isPreferredFont(name: string): boolean {
  const lower = name.toLowerCase();
  return FONT_PRIORITY_KEYWORDS.some((keyword) => lower.includes(keyword));
}

function sortFontFamilies(fonts: string[]): string[] {
  const unique = new Map<string, string>();
  for (const font of fonts) {
    const trimmed = font.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (!unique.has(key)) {
      unique.set(key, trimmed);
    }
  }

  const list = Array.from(unique.values());
  list.sort((a, b) => {
    const aPreferred = isPreferredFont(a) ? 0 : 1;
    const bPreferred = isPreferredFont(b) ? 0 : 1;
    if (aPreferred !== bPreferred) return aPreferred - bPreferred;
    return a.localeCompare(b, undefined, { sensitivity: 'base' });
  });
  return list;
}

export type FontSettingsPatch = {
  fontFamily?: string;
  fontSize?: number;
  fontLigatures?: boolean;
  webgl?: TerminalWebglMode;
};

interface AppearanceSettingsModalProps {
  onClose: () => void;
  borderStyle: ThemeBorderStyle;
  fontFamily: string;
  fontSize: number;
  fontLigatures: boolean;
  webgl: TerminalWebglMode;
  onFontChange: (patch: FontSettingsPatch) => void;
  onBorderStyleChange: (style: ThemeBorderStyle) => void;
  onModalOpen?: () => void;
  onModalClose?: () => void;
}

export function AppearanceSettingsModal({
  onClose,
  borderStyle,
  fontFamily,
  fontSize,
  fontLigatures,
  webgl,
  onFontChange,
  onBorderStyleChange,
  onModalOpen,
  onModalClose,
}: AppearanceSettingsModalProps) {
  const [query, setQuery] = useState('');
  const [fontFamilyInput, setFontFamilyInput] = useState(fontFamily);
  const [fontSizeInput, setFontSizeInput] = useState(fontSize);
  const [systemFonts, setSystemFonts] = useState<string[]>([]);
  const [showAllFonts, setShowAllFonts] = useState(false);

  const { availableThemes, currentThemeName, colorScheme, setTheme } = useTheme();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const fonts = await invoke<SystemFontFamily[]>('list_system_fonts');
        if (cancelled) return;
        const families = fonts.map((font) => font.family);
        setSystemFonts(families);
      } catch (err) {
        console.warn('Failed to load system fonts:', err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    setFontFamilyInput(fontFamily);
  }, [fontFamily]);

  useEffect(() => {
    setFontSizeInput(fontSize);
  }, [fontSize]);

  const filteredThemes = useMemo(() => {
    if (!query.trim()) return availableThemes;

    const lowerQuery = query.toLowerCase();
    return availableThemes.filter((theme) => theme.name.toLowerCase().includes(lowerQuery));
  }, [availableThemes, query]);

  const fontSuggestions = useMemo(() => {
    const baseFonts = systemFonts.length > 0 ? systemFonts : FONT_SUGGESTIONS;
    const sorted = sortFontFamilies(baseFonts);
    if (showAllFonts) return sorted;
    const preferred = sorted.filter((font) => isPreferredFont(font));
    return preferred.length > 0 ? preferred : sorted;
  }, [systemFonts, showAllFonts]);

  const handleSelectTheme = useCallback((themeName: string) => {
    setTheme(themeName);
  }, [setTheme]);

  const clampFontSize = useCallback((value: number) => {
    if (Number.isNaN(value)) return fontSize;
    return Math.min(FONT_SIZE_MAX, Math.max(FONT_SIZE_MIN, value));
  }, [fontSize]);

  const commitFontFamily = useCallback(() => {
    const next = normalizeFontFamily(fontFamilyInput);
    if (!next) {
      setFontFamilyInput(fontFamily);
      return;
    }
    if (next !== fontFamily) {
      onFontChange({ fontFamily: next });
    }
    if (next !== fontFamilyInput) {
      setFontFamilyInput(next);
    }
  }, [fontFamilyInput, fontFamily, onFontChange]);

  const commitFontSize = useCallback((value: number) => {
    const next = clampFontSize(value);
    setFontSizeInput(next);
    if (next !== fontSize) {
      onFontChange({ fontSize: next });
    }
  }, [clampFontSize, fontSize, onFontChange]);

  const borderOptions: Array<{ value: ThemeBorderStyle; label: string; description: string }> = [
    { value: 'theme', label: 'Theme', description: 'Use theme borders as-is.' },
    { value: 'subtle', label: 'Subtle', description: 'Add minimal separators.' },
    { value: 'visible', label: 'Visible', description: 'Always show borders.' },
  ];

  const inputStyle: CSSProperties = {
    background: 'var(--modal-input-bg)',
    border: '1px solid var(--modal-input-border)',
    color: 'var(--modal-item-text)',
  };

  const handleFontSizeInput = (value: string) => {
    const parsed = Number(value);
    if (Number.isNaN(parsed)) {
      setFontSizeInput(fontSize);
      return;
    }
    setFontSizeInput(parsed);
  };

  return (
    <Modal
      onClose={onClose}
      onModalOpen={onModalOpen}
      onModalClose={onModalClose}
      widthClass="max-w-2xl"
      closeOnBackdrop={false}
    >
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-[15px] font-semibold" style={{ color: 'var(--modal-item-text)' }}>
          Appearance
        </h2>
        <button
          onClick={onClose}
          className="modal-toggle p-1 rounded"
          aria-label="Close"
        >
          <X size={14} />
        </button>
      </div>

      <ModalBody>
        <div className="space-y-5">
          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: 'var(--modal-item-text-muted)' }}>
              Theme
            </label>
            <div
              className="rounded-md overflow-hidden"
              style={{ border: '1px solid var(--modal-input-border)' }}
            >
              <ModalSearchInput
                value={query}
                onChange={setQuery}
                placeholder="Search themes..."
              />
              <ModalList isEmpty={filteredThemes.length === 0} emptyMessage="No themes found">
                {filteredThemes.map((theme) => {
                  const isSelected = theme.name === currentThemeName;
                  return (
                    <ModalListItem
                      key={theme.path}
                      onClick={() => handleSelectTheme(theme.name)}
                      rightContent={
                        <div className="flex items-center gap-2">
                          {theme.type && (
                            <span
                              className="text-xs px-1.5 py-0.5 rounded"
                              style={{
                                backgroundColor:
                                  theme.type === 'dark'
                                    ? 'rgba(0,0,0,0.3)'
                                    : 'rgba(255,255,255,0.2)',
                                color: 'var(--modal-item-text-muted)',
                              }}
                            >
                              {theme.type === 'dark' ? 'Dark' : 'Light'}
                            </span>
                          )}
                          {theme.source === 'user' && (
                            <span className="text-xs" style={{ color: 'var(--modal-item-text-muted)' }}>
                              Custom
                            </span>
                          )}
                        </div>
                      }
                    >
                      <div
                        className="text-sm truncate"
                        style={{ color: isSelected ? 'rgb(96, 165, 250)' : undefined }}
                      >
                        {theme.name}
                        {isSelected && (
                          <span className="ml-2 text-xs" style={{ color: 'var(--modal-item-text-muted)' }}>
                            (current)
                          </span>
                        )}
                      </div>
                    </ModalListItem>
                  );
                })}
              </ModalList>
            </div>
            <ModalText muted size="xs">
              System: {colorScheme}
            </ModalText>
          </div>

          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: 'var(--modal-item-text-muted)' }}>
              Border Style
            </label>
            <div className="flex gap-1.5">
              {borderOptions.map((option) => (
                <button
                  key={option.value}
                  onClick={() => onBorderStyleChange(option.value)}
                  className="modal-toggle flex-1 px-2.5 py-1.5 text-[13px] rounded-[4px] border transition-all duration-100"
                  style={{
                    background: borderStyle === option.value ? 'var(--modal-item-highlight)' : 'transparent',
                    borderColor: 'var(--modal-input-border)',
                    color: borderStyle === option.value ? 'var(--modal-item-text)' : 'var(--modal-item-text-muted)',
                  }}
                >
                  {option.label}
                </button>
              ))}
            </div>
            <ModalText muted size="xs">
              {borderOptions.find((option) => option.value === borderStyle)?.description}
            </ModalText>
          </div>

          <div>
            <label className="block text-[12px] font-medium mb-2" style={{ color: 'var(--modal-item-text-muted)' }}>
              Font
            </label>
            <div className="space-y-3">
              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-[12px] mb-1" style={{ color: 'var(--modal-item-text-muted)' }}>
                    Font family
                  </label>
                  <label className="flex items-center gap-2 text-[11px] cursor-pointer mb-1" style={{ color: 'var(--modal-item-text-muted)' }}>
                    <input
                      type="checkbox"
                      checked={showAllFonts}
                      onChange={(e) => setShowAllFonts(e.target.checked)}
                      className="rounded border-theme-1 bg-theme-3/50 text-blue-500 focus:ring-blue-500 focus:ring-offset-theme-2"
                    />
                    Show all fonts
                  </label>
                </div>
                <input
                  list="font-suggestions"
                  value={fontFamilyInput}
                  onChange={(e) => setFontFamilyInput(e.target.value)}
                  onBlur={commitFontFamily}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      commitFontFamily();
                    }
                  }}
                  className="w-full text-sm px-2.5 py-1.5 rounded focus:outline-none placeholder-theme-3 transition-colors"
                  style={inputStyle}
                  placeholder="e.g. JetBrains Mono, Fira Code"
                />
                <datalist id="font-suggestions">
                  {fontSuggestions.map((font) => (
                    <option key={font} value={font} />
                  ))}
                </datalist>
              </div>

              <div className="flex flex-wrap gap-3 items-center">
                <div className="min-w-[120px]">
                  <label className="block text-[12px] mb-1" style={{ color: 'var(--modal-item-text-muted)' }}>
                    Size
                  </label>
                  <input
                    type="number"
                    min={FONT_SIZE_MIN}
                    max={FONT_SIZE_MAX}
                    value={fontSizeInput}
                    onChange={(e) => handleFontSizeInput(e.target.value)}
                    onBlur={() => commitFontSize(fontSizeInput)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        commitFontSize(fontSizeInput);
                      }
                    }}
                    className="w-28 text-sm px-2.5 py-1.5 rounded focus:outline-none transition-colors"
                    style={inputStyle}
                  />
                </div>

                <label className="flex items-center gap-2 text-[13px] cursor-pointer mt-5" style={{ color: 'var(--modal-item-text)' }}>
                  <input
                    type="checkbox"
                    checked={fontLigatures}
                    onChange={(e) => onFontChange({ fontLigatures: e.target.checked })}
                    className="rounded border-theme-1 bg-theme-3/50 text-blue-500 focus:ring-blue-500 focus:ring-offset-theme-2"
                  />
                  Ligatures
                </label>

                <div className="mt-3 min-w-[260px]">
                  <label className="block text-[12px] mb-1" style={{ color: 'var(--modal-item-text-muted)' }}>
                    WebGL Renderer
                  </label>
                  <div className="flex gap-1.5">
                    {WEBGL_MODE_OPTIONS.map((option) => (
                      <button
                        key={option.value}
                        onClick={() => onFontChange({ webgl: option.value })}
                        className="modal-toggle flex-1 px-2.5 py-1.5 text-[12px] rounded-[4px] border transition-all duration-100"
                        style={{
                          background: webgl === option.value ? 'var(--modal-item-highlight)' : 'transparent',
                          borderColor: 'var(--modal-input-border)',
                          color: webgl === option.value ? 'var(--modal-item-text)' : 'var(--modal-item-text-muted)',
                        }}
                        title={option.description}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
              <ModalText muted size="xs">
                建议 Windows 使用 Auto；出现渲染异常会自动熔断回退到 canvas。
              </ModalText>

              <div
                className="rounded px-2.5 py-2 text-xs"
                style={{
                  ...inputStyle,
                  fontFamily: fontFamilyInput,
                  fontSize: `${fontSizeInput}px`,
                  fontVariantLigatures: fontLigatures ? 'normal' : 'none',
                }}
              >
                The quick brown fox jumps over the lazy dog. 0123456789
              </div>
            </div>
          </div>
        </div>
      </ModalBody>

      <ModalActions>
        <ModalButton onClick={onClose} variant="primary">Done</ModalButton>
      </ModalActions>
    </Modal>
  );
}

import { describe, it, expect } from 'vitest';
import {
  normalizeKey,
  parseMappings,
  mergeMappings,
  resolveBinding,
  getActiveBindings,
  getKeyForAction,
  getAllKeysForAction,
  formatKeyString,
  keyEventToString,
  isValidActionId,
  parseActionId,
  validateMappings,
  type RawMappings,
} from './mappings';
import type { ContextFlag } from './contexts';

// Helper to create context sets
function contexts(...flags: ContextFlag[]): Set<ContextFlag> {
  return new Set(flags);
}

describe('normalizeKey', () => {
  it('converts to lowercase', () => {
    expect(normalizeKey('Cmd-W')).toBe('cmd-w');
    expect(normalizeKey('CMD-SHIFT-P')).toBe('cmd-shift-p');
  });

  it('converts + to -', () => {
    expect(normalizeKey('cmd+w')).toBe('cmd-w');
    expect(normalizeKey('ctrl+shift+p')).toBe('ctrl-shift-p');
  });

  it('handles mixed formats', () => {
    expect(normalizeKey('Cmd+Shift-W')).toBe('cmd-shift-w');
  });

  it('trims whitespace', () => {
    expect(normalizeKey('  cmd-w  ')).toBe('cmd-w');
  });
});

describe('parseMappings', () => {
  it('parses simple mappings', () => {
    const raw: RawMappings = {
      bindings: [
        {
          bindings: {
            'cmd-w': 'scratch::close',
          },
        },
      ],
    };

    const parsed = parseMappings(raw);
    expect(parsed.groups).toHaveLength(1);
    expect(parsed.groups[0].context).toBeNull();
    expect(parsed.groups[0].bindings.get('cmd-w')).toBe('scratch::close');
  });

  it('parses context expressions', () => {
    const raw: RawMappings = {
      bindings: [
        {
          context: 'drawerFocused',
          bindings: {
            'cmd-w': 'drawer::closeTab',
          },
        },
      ],
    };

    const parsed = parseMappings(raw);
    expect(parsed.groups[0].context).not.toBeNull();
    expect(parsed.groups[0].context?.source).toBe('drawerFocused');
  });

  it('normalizes keys during parsing', () => {
    const raw: RawMappings = {
      bindings: [
        {
          bindings: {
            'Cmd+W': 'scratch::close',
          },
        },
      ],
    };

    const parsed = parseMappings(raw);
    expect(parsed.groups[0].bindings.get('cmd-w')).toBe('scratch::close');
    expect(parsed.groups[0].bindings.has('Cmd+W')).toBe(false);
  });

  it('parses actions with arguments', () => {
    const raw: RawMappings = {
      bindings: [
        {
          bindings: {
            'cmd-1': ['navigate::toEntity', 0],
          },
        },
      ],
    };

    const parsed = parseMappings(raw);
    const action = parsed.groups[0].bindings.get('cmd-1');
    expect(action).toEqual(['navigate::toEntity', 0]);
  });
});

describe('mergeMappings', () => {
  it('concatenates binding groups', () => {
    const defaults = parseMappings({
      bindings: [{ bindings: { 'cmd-w': 'scratch::close' } }],
    });

    const user = parseMappings({
      bindings: [{ bindings: { 'cmd-q': 'app::quit' } }],
    });

    const merged = mergeMappings(defaults, user);
    expect(merged.groups).toHaveLength(2);
  });

  it('preserves order for precedence', () => {
    const defaults = parseMappings({
      bindings: [{ bindings: { 'cmd-w': 'scratch::close' } }],
    });

    const user = parseMappings({
      bindings: [{ bindings: { 'cmd-w': 'app::quit' } }],
    });

    const merged = mergeMappings(defaults, user);
    // Later (user) should take precedence
    const result = resolveBinding('cmd-w', contexts(), merged);
    expect(result?.actionId).toBe('app::quit');
  });
});

describe('resolveBinding', () => {
  it('resolves simple binding without context', () => {
    const mappings = parseMappings({
      bindings: [
        {
          bindings: {
            'cmd-shift-p': 'palette::toggle',
          },
        },
      ],
    });

    const result = resolveBinding('cmd-shift-p', contexts(), mappings);
    expect(result).not.toBeNull();
    expect(result?.actionId).toBe('palette::toggle');
    expect(result?.args).toEqual([]);
    expect(result?.context).toBeNull();
  });

  it('resolves binding with matching context', () => {
    const mappings = parseMappings({
      bindings: [
        {
          context: 'drawerFocused',
          bindings: {
            'cmd-w': 'drawer::closeTab',
          },
        },
      ],
    });

    const result = resolveBinding('cmd-w', contexts('drawerFocused'), mappings);
    expect(result?.actionId).toBe('drawer::closeTab');
    expect(result?.context).toBe('drawerFocused');
  });

  it('does not resolve binding with non-matching context', () => {
    const mappings = parseMappings({
      bindings: [
        {
          context: 'drawerFocused',
          bindings: {
            'cmd-w': 'drawer::closeTab',
          },
        },
      ],
    });

    const result = resolveBinding('cmd-w', contexts('mainFocused'), mappings);
    expect(result).toBeNull();
  });

  it('resolves with correct priority (later wins)', () => {
    const mappings = parseMappings({
      bindings: [
        {
          bindings: { 'cmd-w': 'scratch::close' },
        },
        {
          context: 'drawerFocused',
          bindings: { 'cmd-w': 'drawer::closeTab' },
        },
      ],
    });

    // When drawer is focused, drawer binding should win
    const withDrawer = resolveBinding('cmd-w', contexts('drawerFocused'), mappings);
    expect(withDrawer?.actionId).toBe('drawer::closeTab');

    // When drawer is not focused, fall back to global
    const withoutDrawer = resolveBinding('cmd-w', contexts('mainFocused'), mappings);
    expect(withoutDrawer?.actionId).toBe('scratch::close');
  });

  it('resolves action with arguments', () => {
    const mappings = parseMappings({
      bindings: [
        {
          bindings: {
            'cmd-1': ['navigate::toEntity', 0],
          },
        },
      ],
    });

    const result = resolveBinding('cmd-1', contexts(), mappings);
    expect(result?.actionId).toBe('navigate::toEntity');
    expect(result?.args).toEqual([0]);
  });

  it('returns null for unknown key', () => {
    const mappings = parseMappings({
      bindings: [{ bindings: { 'cmd-w': 'scratch::close' } }],
    });

    const result = resolveBinding('cmd-q', contexts(), mappings);
    expect(result).toBeNull();
  });

  it('normalizes input key', () => {
    const mappings = parseMappings({
      bindings: [{ bindings: { 'cmd-w': 'scratch::close' } }],
    });

    // Should match regardless of format
    expect(resolveBinding('CMD-W', contexts(), mappings)?.actionId).toBe('scratch::close');
    expect(resolveBinding('cmd+w', contexts(), mappings)?.actionId).toBe('scratch::close');
  });
});

describe('getActiveBindings', () => {
  it('returns all bindings for matching contexts', () => {
    const mappings = parseMappings({
      bindings: [
        { bindings: { 'cmd-p': 'palette::toggle' } },
        {
          context: 'drawerFocused',
          bindings: { 'cmd-w': 'drawer::closeTab' },
        },
        {
          context: 'scratchFocused',
          bindings: { 'cmd-w': 'scratch::close' },
        },
      ],
    });

    const active = getActiveBindings(contexts('drawerFocused'), mappings);
    expect(active.get('cmd-p')?.actionId).toBe('palette::toggle');
    expect(active.get('cmd-w')?.actionId).toBe('drawer::closeTab');
  });

  it('later bindings override earlier for same key', () => {
    const mappings = parseMappings({
      bindings: [
        { bindings: { 'cmd-w': 'first::action' } },
        { bindings: { 'cmd-w': 'second::action' } },
      ],
    });

    const active = getActiveBindings(contexts(), mappings);
    expect(active.get('cmd-w')?.actionId).toBe('second::action');
  });
});

describe('keyEventToString', () => {
  it('converts simple key', () => {
    const event = new KeyboardEvent('keydown', { key: 'w' });
    expect(keyEventToString(event)).toBe('w');
  });

  it('converts key with modifiers', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'w',
      metaKey: true,
      shiftKey: true,
    });
    expect(keyEventToString(event)).toBe('cmd-shift-w');
  });

  it('handles all modifiers in order', () => {
    const event = new KeyboardEvent('keydown', {
      key: 'a',
      metaKey: true,
      ctrlKey: true,
      altKey: true,
      shiftKey: true,
    });
    expect(keyEventToString(event)).toBe('cmd-ctrl-alt-shift-a');
  });

  it('normalizes special keys', () => {
    expect(keyEventToString(new KeyboardEvent('keydown', { key: ' ' }))).toBe('space');
    expect(keyEventToString(new KeyboardEvent('keydown', { key: 'Escape' }))).toBe('escape');
    expect(keyEventToString(new KeyboardEvent('keydown', { key: 'ArrowUp' }))).toBe('up');
  });

  it('returns empty for modifier-only events', () => {
    expect(keyEventToString(new KeyboardEvent('keydown', { key: 'Meta' }))).toBe('');
    expect(keyEventToString(new KeyboardEvent('keydown', { key: 'Control' }))).toBe('');
  });

  it('handles special keys with modifiers (uses event.code for control characters)', () => {
    // Ctrl+\ normally produces a control character, but we should get the actual key
    const backslashEvent = new KeyboardEvent('keydown', {
      key: '\x1c', // Control character produced by Ctrl+\
      code: 'Backslash',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(keyEventToString(backslashEvent)).toBe('ctrl-shift-\\');

    // Ctrl+- should also work
    const minusEvent = new KeyboardEvent('keydown', {
      key: '-',
      code: 'Minus',
      ctrlKey: true,
      shiftKey: true,
    });
    expect(keyEventToString(minusEvent)).toBe('ctrl-shift--');
  });
});

describe('isValidActionId', () => {
  it('validates correct format', () => {
    expect(isValidActionId('drawer::closeTab')).toBe(true);
    expect(isValidActionId('app::quit')).toBe(true);
    expect(isValidActionId('navigate::toEntity1')).toBe(true);
  });

  it('rejects invalid format', () => {
    expect(isValidActionId('closeTab')).toBe(false);
    expect(isValidActionId('drawer:closeTab')).toBe(false);
    expect(isValidActionId('drawer::close-tab')).toBe(false);
    expect(isValidActionId('Drawer::CloseTab')).toBe(false);
  });
});

describe('parseActionId', () => {
  it('parses namespace and name', () => {
    expect(parseActionId('drawer::closeTab')).toEqual({
      namespace: 'drawer',
      name: 'closeTab',
    });
  });
});

describe('validateMappings', () => {
  it('validates correct mappings', () => {
    const raw = {
      bindings: [
        { bindings: { 'cmd-w': 'scratch::close' } },
        { context: 'drawerFocused', bindings: { 'cmd-w': 'drawer::closeTab' } },
      ],
    };

    const result = validateMappings(raw);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('rejects missing bindings array', () => {
    const result = validateMappings({});
    expect(result.valid).toBe(false);
  });

  it('rejects invalid action format', () => {
    const raw = {
      bindings: [{ bindings: { 'cmd-w': 'invalid' } }],
    };

    const result = validateMappings(raw);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes('invalid action format'))).toBe(true);
  });

  it('validates action arrays', () => {
    const valid = {
      bindings: [{ bindings: { 'cmd-1': ['navigate::toEntity', 0] } }],
    };
    expect(validateMappings(valid).valid).toBe(true);

    const invalid = {
      bindings: [{ bindings: { 'cmd-1': [] } }],
    };
    expect(validateMappings(invalid).valid).toBe(false);
  });
});

describe('getKeyForAction', () => {
  it('returns key for a global binding', () => {
    const mappings = parseMappings({
      bindings: [
        { bindings: { 'cmd-shift-p': 'palette::toggle' } },
      ],
    });

    const result = getKeyForAction('palette::toggle', mappings);
    expect(result).not.toBeNull();
    expect(result?.key).toBe('cmd-shift-p');
    expect(result?.context).toBeNull();
  });

  it('returns key for a context-specific binding', () => {
    const mappings = parseMappings({
      bindings: [
        {
          context: 'drawerFocused',
          bindings: { 'cmd-w': 'drawer::closeTab' },
        },
      ],
    });

    const result = getKeyForAction('drawer::closeTab', mappings);
    expect(result?.key).toBe('cmd-w');
    expect(result?.context).toBe('drawerFocused');
  });

  it('prefers global binding over context-specific', () => {
    const mappings = parseMappings({
      bindings: [
        { bindings: { 'cmd-t': 'drawer::toggle' } },
        {
          context: 'drawerFocused',
          bindings: { 'ctrl-`': 'drawer::toggle' },
        },
      ],
    });

    const result = getKeyForAction('drawer::toggle', mappings);
    expect(result?.key).toBe('cmd-t');
    expect(result?.context).toBeNull();
  });

  it('returns null for unknown action', () => {
    const mappings = parseMappings({
      bindings: [{ bindings: { 'cmd-w': 'scratch::close' } }],
    });

    const result = getKeyForAction('unknown::action', mappings);
    expect(result).toBeNull();
  });
});

describe('getAllKeysForAction', () => {
  it('returns all keys for an action', () => {
    const mappings = parseMappings({
      bindings: [
        { bindings: { 'cmd-n': 'scratch::new' } },
        {
          context: 'scratchFocused',
          bindings: { 'cmd-shift-n': 'scratch::new' },
        },
      ],
    });

    const results = getAllKeysForAction('scratch::new', mappings);
    expect(results).toHaveLength(2);
    expect(results.map((r) => r.key)).toContain('cmd-n');
    expect(results.map((r) => r.key)).toContain('cmd-shift-n');
  });

  it('returns empty array for unknown action', () => {
    const mappings = parseMappings({
      bindings: [{ bindings: { 'cmd-w': 'scratch::close' } }],
    });

    const results = getAllKeysForAction('unknown::action', mappings);
    expect(results).toHaveLength(0);
  });
});

describe('formatKeyString', () => {
  // Note: Tests assume Mac platform (mocked in setup.ts)
  it('formats simple key', () => {
    expect(formatKeyString('w')).toBe('W');
  });

  it('formats key with cmd modifier', () => {
    expect(formatKeyString('cmd-w')).toBe('⌘W');
  });

  it('formats key with multiple modifiers', () => {
    expect(formatKeyString('cmd-shift-p')).toBe('⌘⇧P');
  });

  it('formats special keys', () => {
    expect(formatKeyString('escape')).toBe('Esc');
    expect(formatKeyString('cmd-escape')).toBe('⌘Esc');
  });

  it('handles ctrl modifier', () => {
    expect(formatKeyString('ctrl-`')).toBe('⌃`');
  });
});

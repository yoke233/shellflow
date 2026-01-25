import { describe, it, expect } from 'vitest';
import {
  parseContextExpr,
  matchesContext,
  evaluateContextExpr,
  validateContextExpr,
  extractContextFlags,
} from './contextParser';
import type { ContextFlag } from './contexts';

// Helper to create context sets
function contexts(...flags: ContextFlag[]): Set<ContextFlag> {
  return new Set(flags);
}

describe('parseContextExpr', () => {
  it('parses simple identifier', () => {
    const parsed = parseContextExpr('drawerFocused');
    expect(parsed.source).toBe('drawerFocused');
    expect(parsed.ast).toEqual({ type: 'identifier', value: 'drawerFocused' });
  });

  it('parses NOT expression', () => {
    const parsed = parseContextExpr('!drawerFocused');
    expect(parsed.ast).toEqual({
      type: 'not',
      operand: { type: 'identifier', value: 'drawerFocused' },
    });
  });

  it('parses AND expression', () => {
    const parsed = parseContextExpr('worktreeFocused && mainFocused');
    expect(parsed.ast).toEqual({
      type: 'and',
      left: { type: 'identifier', value: 'worktreeFocused' },
      right: { type: 'identifier', value: 'mainFocused' },
    });
  });

  it('parses OR expression', () => {
    const parsed = parseContextExpr('pickerOpen || modalOpen');
    expect(parsed.ast).toEqual({
      type: 'or',
      left: { type: 'identifier', value: 'pickerOpen' },
      right: { type: 'identifier', value: 'modalOpen' },
    });
  });

  it('parses complex expression with AND, OR, NOT', () => {
    const parsed = parseContextExpr('worktreeFocused && !drawerFocused');
    expect(parsed.ast).toEqual({
      type: 'and',
      left: { type: 'identifier', value: 'worktreeFocused' },
      right: {
        type: 'not',
        operand: { type: 'identifier', value: 'drawerFocused' },
      },
    });
  });

  it('parses parenthesized expression', () => {
    const parsed = parseContextExpr('!(pickerOpen || modalOpen)');
    expect(parsed.ast).toEqual({
      type: 'not',
      operand: {
        type: 'or',
        left: { type: 'identifier', value: 'pickerOpen' },
        right: { type: 'identifier', value: 'modalOpen' },
      },
    });
  });

  it('handles whitespace', () => {
    const parsed = parseContextExpr('  drawerFocused   &&   mainFocused  ');
    expect(parsed.ast.type).toBe('and');
  });

  it('respects operator precedence (AND before OR)', () => {
    // a || b && c should parse as a || (b && c)
    const parsed = parseContextExpr('a || b && c');
    expect(parsed.ast).toEqual({
      type: 'or',
      left: { type: 'identifier', value: 'a' },
      right: {
        type: 'and',
        left: { type: 'identifier', value: 'b' },
        right: { type: 'identifier', value: 'c' },
      },
    });
  });

  it('throws on invalid expression', () => {
    expect(() => parseContextExpr('&&')).toThrow();
    expect(() => parseContextExpr('drawerFocused &&')).toThrow();
    expect(() => parseContextExpr('(drawerFocused')).toThrow();
    expect(() => parseContextExpr('drawerFocused @@ mainFocused')).toThrow();
  });
});

describe('matchesContext', () => {
  it('matches simple identifier when present', () => {
    const expr = parseContextExpr('drawerFocused');
    expect(matchesContext(expr, contexts('drawerFocused'))).toBe(true);
  });

  it('does not match simple identifier when absent', () => {
    const expr = parseContextExpr('drawerFocused');
    expect(matchesContext(expr, contexts('mainFocused'))).toBe(false);
  });

  it('matches NOT when operand is false', () => {
    const expr = parseContextExpr('!drawerFocused');
    expect(matchesContext(expr, contexts('mainFocused'))).toBe(true);
  });

  it('does not match NOT when operand is true', () => {
    const expr = parseContextExpr('!drawerFocused');
    expect(matchesContext(expr, contexts('drawerFocused'))).toBe(false);
  });

  it('matches AND when both operands are true', () => {
    const expr = parseContextExpr('worktreeFocused && mainFocused');
    expect(matchesContext(expr, contexts('worktreeFocused', 'mainFocused'))).toBe(true);
  });

  it('does not match AND when one operand is false', () => {
    const expr = parseContextExpr('worktreeFocused && mainFocused');
    expect(matchesContext(expr, contexts('worktreeFocused'))).toBe(false);
  });

  it('matches OR when either operand is true', () => {
    const expr = parseContextExpr('pickerOpen || modalOpen');
    expect(matchesContext(expr, contexts('pickerOpen'))).toBe(true);
    expect(matchesContext(expr, contexts('modalOpen'))).toBe(true);
    expect(matchesContext(expr, contexts('pickerOpen', 'modalOpen'))).toBe(true);
  });

  it('does not match OR when both operands are false', () => {
    const expr = parseContextExpr('pickerOpen || modalOpen');
    expect(matchesContext(expr, contexts('mainFocused'))).toBe(false);
  });

  it('handles complex expressions', () => {
    const expr = parseContextExpr('worktreeFocused && !drawerFocused');

    // worktree focused, main focused → true
    expect(matchesContext(expr, contexts('worktreeFocused', 'mainFocused'))).toBe(true);

    // worktree focused, drawer focused → false
    expect(matchesContext(expr, contexts('worktreeFocused', 'drawerFocused'))).toBe(false);

    // scratch focused, main focused → false
    expect(matchesContext(expr, contexts('scratchFocused', 'mainFocused'))).toBe(false);
  });

  it('handles nested expressions', () => {
    const expr = parseContextExpr('!(pickerOpen || modalOpen)');

    // neither picker nor modal → true
    expect(matchesContext(expr, contexts('mainFocused'))).toBe(true);

    // picker open → false
    expect(matchesContext(expr, contexts('pickerOpen'))).toBe(false);

    // modal open → false
    expect(matchesContext(expr, contexts('modalOpen'))).toBe(false);
  });
});

describe('evaluateContextExpr', () => {
  it('parses and evaluates in one step', () => {
    expect(evaluateContextExpr('drawerFocused', contexts('drawerFocused'))).toBe(true);
    expect(evaluateContextExpr('drawerFocused', contexts('mainFocused'))).toBe(false);
  });
});

describe('validateContextExpr', () => {
  it('returns null for valid expressions', () => {
    expect(validateContextExpr('drawerFocused')).toBeNull();
    expect(validateContextExpr('a && b || c')).toBeNull();
    expect(validateContextExpr('!(a || b)')).toBeNull();
  });

  it('returns error message for invalid expressions', () => {
    expect(validateContextExpr('&&')).not.toBeNull();
    expect(validateContextExpr('a &&')).not.toBeNull();
    expect(validateContextExpr('(a')).not.toBeNull();
  });
});

describe('extractContextFlags', () => {
  it('extracts single flag', () => {
    const expr = parseContextExpr('drawerFocused');
    expect(extractContextFlags(expr)).toEqual(['drawerFocused']);
  });

  it('extracts multiple flags', () => {
    const expr = parseContextExpr('worktreeFocused && !drawerFocused');
    const flags = extractContextFlags(expr);
    expect(flags).toContain('worktreeFocused');
    expect(flags).toContain('drawerFocused');
    expect(flags).toHaveLength(2);
  });

  it('deduplicates flags', () => {
    const expr = parseContextExpr('a && a || a');
    expect(extractContextFlags(expr)).toEqual(['a']);
  });

  it('handles complex nested expressions', () => {
    const expr = parseContextExpr('(a || b) && !(c || d)');
    const flags = extractContextFlags(expr);
    expect(flags.sort()).toEqual(['a', 'b', 'c', 'd']);
  });
});

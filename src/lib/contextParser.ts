/**
 * Context Expression Parser
 *
 * Parses and evaluates context expressions like:
 * - "drawerFocused"
 * - "worktreeFocused && !drawerFocused"
 * - "pickerOpen || modalOpen"
 * - "!(pickerOpen || modalOpen)"
 *
 * Grammar:
 *   expr     = orExpr
 *   orExpr   = andExpr ('||' andExpr)*
 *   andExpr  = unaryExpr ('&&' unaryExpr)*
 *   unaryExpr = '!' unaryExpr | primary
 *   primary  = identifier | '(' expr ')'
 */

import type { ActiveContexts, ContextFlag } from './contexts';

// AST node types
type Expr =
  | { type: 'identifier'; value: string }
  | { type: 'not'; operand: Expr }
  | { type: 'and'; left: Expr; right: Expr }
  | { type: 'or'; left: Expr; right: Expr };

// Token types
type Token =
  | { type: 'identifier'; value: string }
  | { type: 'and' }
  | { type: 'or' }
  | { type: 'not' }
  | { type: 'lparen' }
  | { type: 'rparen' }
  | { type: 'eof' };

/**
 * Tokenize a context expression string
 */
function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  while (i < input.length) {
    // Skip whitespace
    if (/\s/.test(input[i])) {
      i++;
      continue;
    }

    // && operator
    if (input[i] === '&' && input[i + 1] === '&') {
      tokens.push({ type: 'and' });
      i += 2;
      continue;
    }

    // || operator
    if (input[i] === '|' && input[i + 1] === '|') {
      tokens.push({ type: 'or' });
      i += 2;
      continue;
    }

    // ! operator
    if (input[i] === '!') {
      tokens.push({ type: 'not' });
      i++;
      continue;
    }

    // ( and )
    if (input[i] === '(') {
      tokens.push({ type: 'lparen' });
      i++;
      continue;
    }
    if (input[i] === ')') {
      tokens.push({ type: 'rparen' });
      i++;
      continue;
    }

    // Identifier (context flag name)
    if (/[a-zA-Z_]/.test(input[i])) {
      let value = '';
      while (i < input.length && /[a-zA-Z0-9_]/.test(input[i])) {
        value += input[i];
        i++;
      }
      tokens.push({ type: 'identifier', value });
      continue;
    }

    throw new Error(`Unexpected character '${input[i]}' at position ${i}`);
  }

  tokens.push({ type: 'eof' });
  return tokens;
}

/**
 * Parse tokens into an AST
 */
function parse(tokens: Token[]): Expr {
  let pos = 0;

  function peek(): Token {
    return tokens[pos];
  }

  function consume(): Token {
    return tokens[pos++];
  }

  function expect(type: Token['type']): Token {
    const token = peek();
    if (token.type !== type) {
      throw new Error(`Expected ${type}, got ${token.type}`);
    }
    return consume();
  }

  // expr = orExpr
  function parseExpr(): Expr {
    return parseOrExpr();
  }

  // orExpr = andExpr ('||' andExpr)*
  function parseOrExpr(): Expr {
    let left = parseAndExpr();

    while (peek().type === 'or') {
      consume(); // consume '||'
      const right = parseAndExpr();
      left = { type: 'or', left, right };
    }

    return left;
  }

  // andExpr = unaryExpr ('&&' unaryExpr)*
  function parseAndExpr(): Expr {
    let left = parseUnaryExpr();

    while (peek().type === 'and') {
      consume(); // consume '&&'
      const right = parseUnaryExpr();
      left = { type: 'and', left, right };
    }

    return left;
  }

  // unaryExpr = '!' unaryExpr | primary
  function parseUnaryExpr(): Expr {
    if (peek().type === 'not') {
      consume(); // consume '!'
      const operand = parseUnaryExpr();
      return { type: 'not', operand };
    }
    return parsePrimary();
  }

  // primary = identifier | '(' expr ')'
  function parsePrimary(): Expr {
    const token = peek();

    if (token.type === 'identifier') {
      consume();
      return { type: 'identifier', value: token.value };
    }

    if (token.type === 'lparen') {
      consume(); // consume '('
      const expr = parseExpr();
      expect('rparen'); // consume ')'
      return expr;
    }

    throw new Error(`Unexpected token: ${token.type}`);
  }

  const ast = parseExpr();

  if (peek().type !== 'eof') {
    throw new Error(`Unexpected token after expression: ${peek().type}`);
  }

  return ast;
}

/**
 * Evaluate an AST against active contexts
 */
function evaluate(ast: Expr, contexts: ActiveContexts): boolean {
  switch (ast.type) {
    case 'identifier':
      return contexts.has(ast.value as ContextFlag);

    case 'not':
      return !evaluate(ast.operand, contexts);

    case 'and':
      return evaluate(ast.left, contexts) && evaluate(ast.right, contexts);

    case 'or':
      return evaluate(ast.left, contexts) || evaluate(ast.right, contexts);
  }
}

/**
 * Parsed context expression (cached for performance)
 */
export interface ParsedContextExpr {
  source: string;
  ast: Expr;
}

/**
 * Parse a context expression string.
 *
 * @param expr - Context expression string (e.g., "drawerFocused && !pickerOpen")
 * @returns Parsed expression object
 * @throws Error if expression is invalid
 */
export function parseContextExpr(expr: string): ParsedContextExpr {
  const tokens = tokenize(expr);
  const ast = parse(tokens);
  return { source: expr, ast };
}

/**
 * Check if a context expression matches the active contexts.
 *
 * @param expr - Parsed context expression
 * @param contexts - Set of active context flags
 * @returns true if expression matches
 */
export function matchesContext(expr: ParsedContextExpr, contexts: ActiveContexts): boolean {
  return evaluate(expr.ast, contexts);
}

/**
 * Parse and immediately evaluate a context expression.
 * Use parseContextExpr + matchesContext for repeated evaluations.
 *
 * @param exprString - Context expression string
 * @param contexts - Set of active context flags
 * @returns true if expression matches
 */
export function evaluateContextExpr(exprString: string, contexts: ActiveContexts): boolean {
  const parsed = parseContextExpr(exprString);
  return matchesContext(parsed, contexts);
}

/**
 * Validate a context expression without evaluating.
 *
 * @param expr - Context expression string
 * @returns null if valid, error message if invalid
 */
export function validateContextExpr(expr: string): string | null {
  try {
    parseContextExpr(expr);
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : 'Invalid expression';
  }
}

/**
 * Extract all context flag names from an expression.
 * Useful for validation and documentation.
 */
export function extractContextFlags(expr: ParsedContextExpr): string[] {
  const flags: string[] = [];

  function collect(node: Expr): void {
    switch (node.type) {
      case 'identifier':
        flags.push(node.value);
        break;
      case 'not':
        collect(node.operand);
        break;
      case 'and':
      case 'or':
        collect(node.left);
        collect(node.right);
        break;
    }
  }

  collect(expr.ast);
  return [...new Set(flags)]; // dedupe
}

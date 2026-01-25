/**
 * Mappings System
 *
 * Handles loading, parsing, and resolving context-aware key bindings.
 */

import type { ActiveContexts } from './contexts';
import { parseContextExpr, matchesContext, type ParsedContextExpr } from './contextParser';

// ============================================================
// Types
// ============================================================

/**
 * Action namespaces for organization
 */
export type ActionNamespace =
  | 'app'
  | 'drawer'
  | 'scratch'
  | 'worktree'
  | 'project'
  | 'navigate'
  | 'focus'
  | 'view'
  | 'palette'
  | 'task'
  | 'terminal'
  | 'modal'
  | 'rightPanel';

/**
 * Namespaced action identifier (e.g., "drawer::closeTab")
 */
export type ActionId = `${ActionNamespace}::${string}`;

/**
 * Action can be a simple string or an array with arguments
 */
export type Action = ActionId | [ActionId, ...unknown[]];

/**
 * Raw binding group as parsed from JSON
 */
export interface RawBindingGroup {
  context?: string;
  bindings: Record<string, Action>;
}

/**
 * Raw mappings file structure
 */
export interface RawMappings {
  $schema?: string;
  bindings: RawBindingGroup[];
}

/**
 * Parsed binding group with pre-compiled context expression
 */
export interface ParsedBindingGroup {
  context: ParsedContextExpr | null;
  bindings: Map<string, Action>;
}

/**
 * Fully parsed mappings ready for resolution
 */
export interface ParsedMappings {
  groups: ParsedBindingGroup[];
}

// ============================================================
// Parsing
// ============================================================

/**
 * Normalize key syntax to a consistent format.
 * Converts various formats to lowercase with hyphens.
 *
 * @example
 * normalizeKey("Cmd-W") → "cmd-w"
 * normalizeKey("cmd+w") → "cmd-w"
 * normalizeKey("CMD-SHIFT-P") → "cmd-shift-p"
 */
export function normalizeKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/\+/g, '-')  // Convert + to -
    .replace(/\s+/g, ' ') // Normalize whitespace for sequences
    .trim();
}

/**
 * Parse raw mappings into a resolved structure.
 *
 * @param raw - Raw mappings object from JSON
 * @returns Parsed mappings ready for resolution
 */
export function parseMappings(raw: RawMappings): ParsedMappings {
  const groups: ParsedBindingGroup[] = [];

  for (const rawGroup of raw.bindings) {
    const context = rawGroup.context
      ? parseContextExpr(rawGroup.context)
      : null;

    const bindings = new Map<string, Action>();
    for (const [key, action] of Object.entries(rawGroup.bindings)) {
      bindings.set(normalizeKey(key), action);
    }

    groups.push({ context, bindings });
  }

  return { groups };
}

/**
 * Merge multiple mappings (later ones override earlier).
 * Used to layer user mappings on top of defaults.
 */
export function mergeMappings(...mappingsList: ParsedMappings[]): ParsedMappings {
  // Simply concatenate - later groups take precedence in resolution
  const groups: ParsedBindingGroup[] = [];
  for (const mappings of mappingsList) {
    groups.push(...mappings.groups);
  }
  return { groups };
}

// ============================================================
// Resolution
// ============================================================

/**
 * Result of resolving a key press
 */
export interface ResolvedBinding {
  action: Action;
  actionId: ActionId;
  args: unknown[];
  context: string | null;
}

/**
 * Resolve a key press to an action based on active contexts.
 *
 * Resolution order:
 * 1. Later binding groups take precedence over earlier ones
 * 2. Within a group, the binding must match the context (if specified)
 * 3. First match wins
 *
 * @param key - Normalized key string (e.g., "cmd-w")
 * @param contexts - Set of active context flags
 * @param mappings - Parsed mappings to search
 * @returns Resolved binding or null if no match
 */
export function resolveBinding(
  key: string,
  contexts: ActiveContexts,
  mappings: ParsedMappings
): ResolvedBinding | null {
  const normalizedKey = normalizeKey(key);

  // Search in reverse order (later bindings take precedence)
  for (let i = mappings.groups.length - 1; i >= 0; i--) {
    const group = mappings.groups[i];

    // Check if context matches (null context = always matches)
    if (group.context && !matchesContext(group.context, contexts)) {
      continue;
    }

    // Check if this group has a binding for the key
    const action = group.bindings.get(normalizedKey);
    if (action) {
      // Parse action into ID and args
      const [actionId, ...args] = Array.isArray(action) ? action : [action];

      return {
        action,
        actionId: actionId as ActionId,
        args,
        context: group.context?.source ?? null,
      };
    }
  }

  return null;
}

/**
 * Get all bindings that are currently active given the contexts.
 * Useful for displaying available shortcuts.
 *
 * @param contexts - Set of active context flags
 * @param mappings - Parsed mappings to search
 * @returns Map of key to resolved binding
 */
export function getActiveBindings(
  contexts: ActiveContexts,
  mappings: ParsedMappings
): Map<string, ResolvedBinding> {
  const result = new Map<string, ResolvedBinding>();

  // Process in order (later overrides earlier)
  for (const group of mappings.groups) {
    // Check if context matches
    if (group.context && !matchesContext(group.context, contexts)) {
      continue;
    }

    // Add all bindings from this group
    for (const [key, action] of group.bindings) {
      const [actionId, ...args] = Array.isArray(action) ? action : [action];
      result.set(key, {
        action,
        actionId: actionId as ActionId,
        args,
        context: group.context?.source ?? null,
      });
    }
  }

  return result;
}

// ============================================================
// Key Event Conversion
// ============================================================

/**
 * Convert a KeyboardEvent to a normalized key string.
 *
 * @param event - Browser KeyboardEvent
 * @returns Normalized key string (e.g., "cmd-shift-w")
 */
export function keyEventToString(event: KeyboardEvent): string {
  const parts: string[] = [];

  // Add modifiers in consistent order
  if (event.metaKey) parts.push('cmd');
  if (event.ctrlKey) parts.push('ctrl');
  if (event.altKey) parts.push('alt');
  if (event.shiftKey) parts.push('shift');

  // Add the key itself
  // Handle special keys
  let key = event.key;

  // Normalize some key names
  switch (key) {
    case ' ':
      key = 'Space';
      break;
    case 'Escape':
      key = 'Escape';
      break;
    // Arrow keys
    case 'ArrowUp':
      key = 'Up';
      break;
    case 'ArrowDown':
      key = 'Down';
      break;
    case 'ArrowLeft':
      key = 'Left';
      break;
    case 'ArrowRight':
      key = 'Right';
      break;
    // Don't include modifier keys themselves
    case 'Meta':
    case 'Control':
    case 'Alt':
    case 'Shift':
      return ''; // Return empty for modifier-only events
  }

  parts.push(key.toLowerCase());

  return parts.join('-');
}

// ============================================================
// Validation
// ============================================================

/**
 * Validate an action ID format
 */
export function isValidActionId(action: string): action is ActionId {
  return /^[a-z]+::[a-zA-Z0-9]+$/.test(action);
}

/**
 * Parse an action ID into namespace and name
 */
export function parseActionId(actionId: ActionId): { namespace: ActionNamespace; name: string } {
  const [namespace, name] = actionId.split('::') as [ActionNamespace, string];
  return { namespace, name };
}

/**
 * Validate raw mappings structure
 */
export function validateMappings(raw: unknown): { valid: boolean; errors: string[] } {
  const errors: string[] = [];

  if (!raw || typeof raw !== 'object') {
    return { valid: false, errors: ['Mappings must be an object'] };
  }

  const obj = raw as Record<string, unknown>;

  if (!Array.isArray(obj.bindings)) {
    return { valid: false, errors: ['Mappings must have a "bindings" array'] };
  }

  for (let i = 0; i < obj.bindings.length; i++) {
    const group = obj.bindings[i] as Record<string, unknown>;

    if (!group || typeof group !== 'object') {
      errors.push(`Binding group ${i} must be an object`);
      continue;
    }

    if (group.context !== undefined && typeof group.context !== 'string') {
      errors.push(`Binding group ${i}: "context" must be a string`);
    }

    if (!group.bindings || typeof group.bindings !== 'object') {
      errors.push(`Binding group ${i}: "bindings" must be an object`);
      continue;
    }

    for (const [key, action] of Object.entries(group.bindings as Record<string, unknown>)) {
      if (typeof action === 'string') {
        if (!isValidActionId(action)) {
          errors.push(`Binding group ${i}, key "${key}": invalid action format "${action}"`);
        }
      } else if (Array.isArray(action)) {
        if (action.length === 0) {
          errors.push(`Binding group ${i}, key "${key}": action array cannot be empty`);
        } else if (!isValidActionId(action[0] as string)) {
          errors.push(`Binding group ${i}, key "${key}": invalid action format "${action[0]}"`);
        }
      } else {
        errors.push(`Binding group ${i}, key "${key}": action must be a string or array`);
      }
    }
  }

  return { valid: errors.length === 0, errors };
}

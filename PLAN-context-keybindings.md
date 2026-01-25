# Context-Aware Keybindings

## Overview

Replace the current hardcoded keybinding system with a context-aware system inspired by [Zed's key bindings](https://zed.dev/docs/key-bindings). Keybindings will be defined in a separate `mappings.jsonc` file with context conditions that determine when each binding is active.

## Goals

1. **Context-driven actions**: Same key (e.g., `cmd-w`) does different things based on context
2. **User-configurable**: Users can override/extend defaults in `~/.config/shellflow/mappings.jsonc`
3. **Declarative**: Bindings defined as data, not nested if/else logic
4. **Debuggable**: Easy to see active contexts and which binding matched
5. **Namespaced actions**: Actions use namespace format (e.g., `worktree::close`)

## Design Decisions

- **Context naming**: camelCase (e.g., `drawerFocused`)
- **Action naming**: Namespaced (e.g., `drawer::closeTab`, `scratch::close`)
- **Key syntax**: Zed-style with hyphens (e.g., `cmd-w`, `ctrl-shift-p`)
- **Schema location**: `https://raw.githubusercontent.com/user/shellflow/main/schemas/mappings.schema.json`

---

## File Structure

### New Files

```
src/
  lib/
    contexts.ts           # Context types and computation
    contextParser.ts      # Parse context expressions ("drawerFocused && !pickerOpen")
    mappings.ts           # Types and resolution logic
    defaultMappings.jsonc # Default keybindings (compiled in, but readable)
  hooks/
    useMappings.ts        # Load and resolve mappings

src-tauri/
  src/
    mappings.rs           # Load user mappings, merge with defaults

schemas/
  mappings.schema.json    # JSON Schema for validation
```

### Files to Modify

```
src/App.tsx               # Refactor keyboard handler
src/hooks/useConfig.ts    # Remove old MappingsConfig
src/lib/actions.ts        # Rename actions to namespaced format
src-tauri/src/config.rs   # Remove mappings from Config struct
src-tauri/src/default_config.jsonc  # Remove mappings section
```

---

## Context System

### Context Flags

```typescript
type ContextFlag =
  // View focus (what entity is selected - mutually exclusive)
  | 'scratchFocused'
  | 'worktreeFocused'
  | 'projectFocused'

  // Panel focus (where keyboard input goes)
  | 'drawerFocused'
  | 'mainFocused'

  // UI state
  | 'drawerOpen'
  | 'rightPanelOpen'
  | 'pickerOpen'
  | 'modalOpen'

  // Derived/utility
  | 'hasMultipleEntities'
  | 'hasPreviousView'
  ;
```

### Context Hierarchy

```
Workspace (root - always active)
├── scratchFocused
├── worktreeFocused
├── projectFocused
│
├── drawerFocused (combines with above)
├── mainFocused
│
├── drawerOpen
├── rightPanelOpen
│
├── pickerOpen
│   ├── commandPaletteOpen
│   └── taskSwitcherOpen
│
└── modalOpen
```

### Context Expressions

Supports boolean operators:
- `&&` (AND)
- `||` (OR)
- `!` (NOT)
- `()` (grouping)

Examples:
- `drawerFocused`
- `worktreeFocused && !drawerFocused`
- `pickerOpen || modalOpen`
- `!(pickerOpen || modalOpen)`

---

## Mappings File Format

### Location

- Default: Compiled into app from `src/lib/defaultMappings.jsonc`
- User: `~/.config/shellflow/mappings.jsonc` (optional, overrides defaults)

### Schema

```jsonc
{
  "$schema": "https://raw.githubusercontent.com/user/shellflow/main/schemas/mappings.schema.json"
}
```

### Format

```jsonc
[
  // Global bindings (no context = always active)
  {
    "bindings": {
      "cmd-shift-p": "palette::toggle",
      "cmd-,": "app::openSettings"
    }
  },

  // Context-specific bindings
  {
    "context": "drawerFocused",
    "bindings": {
      "cmd-w": "drawer::closeTab",
      "cmd-t": "drawer::newTab"
    }
  },

  {
    "context": "scratchFocused && !drawerFocused",
    "bindings": {
      "cmd-w": "scratch::close",
      "cmd-n": "scratch::new"
    }
  },

  {
    "context": "worktreeFocused && !drawerFocused",
    "bindings": {
      "cmd-w": "worktree::close",
      "cmd-n": "worktree::new"
    }
  },

  {
    "context": "projectFocused && !drawerFocused",
    "bindings": {
      "cmd-w": "project::close",
      "cmd-n": "worktree::new"
    }
  }
]
```

### Resolution Order

1. User mappings loaded after defaults
2. Later definitions override earlier at same context specificity
3. More specific contexts take priority
4. First matching binding wins

---

## Action Namespaces

### Current → New Action Names

| Current | New |
|---------|-----|
| `closeTab` | (removed - context-driven) |
| `closeDrawerTab` | `drawer::closeTab` |
| `closeScratch` | `scratch::close` |
| `closeWorktree` | `worktree::close` |
| `closeProject` | `project::close` |
| `newWorktree` | `worktree::new` |
| `newScratchTerminal` | `scratch::new` |
| `toggleDrawer` | `drawer::toggle` |
| `toggleRightPanel` | `rightPanel::toggle` |
| `commandPalette` | `palette::toggle` |
| `worktreePrev` | `navigate::prev` |
| `worktreeNext` | `navigate::next` |
| `switchFocus` | `focus::switch` |
| `previousView` | `navigate::back` |
| `zoomIn` | `view::zoomIn` |
| `zoomOut` | `view::zoomOut` |
| `zoomReset` | `view::zoomReset` |

### Namespace Categories

- `app::` - Application-level (settings, quit)
- `drawer::` - Drawer panel actions
- `scratch::` - Scratch terminal actions
- `worktree::` - Worktree actions
- `project::` - Project actions
- `navigate::` - Navigation between entities
- `focus::` - Focus management
- `view::` - View/zoom controls
- `palette::` - Command palette
- `task::` - Task runner

---

## Implementation Phases

### Phase 1: Context System ✅ COMPLETE

**Files:**
- [x] `src/lib/contexts.ts` - Context types and `getActiveContexts()`
- [x] `src/lib/contextParser.ts` - Parse and evaluate context expressions
- [x] `src/lib/contexts.test.ts` - 22 tests
- [x] `src/lib/contextParser.test.ts` - 26 tests

**Tasks:**
1. ✅ Define `ContextFlag` type
2. ✅ Implement `getActiveContexts(state)` function
3. ✅ Implement `parseContextExpr(expr)` parser
4. ✅ Implement `matchesContext(expr, activeContexts)` evaluator
5. ⏳ Add `activeContexts` computation to App.tsx (for debugging) - deferred to Phase 3
6. ✅ Unit tests (48 passing)

### Phase 2: Mappings System (Frontend) ✅ COMPLETE

**Files:**
- [x] `src/lib/defaultMappings.jsonc` - Default keybindings
- [x] `schemas/mappings.schema.json` - JSON Schema
- [x] `src/lib/mappings.ts` - Types and resolution
- [x] `src/lib/mappings.test.ts` - 31 tests
- [ ] `src-tauri/src/mappings.rs` - Backend loading (Phase 2b)

**Tasks:**
1. ✅ Define `BindingGroup`, `Bindings` types
2. ✅ Create default mappings file with all current shortcuts
3. ✅ Create JSON Schema for validation
4. ✅ Implement `resolveBinding(key, contexts, mappings)`
5. ⏳ Implement backend: load user mappings, merge with defaults
6. ⏳ Add Tauri command: `get_mappings`
7. ⏳ Watch `mappings.jsonc` for changes

### Phase 3: Hook & Integration

**Files:**
- [ ] `src/hooks/useMappings.ts` - React hook for mappings
- [ ] Refactor `src/App.tsx` - New keyboard handler

**Tasks:**
1. Create `useMappings()` hook
2. Refactor keyboard handler to use `resolveBinding()`
3. Remove old hardcoded shortcut logic
4. Update menu bar to use new action names
5. Integration tests

### Phase 4: Migration & Cleanup

**Files:**
- [ ] `src/hooks/useConfig.ts` - Remove `MappingsConfig`
- [ ] `src-tauri/src/config.rs` - Remove mappings from struct
- [ ] `src-tauri/src/default_config.jsonc` - Remove mappings section

**Tasks:**
1. Remove old `MappingsConfig` interface
2. Remove mappings from Rust config struct
3. Remove mappings from default_config.jsonc
4. Add migration warning for users with old mappings
5. Update documentation

### Phase 5: Developer Experience

**Files:**
- [ ] Context debugger component
- [ ] "Show Effective Mappings" command

**Tasks:**
1. Add `dev::showContexts` command (shows active contexts in real-time)
2. Add `app::showMappings` command (shows effective keybindings)
3. Add validation warnings for invalid contexts/actions
4. Add duplicate binding warnings

---

## Testing Strategy

### Unit Tests

```typescript
// Context computation
describe('getActiveContexts', () => {
  it('includes scratchFocused when scratch is active');
  it('includes drawerFocused when drawer is open and focused');
  it('contexts are mutually exclusive where appropriate');
});

// Context expression parsing
describe('parseContextExpr', () => {
  it('parses simple context: "drawerFocused"');
  it('parses AND: "worktreeFocused && !drawerFocused"');
  it('parses OR: "pickerOpen || modalOpen"');
  it('parses nested: "!(pickerOpen || modalOpen)"');
});

// Binding resolution
describe('resolveBinding', () => {
  it('resolves cmd-w → drawer::closeTab when drawerFocused');
  it('resolves cmd-w → scratch::close when scratchFocused');
  it('user bindings override defaults');
  it('returns null when no binding matches');
});
```

### Integration Tests

```typescript
describe('Close action', () => {
  it('closes drawer tab when drawer is focused');
  it('closes scratch terminal when scratch is focused');
  it('closes worktree when worktree is focused');
  it('shows confirmation when closing project');
});
```

---

## Open Questions

1. ~~Context naming~~ → camelCase
2. ~~Action naming~~ → namespaced
3. ~~Key syntax~~ → Zed-style hyphens
4. ~~Show effective mappings~~ → Yes, add command

---

## References

- [Zed Key Bindings Documentation](https://zed.dev/docs/key-bindings)
- [Zed Configuring Documentation](https://zed.dev/docs/configuring-zed)

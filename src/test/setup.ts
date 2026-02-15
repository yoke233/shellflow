import { vi } from 'vitest';
import '@testing-library/jest-dom/vitest';
import type { Project, Worktree } from '../types';

// Store listeners for simulating events
export const eventListeners = new Map<string, Set<(event: { payload: unknown }) => void>>();

// Mock invoke responses - tests can override these
export const mockInvokeResponses = new Map<string, unknown>();

// Track invocations for assertions
export const invokeHistory: Array<{ command: string; args: unknown }> = [];

// Reset all mocks between tests
export function resetMocks() {
  eventListeners.clear();
  mockInvokeResponses.clear();
  invokeHistory.length = 0;
}

// Helper to emit events to listeners
export function emitEvent(eventName: string, payload: unknown) {
  const listeners = eventListeners.get(eventName);
  if (listeners) {
    listeners.forEach((listener) => listener({ payload }));
  }
}

// Default config - minimal structure that the app requires
// Tests can override specific values as needed
export const defaultTestConfig = {
  main: { command: null, fontFamily: 'Menlo', fontSize: 13, fontLigatures: false, webgl: 'auto', padding: 8, scrollback: 1000, pauseOutputWhenHidden: false, unfocusedOpacity: null },
  drawer: { fontFamily: 'Menlo', fontSize: 13, fontLigatures: false, webgl: 'auto', padding: 8, scrollback: 1000, pauseOutputWhenHidden: false, unfocusedOpacity: 0.7 },
  navigation: {},
  indicators: { activityTimeout: 5000, showIdleCheck: true },
  apps: { terminal: 'Terminal', editor: 'VS Code' },
  commit: {
    ai: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      prompt: 'Generate a concise git commit message based on the diff. Use imperative mood, no trailing period.\n\nDiff:\n{{ diff }}',
      temperature: 0.2,
      maxTokens: 120,
      timeoutMs: 15000,
    },
  },
  tasks: [],
  actions: { mergeWorktreeWithConflicts: '' },
  scratch: { startOnLaunch: true },
  worktree: {
    focusNewBranchNames: false,
    merge: { strategy: 'merge', deleteWorktree: true, deleteLocalBranch: true, deleteRemoteBranch: false },
  },
  panes: {
    unfocusedOpacity: 0.7,
  },
};

// Default mappings for tests
export const defaultTestMappings = {
  mappings: {
    bindings: [
      {
        bindings: {
          'cmd-shift-p': 'palette::toggle',
        },
      },
      {
        context: 'drawerFocused',
        bindings: {
          'cmd-w': 'drawer::closeTab',
        },
      },
      {
        context: 'scratchFocused && !drawerFocused',
        bindings: {
          'cmd-w': 'scratch::close',
        },
      },
      {
        context: 'worktreeFocused && !drawerFocused',
        bindings: {
          'cmd-w': 'worktree::close',
        },
      },
      {
        context: 'projectFocused && !drawerFocused',
        bindings: {
          'cmd-w': 'project::close',
        },
      },
    ],
  },
  errors: [],
};

// Helper to set up common mock responses
export function setupDefaultMocks() {
  mockInvokeResponses.set('list_projects', []);
  mockInvokeResponses.set('get_config', { config: defaultTestConfig, errors: [] });
  mockInvokeResponses.set('get_home_dir', '/Users/test');
  mockInvokeResponses.set('get_mappings', defaultTestMappings);
}

// Helper to create config with overrides
export function createTestConfig(overrides: Record<string, unknown> = {}) {
  return { config: { ...defaultTestConfig, ...overrides }, errors: [] };
}

// Mock Tauri core API
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn((command: string, args?: unknown) => {
    invokeHistory.push({ command, args });

    if (mockInvokeResponses.has(command)) {
      const response = mockInvokeResponses.get(command);
      // If it's a function, call it with args and properly handle errors
      if (typeof response === 'function') {
        try {
          return Promise.resolve(response(args));
        } catch (err) {
          return Promise.reject(err);
        }
      }
      return Promise.resolve(response);
    }

    // Default responses for common commands
    switch (command) {
      case 'spawn_main':
      case 'spawn_terminal':
      case 'spawn_scratch_terminal':
      case 'spawn_project_shell':
      case 'spawn_shell':
        return Promise.resolve(`pty-${Date.now()}`);
      case 'list_themes':
        return Promise.resolve([]);
      case 'read_theme':
        return Promise.resolve('{}');
      default:
        return Promise.resolve(null);
    }
  }),
}));

// Mock Tauri event API
vi.mock('@tauri-apps/api/event', () => ({
  listen: vi.fn((eventName: string, callback: (event: { payload: unknown }) => void) => {
    if (!eventListeners.has(eventName)) {
      eventListeners.set(eventName, new Set());
    }
    eventListeners.get(eventName)!.add(callback);

    // Return unlisten function
    return Promise.resolve(() => {
      eventListeners.get(eventName)?.delete(callback);
    });
  }),
  emit: vi.fn(),
}));

// Mock Tauri clipboard plugin
vi.mock('@tauri-apps/plugin-clipboard-manager', () => ({
  readText: vi.fn(() => Promise.resolve('')),
  writeText: vi.fn(() => Promise.resolve()),
}));

// Mock Tauri dialog plugin
vi.mock('@tauri-apps/plugin-dialog', () => ({
  open: vi.fn(() => Promise.resolve(null)),
  save: vi.fn(() => Promise.resolve(null)),
  message: vi.fn(() => Promise.resolve()),
  ask: vi.fn(() => Promise.resolve(false)),
  confirm: vi.fn(() => Promise.resolve(false)),
}));

// Mock Tauri notification plugin
vi.mock('@tauri-apps/plugin-notification', () => ({
  isPermissionGranted: vi.fn(() => Promise.resolve(true)),
  requestPermission: vi.fn(() => Promise.resolve('granted')),
  sendNotification: vi.fn(),
}));

// Mock Tauri opener plugin
vi.mock('@tauri-apps/plugin-opener', () => ({
  openUrl: vi.fn(() => Promise.resolve()),
}));

// Mock Tauri webview window API
vi.mock('@tauri-apps/api/webviewWindow', () => ({
  getCurrentWebviewWindow: vi.fn(() => ({
    onDragDropEvent: vi.fn(() => Promise.resolve(() => {})),
    listen: vi.fn(() => Promise.resolve(() => {})),
  })),
}));

// Mock navigator for platform detection in keyboard.ts
Object.defineProperty(globalThis, 'navigator', {
  value: {
    platform: 'MacIntel',
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
  },
  writable: true,
});

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};
  return {
    getItem: (key: string) => store[key] ?? null,
    setItem: (key: string, value: string) => { store[key] = value; },
    removeItem: (key: string) => { delete store[key]; },
    clear: () => { store = {}; },
    get length() { return Object.keys(store).length; },
    key: (index: number) => Object.keys(store)[index] ?? null,
  };
})();
Object.defineProperty(globalThis, 'localStorage', { value: localStorageMock });

// Mock ResizeObserver
class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver = ResizeObserverMock;

// Mock scrollIntoView (not implemented in jsdom)
Element.prototype.scrollIntoView = vi.fn();

// Mock matchMedia
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // deprecated
    removeListener: vi.fn(), // deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

// Mock devicePixelRatio
Object.defineProperty(window, 'devicePixelRatio', {
  writable: true,
  value: 1,
});

// Mock xterm.js Terminal - use a class for proper constructor behavior
class MockTerminal {
  element = document.createElement('div');
  textarea = document.createElement('textarea');
  options = {};
  cols = 80;
  rows = 24;
  buffer = {
    active: {
      cursorX: 0,
      cursorY: 0,
      viewportY: 0,
      baseY: 0,
      length: 24,
      type: 'normal',
      getLine: () => null,
    },
    normal: { type: 'normal' },
    alternate: { type: 'alternate' },
  };
  parser = {
    registerCsiHandler: () => ({ dispose: () => {} }),
    registerDcsHandler: () => ({ dispose: () => {} }),
    registerEscHandler: () => ({ dispose: () => {} }),
    registerOscHandler: () => ({ dispose: () => {} }),
  };
  unicode = { activeVersion: '11' };
  modes = { mouseTrackingMode: 'none' };

  constructor(_options?: unknown) {}
  open(parent?: Element | DocumentFragment | null) {
    this.element.classList.add('xterm');
    this.textarea.classList.add('xterm-helper-textarea');

    if (!this.element.contains(this.textarea)) {
      this.element.appendChild(this.textarea);
    }

    if (parent instanceof HTMLElement && !parent.contains(this.element)) {
      parent.appendChild(this.element);
    }
  }
  write() {}
  writeln() {}
  clear() {}
  reset() {}
  dispose() {}
  focus() {
    this.textarea.focus();
  }
  blur() {
    this.textarea.blur();
  }
  scrollToBottom() {}
  select(column?: number, row?: number, length?: number) {
    if (typeof length === 'number' && length > 0) {
      this.textarea.value = this.textarea.value || ' '.repeat(length);
      this.textarea.setSelectionRange(0, length);
    }
  }
  selectAll() {}
  clearSelection() {
    const cursor = this.textarea.selectionStart ?? 0;
    this.textarea.setSelectionRange(cursor, cursor);
  }
  hasSelection() {
    const start = this.textarea.selectionStart ?? 0;
    const end = this.textarea.selectionEnd ?? 0;
    return end > start;
  }
  getSelection() {
    const start = this.textarea.selectionStart ?? 0;
    const end = this.textarea.selectionEnd ?? 0;
    return this.textarea.value.slice(start, end);
  }
  onData() { return { dispose: () => {} }; }
  onResize() { return { dispose: () => {} }; }
  onTitleChange() { return { dispose: () => {} }; }
  onBell() { return { dispose: () => {} }; }
  onBinary() { return { dispose: () => {} }; }
  onCursorMove() { return { dispose: () => {} }; }
  onKey() { return { dispose: () => {} }; }
  onLineFeed() { return { dispose: () => {} }; }
  onRender() { return { dispose: () => {} }; }
  onScroll() { return { dispose: () => {} }; }
  onSelectionChange() { return { dispose: () => {} }; }
  onWriteParsed() { return { dispose: () => {} }; }
  loadAddon() {}
  refresh() {}
  resize() {}
  attachCustomKeyEventHandler() {}
  registerLinkProvider() { return { dispose: () => {} }; }
  registerCharacterJoiner() { return 0; }
  deregisterCharacterJoiner() {}
  registerMarker() { return { dispose: () => {}, isDisposed: false, line: 0 }; }
  registerDecoration() { return { dispose: () => {}, isDisposed: false }; }
}

vi.mock('@xterm/xterm', () => ({
  Terminal: MockTerminal,
}));

// Mock xterm addons - use classes for proper constructor behavior
class MockFitAddon {
  activate() {}
  fit() {}
  proposeDimensions() { return { cols: 80, rows: 24 }; }
  dispose() {}
}

class MockWebLinksAddon {
  constructor(_handler?: unknown) {}
  activate() {}
  dispose() {}
}

class MockClipboardAddon {
  activate() {}
  dispose() {}
}

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: MockFitAddon,
}));

vi.mock('@xterm/addon-web-links', () => ({
  WebLinksAddon: MockWebLinksAddon,
}));

vi.mock('@xterm/addon-clipboard', () => ({
  ClipboardAddon: MockClipboardAddon,
}));

// Note: @xterm/addon-ligatures is mocked via vitest config alias

// Test data factories
export function createTestProject(overrides: Partial<Project> = {}): Project {
  return {
    id: `project-${Date.now()}`,
    name: 'test-project',
    path: '/Users/test/projects/test-project',
    worktrees: [],
    isActive: true,
    lastAccessedAt: new Date().toISOString(),
    ...overrides,
  };
}

export function createTestWorktree(overrides: Partial<Worktree> = {}): Worktree {
  return {
    id: `worktree-${Date.now()}`,
    name: 'test-worktree',
    path: '/Users/test/projects/test-project/.worktrees/test-worktree',
    branch: 'test-branch',
    createdAt: new Date().toISOString(),
    ...overrides,
  };
}

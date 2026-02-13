import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { MergeStrategy } from '../types';

/** Shared terminal display configuration used by both main and drawer terminals */
export type TerminalWebglMode = 'off' | 'auto' | 'on';

export interface TerminalConfig {
  fontFamily: string;
  fontSize: number;
  fontLigatures: boolean;
  webgl: TerminalWebglMode;
  padding: number;
  scrollback: number;
}

/** Drawer-specific configuration */
export interface DrawerConfig extends TerminalConfig {
  /** Opacity (0.0 to 1.0) applied to the drawer when open but not focused */
  unfocusedOpacity: number;
}

export interface MainConfig extends TerminalConfig {
  /** Command to run in the main terminal pane. If null, spawns user's shell. */
  command: string | null;
  /** Opacity (0.0 to 1.0) applied to the main area when drawer is focused. If null, uses panes.unfocusedOpacity. */
  unfocusedOpacity: number | null;
}

export interface MergeConfig {
  strategy: MergeStrategy;
  deleteWorktree: boolean;
  deleteLocalBranch: boolean;
  deleteRemoteBranch: boolean;
}

export interface DeleteConfig {
  deleteBranchWithWorktree: boolean;
}

export interface NavigationConfig {
  // Reserved for future navigation settings
}

export type TaskKind = 'command' | 'daemon';

export interface TaskConfig {
  name: string;
  command: string;
  kind?: TaskKind;
  silent?: boolean;
  shell?: string;
  /** Named URL templates. Key is display label, value is URL template (supports minijinja). */
  urls?: Record<string, string>;
}


export interface IndicatorsConfig {
  activityTimeout: number;
  showIdleCheck: boolean;
}

export interface ActionsConfig {
  mergeWorktreeWithConflicts: string;
}

/** Target for opening apps - where the app should open */
export type AppTarget = 'external' | 'drawer' | 'tab' | 'terminal';

/**
 * Configuration for a single app (terminal, editor, fileManager).
 * Can be a simple string (command only) or full object form.
 */
export type AppConfig = string | {
  /** Command/app name to use. If omitted, uses platform defaults. */
  command?: string;
  /** Where to open the app. */
  target?: AppTarget;
};

export interface AppsConfig {
  terminal?: AppConfig;
  editor?: AppConfig;
  fileManager?: AppConfig;
}

export interface CommitAiConfig {
  baseUrl: string;
  apiKey: string;
  model: string;
  prompt: string;
  temperature: number;
  maxTokens: number;
  timeoutMs: number;
}

export interface CommitConfig {
  ai: CommitAiConfig;
}

/** Helper to get the command from an AppConfig */
export function getAppCommand(config: AppConfig | undefined): string | undefined {
  if (!config) return undefined;
  if (typeof config === 'string') return config;
  return config.command;
}

/** Helper to get the target from an AppConfig (default varies by app type) */
export function getAppTarget(config: AppConfig | undefined, defaultTarget: AppTarget = 'external'): AppTarget {
  if (!config) return defaultTarget;
  if (typeof config === 'string') return 'external';
  return config.target ?? defaultTarget;
}

export interface ScratchConfig {
  startOnLaunch: boolean;
}

export interface WorktreeConfig {
  focusNewBranchNames: boolean;
  merge: MergeConfig;
  delete: DeleteConfig;
}

export interface PanesConfig {
  /** Opacity (0.0 to 1.0) applied to unfocused split panes */
  unfocusedOpacity: number;
}

/** Theme configuration - can be a single theme name or light/dark object */
export type ThemeConfig = string | { light: string; dark: string };

// Import and re-export ThemeBorderStyle from theme types
import type { ThemeBorderStyle } from '../theme/types';
export type { ThemeBorderStyle };


export interface Config {
  main: MainConfig;
  drawer: DrawerConfig;
  apps: AppsConfig;
  commit: CommitConfig;
  navigation: NavigationConfig;
  indicators: IndicatorsConfig;
  tasks: TaskConfig[];
  actions: ActionsConfig;
  scratch: ScratchConfig;
  worktree: WorktreeConfig;
  panes: PanesConfig;
  /** Theme configuration - can be a single theme name or light/dark object */
  theme?: ThemeConfig;
  /** How to handle borders when adapting themes */
  themeBorderStyle?: ThemeBorderStyle;
}

/** An error from parsing a config file */
export interface ConfigError {
  file: string;
  message: string;
}

/** Result from get_config, includes config and any parse errors */
interface ConfigResult {
  config: Config;
  errors: ConfigError[];
}

const defaultConfig: Config = {
  main: {
    command: null,
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    fontSize: 13,
    fontLigatures: false,
    webgl: 'auto',
    padding: 8,
    scrollback: 20000,
    unfocusedOpacity: null,
  },
  drawer: {
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    fontSize: 13,
    fontLigatures: false,
    webgl: 'auto',
    padding: 8,
    scrollback: 20000,
    unfocusedOpacity: 0.7,
  },
  apps: {
    // No defaults - will use platform defaults
  },
  commit: {
    ai: {
      baseUrl: 'https://api.openai.com/v1',
      apiKey: '',
      model: 'gpt-4o-mini',
      prompt: 'You are a senior engineer and code reviewer. Based on the git diff I provide, generate exactly one standard Git commit message.\n\nRequirements:\n- Use Conventional Commits format: <type>(<scope>): <subject>\n- Choose the most appropriate type from: feat, fix, refactor, perf, docs, test, chore, ci, build, revert\n- Infer scope as 1–2 words from affected paths/modules in the diff\n- Write subject in English, start with a verb, and keep it <= 20 words\n- If the diff contains mixed changes, prioritize the core user value or highest-risk change; do not expand on secondary changes\n- Output exactly one line: only the commit message\n- No explanation, no code block, no bullets\n\nInput: below is the git diff\n----\n{{ diff }}',
      temperature: 0.2,
      maxTokens: 120,
      timeoutMs: 15000,
    },
  },
  navigation: {},
  indicators: {
    activityTimeout: 250,
    showIdleCheck: true,
  },
  tasks: [],
  actions: {
    mergeWorktreeWithConflicts: '',
  },
  scratch: {
    startOnLaunch: true,
  },
  worktree: {
    focusNewBranchNames: false,
    merge: {
      strategy: 'merge',
      deleteWorktree: true,
      deleteLocalBranch: false,
      deleteRemoteBranch: false,
    },
    delete: {
      deleteBranchWithWorktree: true,
    },
  },
  panes: {
    unfocusedOpacity: 0.95,
  },
  themeBorderStyle: 'subtle',
};

export function useConfig(projectPath?: string) {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [errors, setErrors] = useState<ConfigError[]>([]);
  const [loading, setLoading] = useState(true);

  const loadConfig = useCallback(() => {
    invoke<ConfigResult>('get_config', { projectPath: projectPath ?? null })
      .then((result) => {
        setConfig(result.config);
        setErrors(result.errors);
      })
      .catch((err) => {
        console.error('Failed to load config:', err);
      })
      .finally(() => setLoading(false));
  }, [projectPath]);

  // Initial load
  useEffect(() => {
    setLoading(true);
    loadConfig();
  }, [loadConfig]);

  // Start config watcher and listen for changes
  useEffect(() => {
    // Start watching config files
    invoke('watch_config', { projectPath: projectPath ?? null }).catch((err) => {
      console.error('Failed to start config watcher:', err);
    });

    // Listen for config changes
    const unlisten = listen('config-changed', () => {
      loadConfig();
    });

    return () => {
      unlisten.then((fn) => fn());
      invoke('stop_config_watcher').catch(() => {});
    };
  }, [projectPath, loadConfig]);

  return { config, errors, loading };
}

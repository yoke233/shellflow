import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { MergeStrategy } from '../types';

/** Shared terminal display configuration used by both main and drawer terminals */
export interface TerminalConfig {
  fontFamily: string;
  fontSize: number;
  fontLigatures: boolean;
  padding: number;
}

/** Drawer-specific configuration (same as TerminalConfig) */
export type DrawerConfig = TerminalConfig;

export interface MainConfig extends TerminalConfig {
  /** Command to run in the main terminal pane. If null, spawns user's shell. */
  command: string | null;
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
    padding: 8,
  },
  drawer: {
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    fontSize: 13,
    fontLigatures: false,
    padding: 8,
  },
  apps: {
    // No defaults - will use platform defaults
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

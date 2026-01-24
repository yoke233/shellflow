import { useState, useEffect, useCallback } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { MergeStrategy } from '../types';

export interface TerminalConfig {
  fontFamily: string;
  fontSize: number;
  fontLigatures: boolean;
  padding: number;
}

export interface MainConfig extends TerminalConfig {
  command: string;
}

export interface MergeConfig {
  strategy: MergeStrategy;
  deleteWorktree: boolean;
  deleteLocalBranch: boolean;
  deleteRemoteBranch: boolean;
}

export interface NavigationConfig {
  includeProjects: boolean;
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

/** Platform-specific shortcut mapping */
export interface PlatformShortcut {
  mac?: string;
  other?: string;
}

/** A shortcut entry: either a universal string or platform-specific object */
export type ShortcutEntry = string | PlatformShortcut;

/**
 * A shortcut configuration that can be:
 * - A simple string (universal)
 * - A platform-specific object { mac?: string, other?: string }
 * - An array of strings and/or platform-specific objects
 */
export type Shortcut = string | PlatformShortcut | ShortcutEntry[];

export interface IndicatorsConfig {
  activityTimeout: number;
  showIdleCheck: boolean;
}

export interface ActionsConfig {
  mergeWorktreeWithConflicts: string;
}

export interface AppsConfig {
  terminal: string;
  editor: string;
}

export interface ScratchConfig {
  startOnLaunch: boolean;
}

export interface WorktreeConfig {
  focusNewBranchNames: boolean;
}

export interface MappingsConfig {
  toggleDrawer: Shortcut;
  toggleRightPanel: Shortcut;
  terminalCopy: Shortcut;
  terminalPaste: Shortcut;
  worktreePrev: Shortcut;
  worktreeNext: Shortcut;
  worktree1: Shortcut;
  worktree2: Shortcut;
  worktree3: Shortcut;
  worktree4: Shortcut;
  worktree5: Shortcut;
  worktree6: Shortcut;
  worktree7: Shortcut;
  worktree8: Shortcut;
  worktree9: Shortcut;
  runTask: Shortcut;
  newWorkspace: Shortcut;
  switchFocus: Shortcut;
  taskSwitcher: Shortcut;
  expandDrawer: Shortcut;
  previousView: Shortcut;
  zoomIn: Shortcut;
  zoomOut: Shortcut;
  zoomReset: Shortcut;
  commandPalette: Shortcut;
  projectSwitcher: Shortcut;
}

export interface Config {
  main: MainConfig;
  terminal: TerminalConfig;
  apps: AppsConfig;
  merge: MergeConfig;
  navigation: NavigationConfig;
  mappings: MappingsConfig;
  indicators: IndicatorsConfig;
  tasks: TaskConfig[];
  actions: ActionsConfig;
  scratch: ScratchConfig;
  worktree: WorktreeConfig;
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
    command: 'claude',
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    fontSize: 13,
    fontLigatures: false,
    padding: 8,
  },
  terminal: {
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    fontSize: 13,
    fontLigatures: false,
    padding: 8,
  },
  apps: {
    terminal: 'Ghostty',
    editor: 'Zed',
  },
  merge: {
    strategy: 'merge',
    deleteWorktree: true,
    deleteLocalBranch: false,
    deleteRemoteBranch: false,
  },
  navigation: {
    includeProjects: true,
  },
  indicators: {
    activityTimeout: 250,
    showIdleCheck: true,
  },
  // Mappings are loaded from backend (default_config.jsonc is single source of truth)
  // These are placeholder values used only until backend config loads
  mappings: {
    toggleDrawer: '',
    toggleRightPanel: '',
    terminalCopy: '',
    terminalPaste: '',
    worktreePrev: '',
    worktreeNext: '',
    worktree1: '',
    worktree2: '',
    worktree3: '',
    worktree4: '',
    worktree5: '',
    worktree6: '',
    worktree7: '',
    worktree8: '',
    worktree9: '',
    runTask: '',
    newWorkspace: '',
    switchFocus: '',
    taskSwitcher: '',
    expandDrawer: '',
    previousView: '',
    zoomIn: '',
    zoomOut: '',
    zoomReset: '',
    commandPalette: '',
    projectSwitcher: '',
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
  },
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

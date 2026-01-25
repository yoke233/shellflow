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


export interface Config {
  main: MainConfig;
  terminal: TerminalConfig;
  apps: AppsConfig;
  merge: MergeConfig;
  navigation: NavigationConfig;
  indicators: IndicatorsConfig;
  tasks: TaskConfig[];
  actions: ActionsConfig;
  scratch: ScratchConfig;
  worktree: WorktreeConfig;
  /** Opacity (0.0 to 1.0) applied to unfocused panes (main terminal or drawer) */
  unfocusedOpacity: number;
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
  unfocusedOpacity: 1,
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

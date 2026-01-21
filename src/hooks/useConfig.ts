import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { MergeStrategy } from '../types';

export interface TerminalConfig {
  fontFamily: string;
  fontSize: number;
  fontLigatures: boolean;
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

export type TaskKind = 'command' | 'daemon';

export interface TaskConfig {
  name: string;
  command: string;
  kind?: TaskKind;
  silent?: boolean;
  shell?: string;
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
}

export interface Config {
  main: MainConfig;
  terminal: TerminalConfig;
  merge: MergeConfig;
  mappings: MappingsConfig;
  tasks: TaskConfig[];
}

const defaultConfig: Config = {
  main: {
    command: 'claude',
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    fontSize: 13,
    fontLigatures: false,
  },
  terminal: {
    fontFamily: "Menlo, Monaco, 'Courier New', monospace",
    fontSize: 13,
    fontLigatures: false,
  },
  merge: {
    strategy: 'merge',
    deleteWorktree: true,
    deleteLocalBranch: false,
    deleteRemoteBranch: false,
  },
  mappings: {
    toggleDrawer: 'ctrl+`',
    toggleRightPanel: 'cmd+b',
    terminalCopy: { mac: 'cmd+c', other: 'ctrl+shift+c' },
    terminalPaste: { mac: 'cmd+v', other: 'ctrl+shift+v' },
    worktreePrev: { mac: 'cmd+k', other: 'ctrl+shift+k' },
    worktreeNext: { mac: 'cmd+j', other: 'ctrl+shift+j' },
    worktree1: { mac: 'cmd+1', other: 'ctrl+1' },
    worktree2: { mac: 'cmd+2', other: 'ctrl+2' },
    worktree3: { mac: 'cmd+3', other: 'ctrl+3' },
    worktree4: { mac: 'cmd+4', other: 'ctrl+4' },
    worktree5: { mac: 'cmd+5', other: 'ctrl+5' },
    worktree6: { mac: 'cmd+6', other: 'ctrl+6' },
    worktree7: { mac: 'cmd+7', other: 'ctrl+7' },
    worktree8: { mac: 'cmd+8', other: 'ctrl+8' },
    worktree9: { mac: 'cmd+9', other: 'ctrl+9' },
  },
  tasks: [],
};

export function useConfig(projectPath?: string) {
  const [config, setConfig] = useState<Config>(defaultConfig);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    invoke<Config>('get_config', { projectPath: projectPath ?? null })
      .then(setConfig)
      .catch((err) => {
        console.error('Failed to load config:', err);
      })
      .finally(() => setLoading(false));
  }, [projectPath]);

  return { config, loading };
}

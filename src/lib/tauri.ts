import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Project,
  Worktree,
  FileChange,
  MergeFeasibility,
  MergeWorkflowOptions,
  MergeWorkflowResult,
  CleanupOptions,
} from '../types';

// Project commands
export async function addProject(path: string): Promise<Project> {
  return invoke<Project>('add_project', { path });
}

export async function listProjects(): Promise<Project[]> {
  return invoke<Project[]>('list_projects');
}

// Worktree commands
export async function createWorktree(
  projectPath: string,
  name?: string
): Promise<Worktree> {
  return invoke<Worktree>('create_worktree', { projectPath, name });
}

export async function listWorktrees(projectPath: string): Promise<Worktree[]> {
  return invoke<Worktree[]>('list_worktrees', { projectPath });
}

export async function deleteWorktree(worktreeId: string): Promise<void> {
  return invoke('delete_worktree', { worktreeId });
}

// PTY commands
export async function spawnMain(worktreeId: string): Promise<string> {
  return invoke<string>('spawn_main', { worktreeId });
}

export async function spawnTerminal(worktreeId: string): Promise<string> {
  return invoke<string>('spawn_terminal', { worktreeId });
}

export async function spawnTask(
  worktreeId: string,
  taskName: string,
  cols?: number,
  rows?: number
): Promise<string> {
  return invoke<string>('spawn_task', { worktreeId, taskName, cols, rows });
}

export async function ptyWrite(ptyId: string, data: string): Promise<void> {
  return invoke('pty_write', { ptyId, data });
}

export async function ptyResize(
  ptyId: string,
  cols: number,
  rows: number
): Promise<void> {
  return invoke('pty_resize', { ptyId, cols, rows });
}

export async function ptyKill(ptyId: string): Promise<void> {
  return invoke('pty_kill', { ptyId });
}

export async function ptyForceKill(ptyId: string): Promise<void> {
  return invoke('pty_force_kill', { ptyId });
}

// Git commands
export async function getChangedFiles(worktreePath: string): Promise<FileChange[]> {
  return invoke<FileChange[]>('get_changed_files', { worktreePath });
}

// Dialog helpers
export async function selectFolder(): Promise<string | null> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: 'Select Git Repository',
  });
  return selected as string | null;
}

// Merge workflow commands
export async function checkMergeFeasibility(
  worktreePath: string
): Promise<MergeFeasibility> {
  return invoke<MergeFeasibility>('check_merge_feasibility', { worktreePath });
}

export async function executeMergeWorkflow(
  worktreeId: string,
  options: MergeWorkflowOptions
): Promise<MergeWorkflowResult> {
  return invoke<MergeWorkflowResult>('execute_merge_workflow', {
    worktreeId,
    options,
  });
}

export async function cleanupWorktree(
  worktreeId: string,
  options: CleanupOptions
): Promise<void> {
  return invoke<void>('cleanup_worktree', {
    worktreeId,
    options,
  });
}

// Shutdown command - gracefully terminates all PTY processes
// Returns true if there are processes to clean up (show UI), false otherwise
export async function shutdown(): Promise<boolean> {
  return invoke<boolean>('shutdown');
}

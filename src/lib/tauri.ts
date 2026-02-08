import { invoke } from '@tauri-apps/api/core';
import { open } from '@tauri-apps/plugin-dialog';
import {
  Project,
  Worktree,
  FileChange,
  MergeFeasibility,
  MergeWorkflowOptions,
  CleanupOptions,
  WorktreeDeleteStatus,
  DeleteWorktreeOptions,
  BranchInfo,
  DiffContent,
  ChangedFilesViewMode,
} from '../types';

// Project commands
export async function addProject(path: string): Promise<Project> {
  return invoke<Project>('add_project', { path });
}

export async function listProjects(): Promise<Project[]> {
  return invoke<Project[]>('list_projects');
}

export async function hideProject(projectId: string): Promise<void> {
  return invoke('hide_project', { projectId });
}

export async function touchProject(projectId: string): Promise<void> {
  return invoke('touch_project', { projectId });
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

export async function checkWorktreeDeleteStatus(
  worktreePath: string,
  projectPath?: string
): Promise<WorktreeDeleteStatus> {
  return invoke<WorktreeDeleteStatus>('check_worktree_delete_status', { worktreePath, projectPath });
}

export async function executeDeleteWorktreeWorkflow(
  worktreeId: string,
  options: DeleteWorktreeOptions
): Promise<void> {
  // Fire and forget - the command runs in a background thread
  // and emits 'delete-worktree-completed' event when done
  await invoke<void>('execute_delete_worktree_workflow', { worktreeId, options });
}

// Reorder commands
export async function reorderProjects(projectIds: string[]): Promise<void> {
  return invoke('reorder_projects', { projectIds });
}

export async function reorderWorktrees(
  projectId: string,
  worktreeIds: string[]
): Promise<void> {
  return invoke('reorder_worktrees', { projectId, worktreeIds });
}

// Git helpers
export async function gitStageAll(repoPath: string): Promise<void> {
  return invoke('git_stage_all', { repoPath });
}

export async function gitDiffCached(repoPath: string): Promise<string> {
  return invoke<string>('git_diff_cached', { repoPath });
}

export async function gitDiffCachedFiles(repoPath: string): Promise<string[]> {
  return invoke<string[]>('git_diff_cached_files', { repoPath });
}

export async function gitCommit(repoPath: string, message: string): Promise<void> {
  return invoke('git_commit', { repoPath, message });
}

export async function gitCurrentBranch(repoPath: string): Promise<string> {
  return invoke<string>('git_current_branch', { repoPath });
}

export async function gitBranchExists(repoPath: string, branch: string): Promise<boolean> {
  return invoke<boolean>('git_branch_exists', { repoPath, branch });
}

export async function gitCreateBranch(repoPath: string, branch: string): Promise<void> {
  return invoke('git_create_branch', { repoPath, branch });
}

export async function renameWorktreeBranch(worktreeId: string, newName: string): Promise<void> {
  return invoke('rename_worktree', { worktreeId, newName });
}

export async function gitPushCurrentBranch(repoPath: string): Promise<void> {
  return invoke('git_push_current_branch', { repoPath });
}

export async function gitMergeToMain(worktreePath: string, repoPath: string): Promise<void> {
  return invoke('git_merge_to_main', { worktreePath, repoPath });
}

export async function gitPushDefaultBranch(repoPath: string): Promise<void> {
  return invoke('git_push_default_branch', { repoPath });
}

// PTY commands
export async function spawnMain(worktreeId: string): Promise<string> {
  return invoke<string>('spawn_main', { worktreeId });
}

export async function spawnTerminal(worktreeId: string): Promise<string> {
  return invoke<string>('spawn_terminal', { worktreeId });
}

export async function spawnAction(
  worktreeId: string,
  prompt: string,
  cols?: number,
  rows?: number
): Promise<string> {
  return invoke<string>('spawn_action', { worktreeId, prompt, cols, rows });
}

export async function watchMergeState(worktreeId: string): Promise<void> {
  return invoke('watch_merge_state', { worktreeId });
}

export async function stopMergeWatcher(worktreeId: string): Promise<void> {
  return invoke('stop_merge_watcher', { worktreeId });
}

export async function watchRebaseState(worktreeId: string): Promise<void> {
  return invoke('watch_rebase_state', { worktreeId });
}

export async function stopRebaseWatcher(worktreeId: string): Promise<void> {
  return invoke('stop_rebase_watcher', { worktreeId });
}

export async function spawnTask(
  entityId: string,
  taskName: string,
  cols?: number,
  rows?: number
): Promise<string> {
  return invoke<string>('spawn_task', { entityId, taskName, cols, rows });
}

export interface NamedUrl {
  name: string;
  url: string;
}

export async function getTaskUrls(
  entityId: string,
  taskName: string
): Promise<NamedUrl[]> {
  return invoke<NamedUrl[]>('get_task_urls', { entityId, taskName });
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

export async function ptyInterrupt(ptyId: string): Promise<void> {
  return invoke('pty_interrupt', { ptyId });
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

export async function hasUncommittedChanges(projectPath: string): Promise<boolean> {
  return invoke<boolean>('has_uncommitted_changes', { projectPath });
}

export async function stashChanges(projectPath: string): Promise<string> {
  return invoke<string>('stash_changes', { projectPath });
}

export async function stashPop(projectPath: string, stashId: string): Promise<void> {
  return invoke<void>('stash_pop', { projectPath, stashId });
}

export async function abortMerge(projectPath: string): Promise<void> {
  return invoke<void>('abort_merge', { projectPath });
}

export async function abortRebase(projectPath: string): Promise<void> {
  return invoke<void>('abort_rebase', { projectPath });
}

export async function getBranchInfo(
  worktreePath: string,
  projectPath?: string
): Promise<BranchInfo> {
  return invoke<BranchInfo>('get_branch_info', { worktreePath, projectPath });
}

export async function getBranchChangedFiles(
  worktreePath: string,
  projectPath?: string
): Promise<FileChange[]> {
  return invoke<FileChange[]>('get_branch_changed_files', { worktreePath, projectPath });
}

export async function getFileDiffContent(
  worktreePath: string,
  filePath: string,
  mode: ChangedFilesViewMode,
  projectPath?: string
): Promise<DiffContent> {
  return invoke<DiffContent>('get_file_diff_content', { worktreePath, filePath, mode, projectPath });
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

// Config update
export async function updateConfig(patch: Record<string, unknown>): Promise<void> {
  await invoke('update_config', { patch });
}

// Action commands
export interface MergeOptions {
  deleteWorktree: boolean;
  deleteLocalBranch: boolean;
  deleteRemoteBranch: boolean;
}

export type MergeStrategy = 'merge' | 'rebase';

export interface ActionPromptContext {
  worktreeDir: string;
  worktreeName: string;
  branch: string;
  targetBranch: string;
  mergeOptions?: MergeOptions;
  strategy?: MergeStrategy;
}

export async function expandActionPrompt(
  actionName: string,
  context: ActionPromptContext,
  projectPath?: string
): Promise<string> {
  return invoke<string>('expand_action_prompt', { actionName, context, projectPath });
}

// Merge workflow commands
export async function checkMergeFeasibility(
  worktreePath: string,
  projectPath?: string
): Promise<MergeFeasibility> {
  return invoke<MergeFeasibility>('check_merge_feasibility', { worktreePath, projectPath });
}

export async function executeMergeWorkflow(
  worktreeId: string,
  options: MergeWorkflowOptions
): Promise<void> {
  // Fire and forget - the command runs in a background thread
  // and emits 'merge-completed' event when done
  await invoke<void>('execute_merge_workflow', {
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

// Update menu item enabled states based on action availability
export async function updateActionAvailability(availability: Record<string, boolean>): Promise<void> {
  return invoke<void>('update_action_availability', { availability });
}

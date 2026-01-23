export interface Project {
  id: string;
  name: string;
  path: string;
  worktrees: Worktree[];
  order?: number;
}

// Scratch terminal - a general-purpose terminal not tied to any project/worktree
export interface ScratchTerminal {
  id: string;
  name: string;
  order: number;
}

// Represents what's currently selected in the main content area
export type ActiveSelection =
  | { type: 'project'; projectId: string }
  | { type: 'worktree'; worktreeId: string }
  | { type: 'scratch'; scratchId: string }
  | null;

export interface Worktree {
  id: string;
  name: string;
  path: string;
  branch: string;
  createdAt: string;
  order?: number;
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
  insertions?: number;
  deletions?: number;
}

export interface PtyOutput {
  pty_id: string;
  data: string;
}

export interface FilesChanged {
  worktree_path: string;
  files: FileChange[];
}

// Merge workflow types
export type MergeStrategy = 'merge' | 'rebase';

export interface MergeFeasibility {
  canMerge: boolean;
  hasUncommittedChanges: boolean;
  isUpToDate: boolean;
  canFastForward: boolean;
  commitsAhead: number;
  commitsBehind: number;
  currentBranch: string;
  targetBranch: string;
  error: string | null;
}

export interface MergeWorkflowOptions {
  strategy: MergeStrategy;
  deleteWorktree: boolean;
  deleteLocalBranch: boolean;
  deleteRemoteBranch: boolean;
}

export interface MergeWorkflowResult {
  success: boolean;
  branchName: string;
  error: string | null;
}

export interface MergeCompleted {
  worktreeId: string;
  success: boolean;
  branchName: string;
  deletedWorktree: boolean;
  error: string | null;
}

export interface MergeProgress {
  phase: 'merge' | 'rebase' | 'delete-worktree' | 'delete-local-branch' | 'delete-remote-branch' | 'complete' | 'error';
  message: string;
}

export interface CleanupOptions {
  deleteWorktree: boolean;
  deleteLocalBranch: boolean;
  deleteRemoteBranch: boolean;
}

// Delete worktree workflow types
export interface DeleteWorktreeProgress {
  phase: 'stop-watcher' | 'remove-worktree' | 'save' | 'complete' | 'error';
  message: string;
}

export interface DeleteWorktreeCompleted {
  worktreeId: string;
  success: boolean;
  error: string | null;
}

// Task types
export type TaskKind = 'command' | 'daemon';

export interface RunningTask {
  taskName: string;
  ptyId: string;
  kind: TaskKind;
  status: 'running' | 'stopping' | 'stopped';
  worktreeId: string;
  exitCode?: number;
}

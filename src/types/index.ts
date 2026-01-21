export interface Project {
  id: string;
  name: string;
  path: string;
  worktrees: Worktree[];
}

// Represents what's currently selected in the main content area
export type ActiveSelection =
  | { type: 'project'; projectId: string }
  | { type: 'worktree'; worktreeId: string }
  | null;

export interface Worktree {
  id: string;
  name: string;
  path: string;
  branch: string;
  createdAt: string;
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

export interface MergeProgress {
  phase: 'merging' | 'cleanup' | 'complete' | 'error';
  message: string;
}

export interface CleanupOptions {
  deleteWorktree: boolean;
  deleteLocalBranch: boolean;
  deleteRemoteBranch: boolean;
}

// Task types
export type TaskKind = 'command' | 'daemon';

export interface RunningTask {
  taskName: string;
  ptyId: string;
  kind: TaskKind;
  status: 'running' | 'stopping' | 'stopped';
  worktreeId: string;
}

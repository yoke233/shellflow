export interface Project {
  id: string;
  name: string;
  path: string;
  worktrees: Worktree[];
  order?: number;
  isActive: boolean;
  lastAccessedAt?: string;
}

// Scratch terminal - a general-purpose terminal not tied to any project/worktree
export interface ScratchTerminal {
  id: string;
  name: string;
  order: number;
  /** Initial working directory for the terminal (used when spawning) */
  initialCwd?: string;
}

// Represents what's currently selected in the main content area
export type ActiveSelection =
  | { type: 'project'; projectId: string }
  | { type: 'worktree'; worktreeId: string }
  | { type: 'scratch'; scratchId: string }
  | null;

// Unified session concept - consolidates scratch, project, and worktree terminals
export type SessionKind = 'scratch' | 'project' | 'worktree';

export interface Session {
  id: string;
  kind: SessionKind;
  name: string;
  path: string;           // cwd for scratch, repo path for project, worktree path for worktree
  order: number;
  projectId?: string;     // only for worktrees (parent reference)
  branch?: string;        // only for worktrees
  initialCwd?: string;    // only for scratch (initial working directory when spawning)
}

// Indicator state for sessions (shown in sidebar)
export interface SessionIndicators {
  notified: boolean;
  thinking: boolean;
  idle: boolean;
}

// Indicator state for tabs (shown in tab bar)
export interface TabIndicators {
  notified: boolean;
  thinking: boolean;
  idle: boolean;
}

// Diff tab configuration
export interface DiffTabConfig {
  filePath: string;
  mode: ChangedFilesViewMode;
  worktreePath: string;
  projectPath?: string;
}

// Tab within a session (main pane tabs)
export interface SessionTab {
  id: string;           // e.g., "worktree-abc-session-1"
  label: string;        // e.g., "Terminal 1"
  isPrimary: boolean;   // First tab runs configured command
  /** For command tabs: command to run instead of shell/main command */
  command?: string;
  /** For command tabs: directory to run the command in */
  directory?: string;
  /** For diff tabs: diff viewer configuration */
  diff?: DiffTabConfig;
}

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

export type ChangedFilesViewMode = 'uncommitted' | 'branch';

export interface BranchInfo {
  currentBranch: string;
  baseBranch: string;
  isOnBaseBranch: boolean;
  commitsAhead: number;
}

export interface DiffContent {
  original: string;
  modified: string;
  originalLabel: string;
  modifiedLabel: string;
  language: string;
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
export interface WorktreeDeleteStatus {
  hasUncommittedChanges: boolean;
  unpushedCommits: number;
  branchName: string;
}

export interface DeleteWorktreeOptions {
  deleteBranch: boolean;
}

export interface DeleteWorktreeProgress {
  phase: 'stop-watcher' | 'remove-worktree' | 'delete-local-branch' | 'save' | 'complete' | 'error';
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

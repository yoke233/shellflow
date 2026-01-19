export interface Project {
  id: string;
  name: string;
  path: string;
  workspaces: Workspace[];
}

export interface Workspace {
  id: string;
  name: string;
  path: string;
  branch: string;
  createdAt: string;
}

export interface FileChange {
  path: string;
  status: 'added' | 'modified' | 'deleted' | 'renamed' | 'untracked';
}

export interface PtyOutput {
  pty_id: string;
  data: string;
}

export interface FilesChanged {
  workspace_path: string;
  files: FileChange[];
}

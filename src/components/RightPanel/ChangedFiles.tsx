import { FileDiff } from 'lucide-react';
import { FileChange, ChangedFilesViewMode } from '../../types';

interface ChangedFilesProps {
  files: FileChange[];
  isGitRepo?: boolean;
  loading?: boolean;
  mode?: ChangedFilesViewMode;
  onModeChange?: (mode: ChangedFilesViewMode) => void;
  showModeToggle?: boolean;
  onFileClick?: (path: string) => void;
  /** Currently selected file path (for highlighting) */
  selectedFile?: string | null;
  /** Callback to open the diff view */
  onOpenDiff?: () => void;
  /** Count of running main-pane tabs */
  runningTabCount?: number;
}

const statusConfig: Record<FileChange['status'], { color: string; label: string }> = {
  added: { color: 'text-green-400', label: 'A' },
  modified: { color: 'text-yellow-400', label: 'M' },
  deleted: { color: 'text-red-400', label: 'D' },
  renamed: { color: 'text-blue-400', label: 'R' },
  untracked: { color: 'text-theme-2', label: '?' },
};

export function ChangedFiles({
  files,
  isGitRepo = true,
  loading = false,
  mode = 'uncommitted',
  onModeChange,
  showModeToggle = false,
  onFileClick,
  selectedFile,
  onOpenDiff,
  runningTabCount = 0,
}: ChangedFilesProps) {
  // Calculate total insertions and deletions
  const totals = files.reduce(
    (acc, file) => ({
      insertions: acc.insertions + (file.insertions ?? 0),
      deletions: acc.deletions + (file.deletions ?? 0),
    }),
    { insertions: 0, deletions: 0 }
  );

  const hasChanges = totals.insertions > 0 || totals.deletions > 0;

  const getEmptyMessage = () => {
    if (!isGitRepo) {
      return 'Not a git repository';
    }
    if (showModeToggle) {
      return mode === 'uncommitted' ? 'No uncommitted changes' : 'No changes from base branch';
    }
    return 'No changes detected';
  };

  return (
    <div className="flex flex-col h-full select-none">
      {showModeToggle && (
        <div className="px-3 py-2 border-b border-theme-0 flex items-center justify-between">
          <div className="flex gap-1">
            <button
              onClick={() => onModeChange?.('uncommitted')}
              className={`px-2 py-1 text-xs rounded ${
                mode === 'uncommitted'
                  ? 'bg-theme-3 text-theme-1'
                  : 'text-theme-2 hover:bg-theme-2'
              }`}
            >
              Uncommitted
            </button>
            <button
              onClick={() => onModeChange?.('branch')}
              className={`px-2 py-1 text-xs rounded ${
                mode === 'branch'
                  ? 'bg-theme-3 text-theme-1'
                  : 'text-theme-2 hover:bg-theme-2'
              }`}
            >
              Branch
            </button>
          </div>
          {files.length > 0 && onOpenDiff && (
            <button
              onClick={onOpenDiff}
              className="p-1 rounded text-theme-2 hover:bg-theme-2 hover:text-theme-1"
              title="Open Diff View (Cmd+Shift+D)"
              data-testid="open-diff-button"
            >
              <FileDiff className="w-3.5 h-3.5" />
            </button>
          )}
        </div>
      )}
      <div className="px-3 py-2 border-b border-theme-0 flex items-center justify-between">
        <span className="text-xs text-theme-3">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
        <div className="flex items-center gap-2">
          <span
            className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] ${
              runningTabCount > 0
                ? 'border-emerald-400/40 bg-emerald-400/10 text-emerald-300'
                : 'border-theme-0/60 text-theme-3'
            }`}
            title="Running tabs"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${runningTabCount > 0 ? 'bg-emerald-400' : 'bg-theme-3'}`} />
            Tabs {runningTabCount}
          </span>
          {hasChanges && (
            <span className="text-xs font-mono">
              <span className="text-green-400">+{totals.insertions}</span>
              {' '}
              <span className="text-red-400">-{totals.deletions}</span>
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {loading ? (
          <div className="p-4 text-center text-theme-3 text-sm">
            Loading...
          </div>
        ) : files.length === 0 || !isGitRepo ? (
          <div className="p-4 text-center text-theme-3 text-sm">
            {getEmptyMessage()}
          </div>
        ) : (
          <ul className="py-1">
            {files.map((file) => {
              const config = statusConfig[file.status];
              const isSelected = selectedFile === file.path;
              return (
                <li
                  key={file.path}
                  className={`flex items-center gap-2 px-3 py-1.5 group ${
                    isSelected
                      ? 'bg-theme-3'
                      : 'hover:bg-theme-2'
                  } ${onFileClick ? 'cursor-pointer' : ''}`}
                  onClick={() => onFileClick?.(file.path)}
                >
                  <span className={`flex-shrink-0 w-4 text-xs font-mono ${config.color}`}>
                    {config.label}
                  </span>
                  <span className="text-sm text-theme-1 truncate flex-1" title={file.path}>
                    {file.path}
                  </span>
                  {(file.insertions !== undefined || file.deletions !== undefined) && (
                    <span className="text-xs font-mono flex-shrink-0">
                      {file.insertions !== undefined && file.insertions > 0 && (
                        <span className="text-green-400">+{file.insertions}</span>
                      )}
                      {file.insertions !== undefined && file.insertions > 0 && file.deletions !== undefined && file.deletions > 0 && ' '}
                      {file.deletions !== undefined && file.deletions > 0 && (
                        <span className="text-red-400">-{file.deletions}</span>
                      )}
                    </span>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

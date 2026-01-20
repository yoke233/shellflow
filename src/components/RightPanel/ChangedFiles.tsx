import { FileChange } from '../../types';

interface ChangedFilesProps {
  files: FileChange[];
}

const statusConfig: Record<FileChange['status'], { color: string; label: string }> = {
  added: { color: 'text-green-400', label: 'A' },
  modified: { color: 'text-yellow-400', label: 'M' },
  deleted: { color: 'text-red-400', label: 'D' },
  renamed: { color: 'text-blue-400', label: 'R' },
  untracked: { color: 'text-zinc-400', label: '?' },
};

export function ChangedFiles({ files }: ChangedFilesProps) {
  return (
    <div className="flex flex-col h-full select-none">
      <div className="px-3 py-2 border-b border-zinc-800 flex items-center justify-between">
        <h3 className="text-xs font-semibold text-zinc-400 uppercase tracking-wider">
          Changed Files
        </h3>
        <span className="text-xs text-zinc-500">
          {files.length} {files.length === 1 ? 'file' : 'files'}
        </span>
      </div>
      <div className="flex-1 overflow-y-auto">
        {files.length === 0 ? (
          <div className="p-4 text-center text-zinc-500 text-sm">
            No changes detected
          </div>
        ) : (
          <ul className="py-1">
            {files.map((file) => {
              const config = statusConfig[file.status];
              return (
                <li
                  key={file.path}
                  className="flex items-center gap-2 px-3 py-1.5 hover:bg-zinc-800 group"
                >
                  <span className={`flex-shrink-0 w-4 text-xs font-mono ${config.color}`}>
                    {config.label}
                  </span>
                  <span className="text-sm text-zinc-300 truncate flex-1" title={file.path}>
                    {file.path}
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

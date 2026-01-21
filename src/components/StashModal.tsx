interface StashModalProps {
  projectName: string;
  onStashAndCreate: () => void;
  onCancel: () => void;
  isLoading?: boolean;
  error?: string | null;
}

export function StashModal({
  projectName,
  onStashAndCreate,
  onCancel,
  isLoading = false,
  error = null,
}: StashModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={isLoading ? undefined : onCancel} />
      <div className="relative bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl p-6 max-w-md w-full mx-4">
        <h2 className="text-lg font-semibold text-zinc-100 mb-2">
          Uncommitted Changes
        </h2>
        <p className="text-zinc-400 mb-4">
          <span className="font-medium text-zinc-300">{projectName}</span> has uncommitted changes.
          Would you like to stash them before creating the worktree?
        </p>
        <p className="text-zinc-500 text-sm mb-4">
          Your changes will be automatically restored after the worktree is created.
        </p>

        {error && (
          <div className="mb-4 p-3 bg-red-900/30 border border-red-700 rounded text-sm text-red-300">
            <p className="font-medium mb-1">Failed to create worktree:</p>
            <p className="text-red-400 font-mono text-xs break-all">{error}</p>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <button
            onClick={onCancel}
            disabled={isLoading}
            className="px-4 py-2 text-sm text-zinc-300 hover:text-zinc-100 hover:bg-zinc-800 rounded disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Cancel
          </button>
          <button
            onClick={onStashAndCreate}
            disabled={isLoading}
            className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                  <circle
                    className="opacity-25"
                    cx="12"
                    cy="12"
                    r="10"
                    stroke="currentColor"
                    strokeWidth="4"
                    fill="none"
                  />
                  <path
                    className="opacity-75"
                    fill="currentColor"
                    d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                  />
                </svg>
                Creating...
              </>
            ) : error ? (
              'Retry'
            ) : (
              'Stash & Create'
            )}
          </button>
        </div>
      </div>
    </div>
  );
}

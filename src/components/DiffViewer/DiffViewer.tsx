import { useState, useEffect, useRef } from 'react';
import { DiffEditor, loader } from '@monaco-editor/react';
import type { editor } from 'monaco-editor';
import { getFileDiffContent } from '../../lib/tauri';
import type { DiffContent, ChangedFilesViewMode } from '../../types';
import { TerminalConfig } from '../../hooks/useConfig';
import { useTheme } from '../../theme';

const SHELLFLOW_THEME_NAME = 'shellflow-theme';

interface DiffViewerProps {
  worktreePath: string;
  filePath: string;
  mode: ChangedFilesViewMode;
  projectPath?: string;
  onClose: () => void;
  terminalConfig?: TerminalConfig;
}

export function DiffViewer({
  worktreePath,
  filePath,
  mode,
  projectPath,
  terminalConfig,
}: DiffViewerProps) {
  const [diffContent, setDiffContent] = useState<DiffContent | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'split' | 'unified'>('split');
  const [themeRegistered, setThemeRegistered] = useState(false);
  const { theme } = useTheme();
  const monacoRef = useRef<typeof import('monaco-editor') | null>(null);

  // Register theme with Monaco when available
  useEffect(() => {
    if (!theme?.monaco) return;

    loader.init().then((monaco) => {
      monacoRef.current = monaco;
      monaco.editor.defineTheme(SHELLFLOW_THEME_NAME, theme.monaco);
      setThemeRegistered(true);
    });
  }, []);

  // Update theme when it changes
  useEffect(() => {
    if (!theme?.monaco || !monacoRef.current) return;

    monacoRef.current.editor.defineTheme(SHELLFLOW_THEME_NAME, theme.monaco);
    // Force editors to pick up the new theme
    monacoRef.current.editor.setTheme(SHELLFLOW_THEME_NAME);
  }, [theme?.monaco]);

  useEffect(() => {
    let cancelled = false;

    async function fetchDiff() {
      setLoading(true);
      setError(null);

      try {
        const content = await getFileDiffContent(worktreePath, filePath, mode, projectPath);
        if (!cancelled) {
          setDiffContent(content);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to fetch diff content:', err);
          setError(err instanceof Error ? err.message : String(err));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    fetchDiff();

    return () => {
      cancelled = true;
    };
  }, [worktreePath, filePath, mode, projectPath]);

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center bg-theme-1 text-theme-2">
        Loading diff...
      </div>
    );
  }

  if (error) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-theme-1 text-theme-2 gap-4">
        <span className="text-red-400">Failed to load diff: {error}</span>
      </div>
    );
  }

  if (!diffContent) {
    return null;
  }

  return (
    <div className="h-full flex flex-col bg-theme-1">
      {/* Header with labels and view mode toggle */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-theme-0 bg-theme-2">
        <div className="flex items-center gap-4 text-xs text-theme-3">
          <span>{diffContent.originalLabel}</span>
          <span className="text-theme-4">→</span>
          <span>{diffContent.modifiedLabel}</span>
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={() => setViewMode('split')}
            className={`px-2 py-0.5 text-xs rounded ${
              viewMode === 'split'
                ? 'bg-theme-4 text-theme-1'
                : 'text-theme-2 hover:bg-theme-3'
            }`}
          >
            Split
          </button>
          <button
            onClick={() => setViewMode('unified')}
            className={`px-2 py-0.5 text-xs rounded ${
              viewMode === 'unified'
                ? 'bg-theme-4 text-theme-1'
                : 'text-theme-2 hover:bg-theme-3'
            }`}
          >
            Unified
          </button>
        </div>
      </div>

      {/* Monaco Diff Editor */}
      <div className="flex-1">
        <DiffEditor
          original={diffContent.original}
          modified={diffContent.modified}
          language={diffContent.language}
          theme={themeRegistered ? SHELLFLOW_THEME_NAME : (theme?.type === 'light' ? 'vs' : 'vs-dark')}
          onMount={(diffEditor: editor.IStandaloneDiffEditor) => {
            // Ensure word wrap is applied to both editors
            diffEditor.getOriginalEditor().updateOptions({ wordWrap: 'on' });
            diffEditor.getModifiedEditor().updateOptions({ wordWrap: 'on' });
          }}
          options={{
            readOnly: true,
            renderSideBySide: viewMode === 'split',
            // Required for word wrap to work on the original (left) side in split view
            // See: https://github.com/microsoft/monaco-editor/discussions/4454
            useInlineViewWhenSpaceIsLimited: false,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            fontSize: terminalConfig?.fontSize ?? 13,
            fontFamily: terminalConfig?.fontFamily ?? 'Menlo, Monaco, "Courier New", monospace',
            lineNumbers: 'on',
            renderWhitespace: 'trailing',
            wordWrap: 'on',
            diffWordWrap: 'inherit',
            // Hide indicators (the +/- symbols in the gutter)
            renderIndicators: false,
            // Keep overview ruler for diff markers but hide its border
            overviewRulerBorder: false,
            scrollbar: {
              vertical: 'auto',
              verticalScrollbarSize: 1,
              horizontal: 'auto',
              horizontalScrollbarSize: 8,
              useShadows: false,
            },
          }}
        />
      </div>
    </div>
  );
}

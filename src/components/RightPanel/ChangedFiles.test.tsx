import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChangedFiles } from './ChangedFiles';
import type { FileChange } from '../../types';

describe('ChangedFiles', () => {
  describe('empty state', () => {
    it('shows "No changes detected" when files array is empty', () => {
      render(<ChangedFiles files={[]} />);
      expect(screen.getByText('No changes detected')).toBeInTheDocument();
    });

    it('shows "0 files" in header when empty', () => {
      render(<ChangedFiles files={[]} />);
      expect(screen.getByText('0 files')).toBeInTheDocument();
    });
  });

  describe('not a git repo state', () => {
    it('shows "Not a git repository" when isGitRepo is false', () => {
      render(<ChangedFiles files={[]} isGitRepo={false} />);
      expect(screen.getByText('Not a git repository')).toBeInTheDocument();
    });

    it('does not show "No changes detected" when not a git repo', () => {
      render(<ChangedFiles files={[]} isGitRepo={false} />);
      expect(screen.queryByText('No changes detected')).not.toBeInTheDocument();
    });
  });

  describe('file counts', () => {
    it('shows singular "1 file" for single file', () => {
      const files: FileChange[] = [{ path: 'src/app.ts', status: 'modified' }];
      render(<ChangedFiles files={files} />);
      expect(screen.getByText('1 file')).toBeInTheDocument();
    });

    it('shows plural "3 files" for multiple files', () => {
      const files: FileChange[] = [
        { path: 'src/app.ts', status: 'modified' },
        { path: 'src/index.ts', status: 'added' },
        { path: 'src/utils.ts', status: 'deleted' },
      ];
      render(<ChangedFiles files={files} />);
      expect(screen.getByText('3 files')).toBeInTheDocument();
    });
  });

  describe('status indicators', () => {
    it('shows A with green color for added files', () => {
      const files: FileChange[] = [{ path: 'new-file.ts', status: 'added' }];
      render(<ChangedFiles files={files} />);

      const indicator = screen.getByText('A');
      expect(indicator).toBeInTheDocument();
      expect(indicator.className).toContain('text-green-400');
    });

    it('shows M with yellow color for modified files', () => {
      const files: FileChange[] = [{ path: 'changed.ts', status: 'modified' }];
      render(<ChangedFiles files={files} />);

      const indicator = screen.getByText('M');
      expect(indicator).toBeInTheDocument();
      expect(indicator.className).toContain('text-yellow-400');
    });

    it('shows D with red color for deleted files', () => {
      const files: FileChange[] = [{ path: 'removed.ts', status: 'deleted' }];
      render(<ChangedFiles files={files} />);

      const indicator = screen.getByText('D');
      expect(indicator).toBeInTheDocument();
      expect(indicator.className).toContain('text-red-400');
    });

    it('shows R with blue color for renamed files', () => {
      const files: FileChange[] = [{ path: 'renamed.ts', status: 'renamed' }];
      render(<ChangedFiles files={files} />);

      const indicator = screen.getByText('R');
      expect(indicator).toBeInTheDocument();
      expect(indicator.className).toContain('text-blue-400');
    });

    it('shows ? with zinc color for untracked files', () => {
      const files: FileChange[] = [{ path: 'untracked.ts', status: 'untracked' }];
      render(<ChangedFiles files={files} />);

      const indicator = screen.getByText('?');
      expect(indicator).toBeInTheDocument();
      expect(indicator.className).toContain('text-theme-2');
    });
  });

  describe('path display', () => {
    it('shows file paths', () => {
      const files: FileChange[] = [
        { path: 'src/components/Button.tsx', status: 'modified' },
      ];
      render(<ChangedFiles files={files} />);
      expect(screen.getByText('src/components/Button.tsx')).toBeInTheDocument();
    });

    it('has title attribute for full path on hover', () => {
      const files: FileChange[] = [
        { path: 'src/components/very/deeply/nested/Component.tsx', status: 'modified' },
      ];
      render(<ChangedFiles files={files} />);
      const pathElement = screen.getByText('src/components/very/deeply/nested/Component.tsx');
      expect(pathElement).toHaveAttribute('title', 'src/components/very/deeply/nested/Component.tsx');
    });
  });

  describe('insertions and deletions', () => {
    it('shows insertions in green', () => {
      const files: FileChange[] = [
        { path: 'src/app.ts', status: 'modified', insertions: 25 },
      ];
      render(<ChangedFiles files={files} />);

      // Find all elements with +25 - there should be one in header and one in file row
      const insertions = screen.getAllByText('+25');
      expect(insertions.length).toBeGreaterThan(0);
      // At least one should have green color
      const hasGreen = insertions.some((el) => el.className.includes('text-green-400'));
      expect(hasGreen).toBe(true);
    });

    it('shows deletions in red', () => {
      const files: FileChange[] = [
        { path: 'src/app.ts', status: 'modified', deletions: 10 },
      ];
      render(<ChangedFiles files={files} />);

      // Find all elements with -10 - there should be one in header and one in file row
      const deletions = screen.getAllByText('-10');
      expect(deletions.length).toBeGreaterThan(0);
      // At least one should have red color
      const hasRed = deletions.some((el) => el.className.includes('text-red-400'));
      expect(hasRed).toBe(true);
    });

    it('shows both insertions and deletions', () => {
      const files: FileChange[] = [
        { path: 'src/app.ts', status: 'modified', insertions: 15, deletions: 5 },
      ];
      render(<ChangedFiles files={files} />);

      expect(screen.getAllByText('+15').length).toBeGreaterThan(0);
      expect(screen.getAllByText('-5').length).toBeGreaterThan(0);
    });

    it('does not show stats when insertions is 0', () => {
      const files: FileChange[] = [
        { path: 'src/app.ts', status: 'modified', insertions: 0, deletions: 0 },
      ];
      render(<ChangedFiles files={files} />);

      expect(screen.queryByText('+0')).not.toBeInTheDocument();
      expect(screen.queryByText('-0')).not.toBeInTheDocument();
    });

    it('handles undefined insertions/deletions', () => {
      const files: FileChange[] = [{ path: 'src/app.ts', status: 'untracked' }];
      render(<ChangedFiles files={files} />);

      // Should not crash and should render the file
      expect(screen.getByText('src/app.ts')).toBeInTheDocument();
    });
  });

  describe('totals', () => {
    it('shows correct sum in header', () => {
      const files: FileChange[] = [
        { path: 'file1.ts', status: 'modified', insertions: 10, deletions: 5 },
        { path: 'file2.ts', status: 'added', insertions: 20, deletions: 0 },
        { path: 'file3.ts', status: 'modified', insertions: 5, deletions: 15 },
      ];
      render(<ChangedFiles files={files} />);

      // Total insertions: 10 + 20 + 5 = 35
      // Total deletions: 5 + 0 + 15 = 20
      expect(screen.getByText('+35')).toBeInTheDocument();
      expect(screen.getByText('-20')).toBeInTheDocument();
    });

    it('handles mixed defined/undefined stats in totals', () => {
      const files: FileChange[] = [
        { path: 'file1.ts', status: 'modified', insertions: 10, deletions: 5 },
        { path: 'file2.ts', status: 'untracked' }, // No stats
        { path: 'file3.ts', status: 'added', insertions: 15 }, // No deletions
      ];
      render(<ChangedFiles files={files} />);

      // Total insertions: 10 + 0 + 15 = 25
      // Total deletions: 5 + 0 + 0 = 5
      expect(screen.getAllByText('+25').length).toBeGreaterThan(0);
      expect(screen.getAllByText('-5').length).toBeGreaterThan(0);
    });

    it('does not show totals when all stats are 0', () => {
      const files: FileChange[] = [
        { path: 'file1.ts', status: 'untracked' },
        { path: 'file2.ts', status: 'untracked' },
      ];
      render(<ChangedFiles files={files} />);

      // Should not show any +/- totals in header
      const header = screen.getByText('2 files').parentElement;
      expect(header?.textContent).not.toContain('+');
      expect(header?.textContent).not.toContain('-');
    });
  });

  describe('mode toggle', () => {
    it('does not show toggle when showModeToggle is false', () => {
      render(<ChangedFiles files={[]} showModeToggle={false} />);
      expect(screen.queryByText('Uncommitted')).not.toBeInTheDocument();
      expect(screen.queryByText('Branch')).not.toBeInTheDocument();
    });

    it('shows toggle when showModeToggle is true', () => {
      render(<ChangedFiles files={[]} showModeToggle={true} mode="uncommitted" />);
      expect(screen.getByText('Uncommitted')).toBeInTheDocument();
      expect(screen.getByText('Branch')).toBeInTheDocument();
    });

    it('highlights active mode button', () => {
      render(<ChangedFiles files={[]} showModeToggle={true} mode="uncommitted" />);

      const uncommittedBtn = screen.getByText('Uncommitted');
      const branchBtn = screen.getByText('Branch');

      // Uncommitted should be active (has bg-theme-3)
      expect(uncommittedBtn.className).toContain('bg-theme-3');
      expect(branchBtn.className).not.toContain('bg-theme-3');
    });

    it('highlights branch mode when active', () => {
      render(<ChangedFiles files={[]} showModeToggle={true} mode="branch" />);

      const uncommittedBtn = screen.getByText('Uncommitted');
      const branchBtn = screen.getByText('Branch');

      expect(branchBtn.className).toContain('bg-theme-3');
      expect(uncommittedBtn.className).not.toContain('bg-theme-3');
    });

    it('calls onModeChange when clicking toggle buttons', async () => {
      const user = userEvent.setup();
      const onModeChange = vi.fn();

      render(
        <ChangedFiles
          files={[]}
          showModeToggle={true}
          mode="uncommitted"
          onModeChange={onModeChange}
        />
      );

      await user.click(screen.getByText('Branch'));
      expect(onModeChange).toHaveBeenCalledWith('branch');
    });

    it('shows different empty message for uncommitted mode', () => {
      render(<ChangedFiles files={[]} showModeToggle={true} mode="uncommitted" />);
      expect(screen.getByText('No uncommitted changes')).toBeInTheDocument();
    });

    it('shows different empty message for branch mode', () => {
      render(<ChangedFiles files={[]} showModeToggle={true} mode="branch" />);
      expect(screen.getByText('No changes from base branch')).toBeInTheDocument();
    });
  });

  describe('file click handler', () => {
    it('calls onFileClick when a file is clicked', async () => {
      const user = userEvent.setup();
      const onFileClick = vi.fn();
      const files: FileChange[] = [{ path: 'src/app.ts', status: 'modified' }];

      render(<ChangedFiles files={files} onFileClick={onFileClick} />);

      await user.click(screen.getByText('src/app.ts'));
      expect(onFileClick).toHaveBeenCalledWith('src/app.ts');
    });

    it('shows pointer cursor when onFileClick is provided', () => {
      const files: FileChange[] = [{ path: 'src/app.ts', status: 'modified' }];
      render(<ChangedFiles files={files} onFileClick={vi.fn()} />);

      const fileItem = screen.getByText('src/app.ts').closest('li');
      expect(fileItem?.className).toContain('cursor-pointer');
    });
  });

  describe('loading state', () => {
    it('shows loading indicator when loading is true', () => {
      render(<ChangedFiles files={[]} loading={true} />);
      // Could be a spinner or text
      expect(screen.getByText('Loading...')).toBeInTheDocument();
    });
  });

  describe('selected file highlighting', () => {
    it('highlights the selected file', () => {
      const files: FileChange[] = [
        { path: 'src/app.ts', status: 'modified' },
        { path: 'src/utils.ts', status: 'added' },
      ];
      render(<ChangedFiles files={files} selectedFile="src/app.ts" onFileClick={vi.fn()} />);

      const selectedItem = screen.getByText('src/app.ts').closest('li');
      const unselectedItem = screen.getByText('src/utils.ts').closest('li');

      expect(selectedItem?.className).toContain('bg-theme-3');
      expect(unselectedItem?.className).not.toContain('bg-theme-3');
    });

    it('does not highlight any file when selectedFile is null', () => {
      const files: FileChange[] = [
        { path: 'src/app.ts', status: 'modified' },
        { path: 'src/utils.ts', status: 'added' },
      ];
      render(<ChangedFiles files={files} selectedFile={null} onFileClick={vi.fn()} />);

      const item1 = screen.getByText('src/app.ts').closest('li');
      const item2 = screen.getByText('src/utils.ts').closest('li');

      // Neither should have selected background
      expect(item1?.className).not.toContain('bg-theme-3');
      expect(item2?.className).not.toContain('bg-theme-3');
    });

    it('updates highlight when selectedFile changes', () => {
      const files: FileChange[] = [
        { path: 'src/app.ts', status: 'modified' },
        { path: 'src/utils.ts', status: 'added' },
      ];
      const { rerender } = render(
        <ChangedFiles files={files} selectedFile="src/app.ts" onFileClick={vi.fn()} />
      );

      // First file should be highlighted
      expect(screen.getByText('src/app.ts').closest('li')?.className).toContain('bg-theme-3');

      // Change selected file
      rerender(
        <ChangedFiles files={files} selectedFile="src/utils.ts" onFileClick={vi.fn()} />
      );

      // Second file should now be highlighted
      expect(screen.getByText('src/utils.ts').closest('li')?.className).toContain('bg-theme-3');
      expect(screen.getByText('src/app.ts').closest('li')?.className).not.toContain('bg-theme-3');
    });
  });

  describe('open diff button', () => {
    it('shows diff button when files exist and onOpenDiff is provided', () => {
      const files: FileChange[] = [{ path: 'src/app.ts', status: 'modified' }];
      render(
        <ChangedFiles
          files={files}
          showModeToggle={true}
          onOpenDiff={vi.fn()}
          openDiffShortcut="Ctrl+Shift+D"
        />
      );

      expect(screen.getByTestId('open-diff-button')).toBeInTheDocument();
    });

    it('does not show diff button when no files exist', () => {
      render(<ChangedFiles files={[]} showModeToggle={true} onOpenDiff={vi.fn()} />);

      expect(screen.queryByTestId('open-diff-button')).not.toBeInTheDocument();
    });

    it('does not show diff button when onOpenDiff is not provided', () => {
      const files: FileChange[] = [{ path: 'src/app.ts', status: 'modified' }];
      render(<ChangedFiles files={files} showModeToggle={true} />);

      expect(screen.queryByTestId('open-diff-button')).not.toBeInTheDocument();
    });

    it('does not show diff button when showModeToggle is false', () => {
      const files: FileChange[] = [{ path: 'src/app.ts', status: 'modified' }];
      render(<ChangedFiles files={files} showModeToggle={false} onOpenDiff={vi.fn()} />);

      expect(screen.queryByTestId('open-diff-button')).not.toBeInTheDocument();
    });

    it('calls onOpenDiff when diff button is clicked', async () => {
      const user = userEvent.setup();
      const onOpenDiff = vi.fn();
      const files: FileChange[] = [{ path: 'src/app.ts', status: 'modified' }];

      render(<ChangedFiles files={files} showModeToggle={true} onOpenDiff={onOpenDiff} />);

      await user.click(screen.getByTestId('open-diff-button'));
      expect(onOpenDiff).toHaveBeenCalledTimes(1);
    });

    it('has keyboard shortcut hint in title', () => {
      const files: FileChange[] = [{ path: 'src/app.ts', status: 'modified' }];
      render(<ChangedFiles files={files} showModeToggle={true} onOpenDiff={vi.fn()} />);

      const button = screen.getByTestId('open-diff-button');
      expect(button.title).toContain('Ctrl+Shift+D');
    });
  });
});

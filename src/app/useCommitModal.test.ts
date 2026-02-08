import { describe, it, expect } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useCommitModal } from './useCommitModal';

const getContext = () => ({
  repoPath: '/repo',
  projectPath: null,
  worktreePath: null,
  worktreeId: null,
});

describe('useCommitModal branch name', () => {
  it('derives branch name from conventional commit with scope', () => {
    const { result } = renderHook(() => useCommitModal({ getContext }));

    act(() => {
      result.current.setMessage('feature(ssss): sssssss');
    });

    expect(result.current.suggestedBranchName).toBe('feature/ssss-sssssss');
  });

  it('derives branch name from conventional commit without scope', () => {
    const { result } = renderHook(() => useCommitModal({ getContext }));

    act(() => {
      result.current.setMessage('fix: handle null');
    });

    expect(result.current.suggestedBranchName).toBe('fix/handle-null');
  });
});

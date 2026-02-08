import { useCallback, useMemo, useRef, useState } from 'react';
import type { CommitConfig } from '../hooks/useConfig';
import {
  gitStageAll,
  gitDiffCached,
  gitDiffCachedFiles,
  gitCommit,
  gitCurrentBranch,
  gitBranchExists,
  gitCreateBranch,
  renameWorktreeBranch,
  gitPushCurrentBranch,
  gitMergeToMain,
  gitPushDefaultBranch,
} from '../lib/tauri';

type CommitContext = {
  repoPath: string;
  projectPath: string | null;
  worktreePath: string | null;
  worktreeId: string | null;
};

interface UseCommitModalArgs {
  getContext: () => CommitContext | null;
  commitConfig?: CommitConfig;
}

function resolveCommitEndpoint(baseUrl: string): string {
  const trimmed = baseUrl.replace(/\/+$/, '');
  if (trimmed.endsWith('/chat/completions')) return trimmed;
  return `${trimmed}/chat/completions`;
}

function applyPromptTemplate(template: string, vars: Record<string, string>): string {
  let result = template;
  for (const [key, value] of Object.entries(vars)) {
    result = result.split(`{{ ${key} }}`).join(value).split(`{{${key}}}`).join(value);
  }
  return result;
}

function getRepoName(repoPath: string): string {
  const normalized = repoPath.replace(/\\/g, '/');
  const parts = normalized.split('/').filter(Boolean);
  return parts[parts.length - 1] ?? repoPath;
}

function slugifySegment(value: string): string {
  let slug = value.toLowerCase();
  slug = slug.replace(/['"`]/g, '');
  slug = slug.replace(/[^a-z0-9]+/g, '-');
  slug = slug.replace(/-+/g, '-');
  slug = slug.replace(/^[-]+|[-]+$/g, '');
  return slug;
}

function deriveBranchName(message: string): string {
  const firstLine = message.split(/\r?\n/)[0]?.trim();
  if (!firstLine) return '';

  const conventional = /^([a-z0-9]+)(!?)(?:\(([^)]+)\))?\s*:\s*(.+)$/i.exec(firstLine);
  if (conventional) {
    const type = slugifySegment(conventional[1] ?? '');
    const scope = conventional[3] ? slugifySegment(conventional[3]) : '';
    const subject = slugifySegment(conventional[4] ?? '');
    if (type && subject) {
      if (scope) return `${type}/${scope}-${subject}`;
      return `${type}/${subject}`;
    }
  }

  let slug = firstLine.toLowerCase();
  slug = slug.replace(/['"`]/g, '');
  slug = slug.replace(/[^a-z0-9/-]+/g, '-');
  slug = slug.replace(/-+/g, '-');
  slug = slug.replace(/\/+/g, '/');
  slug = slug.replace(/^[-/.]+|[-/.]+$/g, '');
  return slug;
}

async function requestCommitMessage(config: CommitConfig, prompt: string): Promise<string> {
  const endpoint = resolveCommitEndpoint(config.ai.baseUrl);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), config.ai.timeoutMs ?? 15000);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${config.ai.apiKey}`,
      },
      body: JSON.stringify({
        model: config.ai.model,
        messages: [{ role: 'user', content: prompt }],
        temperature: config.ai.temperature,
        max_tokens: config.ai.maxTokens,
      }),
      signal: controller.signal,
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`生成失败: ${text || response.statusText}`);
    }

    const data = await response.json();
    const content =
      data?.choices?.[0]?.message?.content ??
      data?.choices?.[0]?.text ??
      '';
    return String(content).trim();
  } finally {
    clearTimeout(timeout);
  }
}

export function useCommitModal({ getContext, commitConfig }: UseCommitModalArgs) {
  const [isOpen, setIsOpen] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [isBusy, setIsBusy] = useState(false);
  const [busyLabel, setBusyLabel] = useState<string | null>(null);
  const [hasCommitted, setHasCommitted] = useState(false);
  const [canMergeToMain, setCanMergeToMain] = useState(false);
  const [canCreateBranch, setCanCreateBranch] = useState(false);
  const [canRenameBranch, setCanRenameBranch] = useState(false);
  const [branchName, setBranchName] = useState('');
  const [currentBranch, setCurrentBranch] = useState<string | null>(null);
  const contextRef = useRef<CommitContext | null>(null);

  const suggestedBranchName = useMemo(() => deriveBranchName(message), [message]);

  const open = useCallback(() => {
    const context = getContext();
    if (!context) {
      return false;
    }
    contextRef.current = context;
    setIsOpen(true);
    setMessage('');
    setError(null);
    setHasCommitted(false);
    setCanMergeToMain(!!context.worktreePath);
    setCanCreateBranch(!context.worktreePath);
    setCanRenameBranch(!!context.worktreeId);
    setBranchName('');
    setCurrentBranch(null);
    gitCurrentBranch(context.repoPath)
      .then((branch) => setCurrentBranch(branch))
      .catch(() => setCurrentBranch(null));
    return true;
  }, [getContext]);

  const close = useCallback(() => {
    setIsOpen(false);
    setError(null);
    setBusyLabel(null);
    setIsBusy(false);
    setBranchName('');
    setCurrentBranch(null);
    setCanCreateBranch(false);
    setCanRenameBranch(false);
  }, []);

  const ensureContext = useCallback(() => {
    if (!contextRef.current) {
      setError('无法定位当前仓库。请重新打开提交窗口。');
      return null;
    }
    return contextRef.current;
  }, []);

  const generate = useCallback(async () => {
    const context = ensureContext();
    if (!context) return;
    if (!commitConfig?.ai?.baseUrl || !commitConfig?.ai?.apiKey || !commitConfig?.ai?.model) {
      setError('请先在设置里配置 commit.ai 的 baseUrl / apiKey / model。');
      return;
    }

    setError(null);
    setIsBusy(true);
    setBusyLabel('正在生成提交信息...');
    try {
      await gitStageAll(context.repoPath);
      const diff = await gitDiffCached(context.repoPath);
      if (!diff.trim()) {
        setError('没有可提交的更改。');
        return;
      }

      const files = await gitDiffCachedFiles(context.repoPath);
      const branch = await gitCurrentBranch(context.repoPath).catch(() => '');
      const prompt = applyPromptTemplate(commitConfig.ai.prompt, {
        diff,
        files: files.join('\n'),
        branch,
        repo: getRepoName(context.repoPath),
      });

      const result = await requestCommitMessage(commitConfig, prompt);
      if (!result) {
        setError('生成的提交信息为空。');
        return;
      }
      setMessage(result);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBusy(false);
      setBusyLabel(null);
    }
  }, [commitConfig, ensureContext]);

  const commit = useCallback(async () => {
    const context = ensureContext();
    if (!context) return;
    if (!message.trim()) {
      setError('请输入提交信息。');
      return;
    }

    setError(null);
    setIsBusy(true);
    setBusyLabel('正在提交...');
    try {
      await gitCommit(context.repoPath, message.trim());
      setHasCommitted(true);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBusy(false);
      setBusyLabel(null);
    }
  }, [ensureContext, message]);

  const useSuggestedBranch = useCallback(() => {
    if (!suggestedBranchName) {
      setError('没有可用的提交信息，请先生成或输入提交信息。');
      return;
    }
    setError(null);
    setBranchName(suggestedBranchName);
  }, [suggestedBranchName]);

  const createBranch = useCallback(async () => {
    const context = ensureContext();
    if (!context) return;

    const candidate = branchName.trim() || suggestedBranchName;
    if (!candidate) {
      setError('请输入分支名，或先生成提交信息。');
      return;
    }

    if (context.worktreeId) {
      setError(null);
      setIsBusy(true);
      setBusyLabel('正在重命名分支...');
      try {
        await renameWorktreeBranch(context.worktreeId, candidate);
        setBranchName(candidate);
        setCurrentBranch(candidate);
      } catch (err) {
        setError(String(err));
      } finally {
        setIsBusy(false);
        setBusyLabel(null);
      }
      return;
    }

    setError(null);
    setIsBusy(true);
    setBusyLabel('正在创建分支...');
    try {
      const exists = await gitBranchExists(context.repoPath, candidate);
      if (exists) {
        setError(`分支已存在：${candidate}`);
        return;
      }
      await gitCreateBranch(context.repoPath, candidate);
      setBranchName(candidate);
      setCurrentBranch(candidate);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBusy(false);
      setBusyLabel(null);
    }
  }, [ensureContext, branchName, suggestedBranchName]);

  const pushBranch = useCallback(async () => {
    const context = ensureContext();
    if (!context) return;
    if (!hasCommitted) {
      setError('请先完成提交。');
      return;
    }
    setError(null);
    setIsBusy(true);
    setBusyLabel('正在推送当前分支...');
    try {
      await gitPushCurrentBranch(context.repoPath);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBusy(false);
      setBusyLabel(null);
    }
  }, [ensureContext, hasCommitted]);

  const mergeToMain = useCallback(async () => {
    const context = ensureContext();
    if (!context) return;
    if (!hasCommitted) {
      setError('请先完成提交。');
      return;
    }
    if (!context.worktreePath || !context.projectPath) {
      setError('当前不是 worktree，无法合并到 main。');
      return;
    }
    setError(null);
    setIsBusy(true);
    setBusyLabel('正在合并到 main...');
    try {
      await gitMergeToMain(context.worktreePath, context.projectPath);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBusy(false);
      setBusyLabel(null);
    }
  }, [ensureContext, hasCommitted]);

  const pushMain = useCallback(async () => {
    const context = ensureContext();
    if (!context) return;
    if (!hasCommitted) {
      setError('请先完成提交。');
      return;
    }
    if (!context.projectPath) {
      setError('无法定位主目录。');
      return;
    }
    setError(null);
    setIsBusy(true);
    setBusyLabel('正在推送 main...');
    try {
      await gitPushDefaultBranch(context.projectPath);
    } catch (err) {
      setError(String(err));
    } finally {
      setIsBusy(false);
      setBusyLabel(null);
    }
  }, [ensureContext, hasCommitted]);

  return useMemo(() => ({
    isOpen,
    message,
    setMessage,
    error,
    isBusy,
    busyLabel,
    hasCommitted,
    canMergeToMain,
    canCreateBranch,
    canRenameBranch,
    branchName,
    setBranchName,
    currentBranch,
    suggestedBranchName,
    useSuggestedBranch,
    open,
    close,
    generate,
    commit,
    createBranch,
    pushBranch,
    mergeToMain,
    pushMain,
  }), [
    isOpen,
    message,
    error,
    isBusy,
    busyLabel,
    hasCommitted,
    canMergeToMain,
    canCreateBranch,
    canRenameBranch,
    branchName,
    currentBranch,
    suggestedBranchName,
    useSuggestedBranch,
    open,
    close,
    generate,
    commit,
    createBranch,
    pushBranch,
    mergeToMain,
    pushMain,
  ]);
}

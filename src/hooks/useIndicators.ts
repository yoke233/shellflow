import { useState, useCallback, useEffect, useMemo } from 'react';
import { sendOsNotification } from '../lib/notifications';
import { Session, SessionIndicators } from '../types';

export interface UseIndicatorsOptions {
  activeSessionId: string | null;
  sessions: Session[];
}

export interface UseIndicatorsReturn {
  // Unified indicator state
  indicators: Map<string, SessionIndicators>;

  // Handler for all session types
  handleNotification: (sessionId: string, title: string, body: string) => void;
  handleThinkingChange: (sessionId: string, isThinking: boolean) => void;

  // Helper to get indicators for a session
  getIndicators: (sessionId: string) => SessionIndicators;

  // Legacy compatibility - Sets derived from unified Map
  notifiedWorktreeIds: Set<string>;
  thinkingWorktreeIds: Set<string>;
  idleWorktreeIds: Set<string>;
  notifiedProjectIds: Set<string>;
  thinkingProjectIds: Set<string>;
  idleProjectIds: Set<string>;

  // Legacy handlers
  handleWorktreeNotification: (worktreeId: string, title: string, body: string) => void;
  handleWorktreeThinkingChange: (worktreeId: string, isThinking: boolean) => void;
  handleProjectNotification: (projectId: string, title: string, body: string) => void;
  handleProjectThinkingChange: (projectId: string, isThinking: boolean) => void;
  handleScratchNotification: (scratchId: string, title: string, body: string) => void;
  handleScratchThinkingChange: (scratchId: string, isThinking: boolean) => void;
}

const DEFAULT_INDICATORS: SessionIndicators = {
  notified: false,
  thinking: false,
  idle: false,
};

export function useIndicators(options: UseIndicatorsOptions): UseIndicatorsReturn {
  const { activeSessionId, sessions } = options;

  // Unified indicator state: Map<sessionId, SessionIndicators>
  const [indicators, setIndicators] = useState<Map<string, SessionIndicators>>(new Map());

  // Session lookup map for name resolution
  const sessionMap = useMemo(
    () => new Map(sessions.map(s => [s.id, s])),
    [sessions]
  );

  // Clear notification and idle state when session becomes active
  useEffect(() => {
    if (activeSessionId) {
      setIndicators((prev) => {
        const current = prev.get(activeSessionId);
        if (!current || (!current.notified && !current.idle)) return prev;

        const next = new Map(prev);
        next.set(activeSessionId, {
          ...current,
          notified: false,
          idle: false,
        });
        return next;
      });
    }
  }, [activeSessionId]);

  // Get indicators for a session (with defaults)
  const getIndicators = useCallback((sessionId: string): SessionIndicators => {
    return indicators.get(sessionId) ?? DEFAULT_INDICATORS;
  }, [indicators]);

  // Notification handler
  const handleNotification = useCallback((sessionId: string, title: string, body: string) => {
    setIndicators((prev) => {
      const current = prev.get(sessionId) ?? DEFAULT_INDICATORS;
      const next = new Map(prev);
      next.set(sessionId, { ...current, notified: true });
      return next;
    });

    // Only send OS notification if this session is not active
    if (sessionId !== activeSessionId) {
      const session = sessionMap.get(sessionId);
      const notificationTitle = title || session?.name || 'Shellflow';
      sendOsNotification(notificationTitle, body);
    }
  }, [activeSessionId, sessionMap]);

  // Thinking state handler
  const handleThinkingChange = useCallback((sessionId: string, isThinking: boolean) => {
    setIndicators((prev) => {
      const current = prev.get(sessionId) ?? DEFAULT_INDICATORS;
      const next = new Map(prev);

      if (isThinking) {
        // Clear idle when thinking starts
        next.set(sessionId, {
          ...current,
          thinking: true,
          idle: false,
        });
      } else {
        // Set idle when thinking stops (only if was thinking)
        next.set(sessionId, {
          ...current,
          thinking: false,
          idle: current.thinking, // Only set idle if we were thinking
        });
      }
      return next;
    });
  }, []);

  // Legacy compatibility: derive Sets from unified Map
  const { notifiedWorktreeIds, thinkingWorktreeIds, idleWorktreeIds,
          notifiedProjectIds, thinkingProjectIds, idleProjectIds } = useMemo(() => {
    const notifiedWorktree = new Set<string>();
    const thinkingWorktree = new Set<string>();
    const idleWorktree = new Set<string>();
    const notifiedProject = new Set<string>();
    const thinkingProject = new Set<string>();
    const idleProject = new Set<string>();

    for (const [sessionId, state] of indicators.entries()) {
      const session = sessionMap.get(sessionId);
      if (!session) continue;

      if (session.kind === 'worktree') {
        if (state.notified) notifiedWorktree.add(sessionId);
        if (state.thinking) thinkingWorktree.add(sessionId);
        if (state.idle) idleWorktree.add(sessionId);
      } else if (session.kind === 'project') {
        if (state.notified) notifiedProject.add(sessionId);
        if (state.thinking) thinkingProject.add(sessionId);
        if (state.idle) idleProject.add(sessionId);
      }
    }

    return {
      notifiedWorktreeIds: notifiedWorktree,
      thinkingWorktreeIds: thinkingWorktree,
      idleWorktreeIds: idleWorktree,
      notifiedProjectIds: notifiedProject,
      thinkingProjectIds: thinkingProject,
      idleProjectIds: idleProject,
    };
  }, [indicators, sessionMap]);

  // Legacy handlers that delegate to unified handlers
  const handleWorktreeNotification = useCallback((worktreeId: string, title: string, body: string) => {
    handleNotification(worktreeId, title, body);
  }, [handleNotification]);

  const handleWorktreeThinkingChange = useCallback((worktreeId: string, isThinking: boolean) => {
    handleThinkingChange(worktreeId, isThinking);
  }, [handleThinkingChange]);

  const handleProjectNotification = useCallback((projectId: string, title: string, body: string) => {
    handleNotification(projectId, title, body);
  }, [handleNotification]);

  const handleProjectThinkingChange = useCallback((projectId: string, isThinking: boolean) => {
    handleThinkingChange(projectId, isThinking);
  }, [handleThinkingChange]);

  const handleScratchNotification = useCallback((scratchId: string, title: string, body: string) => {
    handleNotification(scratchId, title, body);
  }, [handleNotification]);

  const handleScratchThinkingChange = useCallback((scratchId: string, isThinking: boolean) => {
    handleThinkingChange(scratchId, isThinking);
  }, [handleThinkingChange]);

  return {
    indicators,
    handleNotification,
    handleThinkingChange,
    getIndicators,
    // Legacy compatibility
    notifiedWorktreeIds,
    thinkingWorktreeIds,
    idleWorktreeIds,
    notifiedProjectIds,
    thinkingProjectIds,
    idleProjectIds,
    handleWorktreeNotification,
    handleWorktreeThinkingChange,
    handleProjectNotification,
    handleProjectThinkingChange,
    handleScratchNotification,
    handleScratchThinkingChange,
  };
}

import { useState, useCallback, useMemo } from 'react';
import { Session, ScratchTerminal, Project } from '../types';

export interface UseSessionsOptions {
  scratchTerminals: ScratchTerminal[];
  scratchCwds: Map<string, string>;
  projects: Project[];
  homeDir: string | null;
}

export interface UseSessionsReturn {
  // Derived session list
  sessions: Session[];

  // Active session state
  activeSessionId: string | null;
  activeSession: Session | null;

  // Open sessions (terminals that are mounted)
  openSessionIds: Set<string>;

  // Setters
  setActiveSession: (sessionId: string | null) => void;
  openSession: (sessionId: string) => void;
  closeSession: (sessionId: string) => void;

  // Navigation helpers
  getNextSessionId: (currentId: string | null) => string | null;
  getPrevSessionId: (currentId: string | null) => string | null;
  getSessionByIndex: (index: number) => Session | null;

  // Previous view state for toggle back
  previousSessionId: string | null;
  setPreviousSessionId: (sessionId: string | null) => void;
}

/**
 * Derives a unified session list from scratch terminals, projects, and worktrees.
 * Sessions are ordered: scratch terminals first, then projects interleaved with their worktrees.
 */
function deriveSessions(options: UseSessionsOptions): Session[] {
  const { scratchTerminals, scratchCwds, projects, homeDir } = options;
  const sessions: Session[] = [];
  let order = 0;

  // Scratch terminals first
  for (const scratch of scratchTerminals) {
    sessions.push({
      id: scratch.id,
      kind: 'scratch',
      name: scratch.name,
      path: scratchCwds.get(scratch.id) ?? homeDir ?? '',
      order: order++,
    });
  }

  // Projects and their worktrees (interleaved in sidebar visual order)
  for (const project of projects) {
    if (!project.isActive) continue;

    // Project session
    sessions.push({
      id: project.id,
      kind: 'project',
      name: project.name,
      path: project.path,
      order: order++,
    });

    // Worktree sessions for this project
    for (const worktree of project.worktrees) {
      sessions.push({
        id: worktree.id,
        kind: 'worktree',
        name: worktree.name,
        path: worktree.path,
        order: order++,
        projectId: project.id,
        branch: worktree.branch,
      });
    }
  }

  return sessions;
}

export function useSessions(options: UseSessionsOptions): UseSessionsReturn {
  const { scratchTerminals, scratchCwds, projects, homeDir } = options;

  // Derive sessions from source data
  const sessions = useMemo(
    () => deriveSessions({ scratchTerminals, scratchCwds, projects, homeDir }),
    [scratchTerminals, scratchCwds, projects, homeDir]
  );

  // Session lookup map for O(1) access
  const sessionMap = useMemo(
    () => new Map(sessions.map(s => [s.id, s])),
    [sessions]
  );

  // Active session ID state
  const [activeSessionId, setActiveSessionIdState] = useState<string | null>(null);

  // Open session IDs (terminals that are mounted)
  const [openSessionIds, setOpenSessionIds] = useState<Set<string>>(new Set());

  // Previous session for toggle back (cmd+')
  const [previousSessionId, setPreviousSessionId] = useState<string | null>(null);

  // Active session object
  const activeSession = useMemo(
    () => (activeSessionId ? sessionMap.get(activeSessionId) ?? null : null),
    [activeSessionId, sessionMap]
  );

  // Set active session
  const setActiveSession = useCallback((sessionId: string | null) => {
    setActiveSessionIdState((prevId) => {
      // Store previous for toggle back
      if (prevId && prevId !== sessionId) {
        setPreviousSessionId(prevId);
      }
      return sessionId;
    });

    // Auto-open when activating
    if (sessionId) {
      setOpenSessionIds((prev) => {
        if (prev.has(sessionId)) return prev;
        const next = new Set(prev);
        next.add(sessionId);
        return next;
      });
    }
  }, []);

  // Open a session (add to open set)
  const openSession = useCallback((sessionId: string) => {
    setOpenSessionIds((prev) => {
      if (prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.add(sessionId);
      return next;
    });
  }, []);

  // Close a session (remove from open set)
  const closeSession = useCallback((sessionId: string) => {
    setOpenSessionIds((prev) => {
      if (!prev.has(sessionId)) return prev;
      const next = new Set(prev);
      next.delete(sessionId);
      return next;
    });

    // Clear active if closing active session
    setActiveSessionIdState((prevActive) => {
      if (prevActive === sessionId) {
        // Find next open session to activate
        const openList = Array.from(openSessionIds).filter(id => id !== sessionId);
        return openList.length > 0 ? openList[openList.length - 1] : null;
      }
      return prevActive;
    });
  }, [openSessionIds]);

  // Get open sessions in order
  const openSessionsInOrder = useMemo(
    () => sessions.filter(s => openSessionIds.has(s.id)),
    [sessions, openSessionIds]
  );

  // Navigation: get next session ID
  const getNextSessionId = useCallback((currentId: string | null): string | null => {
    if (openSessionsInOrder.length === 0) return null;
    if (!currentId) return openSessionsInOrder[0]?.id ?? null;

    const currentIndex = openSessionsInOrder.findIndex(s => s.id === currentId);
    if (currentIndex === -1) return openSessionsInOrder[0]?.id ?? null;

    const nextIndex = (currentIndex + 1) % openSessionsInOrder.length;
    return openSessionsInOrder[nextIndex]?.id ?? null;
  }, [openSessionsInOrder]);

  // Navigation: get previous session ID
  const getPrevSessionId = useCallback((currentId: string | null): string | null => {
    if (openSessionsInOrder.length === 0) return null;
    if (!currentId) return openSessionsInOrder[openSessionsInOrder.length - 1]?.id ?? null;

    const currentIndex = openSessionsInOrder.findIndex(s => s.id === currentId);
    if (currentIndex === -1) return openSessionsInOrder[openSessionsInOrder.length - 1]?.id ?? null;

    const prevIndex = (currentIndex - 1 + openSessionsInOrder.length) % openSessionsInOrder.length;
    return openSessionsInOrder[prevIndex]?.id ?? null;
  }, [openSessionsInOrder]);

  // Navigation: get session by 1-based index (for cmd+1-9)
  const getSessionByIndex = useCallback((index: number): Session | null => {
    if (index < 1 || index > openSessionsInOrder.length) return null;
    return openSessionsInOrder[index - 1] ?? null;
  }, [openSessionsInOrder]);

  return {
    sessions,
    activeSessionId,
    activeSession,
    openSessionIds,
    setActiveSession,
    openSession,
    closeSession,
    getNextSessionId,
    getPrevSessionId,
    getSessionByIndex,
    previousSessionId,
    setPreviousSessionId,
  };
}

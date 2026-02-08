import { useCallback, useEffect, useState } from 'react';
import type { Dispatch, SetStateAction } from 'react';

interface UseExpandedProjectsResult {
  expandedProjects: Set<string>;
  setExpandedProjects: Dispatch<SetStateAction<Set<string>>>;
  toggleProject: (projectId: string) => void;
}

export function useExpandedProjects(storageKey: string): UseExpandedProjectsResult {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(() => {
    try {
      const saved = localStorage.getItem(storageKey);
      if (saved) {
        return new Set(JSON.parse(saved));
      }
    } catch (e) {
      console.error('Failed to load expanded projects:', e);
    }
    return new Set();
  });

  useEffect(() => {
    localStorage.setItem(storageKey, JSON.stringify([...expandedProjects]));
  }, [expandedProjects, storageKey]);

  const toggleProject = useCallback((projectId: string) => {
    setExpandedProjects((prev) => {
      const next = new Set(prev);
      if (next.has(projectId)) {
        next.delete(projectId);
      } else {
        next.add(projectId);
      }
      return next;
    });
  }, []);

  return {
    expandedProjects,
    setExpandedProjects,
    toggleProject,
  };
}
